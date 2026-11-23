package com.intermap.backend.localdata;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * 공공데이터포털 "행정안전부_식품_○○ 조회서비스" 클라이언트 — 일반음식점, 그리고 카페를 채우는 휴게음식점·제과점영업.
 * (구 localdata.go.kr 후속 — 2026-04 통합 이관)
 * 세 API는 주소의 서비스 이름만 다르고 요청 변수와 응답 항목이 같다 (2026-11 공개 명세로 확인).
 * 인증키는 계정에 하나지만 API마다 활용신청을 따로 해야 불린다.
 */
@Component
public class LocalDataClient {

    private static final String BASE_URL = "https://apis.data.go.kr/1741000/";

    /** 인허가 종류. path = API 주소의 서비스 이름, label = 로그에 쓰는 이름 */
    public enum Service {
        // https://www.data.go.kr/data/15154916/openapi.do
        GENERAL("general_restaurants", "일반음식점"),
        // https://www.data.go.kr/data/15154921/openapi.do — 커피숍·다방·아이스크림 … (편의점·패스트푸드도 여기 있다)
        REST_CAFE("rest_cafes", "휴게음식점"),
        // https://www.data.go.kr/data/15155252/openapi.do — 빵집
        BAKERY("bakeries", "제과점영업");

        private final String path;
        private final String label;

        Service(String path, String label) {
            this.path = path;
            this.label = label;
        }

        public String path() {
            return path;
        }

        public String label() {
            return label;
        }
    }
    private static final int PAGE_SIZE = 100; // API max
    // 변경분 조회 상한 (구 하나, 3만 건). 한 달 치 변경분이 이걸 넘으면 뒤쪽이 잘린다 — 잘리면 로그에 남긴다
    private static final int MAX_PAGES = 300;
    private static final DateTimeFormatter TS = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Row(
        @JsonProperty("MNG_NO") String mgtNo,
        @JsonProperty("BPLC_NM") String bplcNm,
        @JsonProperty("ROAD_NM_ADDR") String rdnWhlAddr,
        @JsonProperty("LOTNO_ADDR") String lotnoAddr,
        @JsonProperty("BZSTAT_SE_NM") String category,
        @JsonProperty("CRD_INFO_X") String crdX,
        @JsonProperty("CRD_INFO_Y") String crdY,
        @JsonProperty("SALS_STTS_CD") String trdStateGbn,
        @JsonProperty("CLSBIZ_YMD") String dcbYmd
    ) {
        public boolean isClosed() {
            return "03".equals(trdStateGbn) || "04".equals(trdStateGbn); // 03 폐업, 04 취소/말소
        }

        public boolean isOpen() {
            return "01".equals(trdStateGbn); // 01 영업/정상 (fetchAllOpen이 거르는 값과 같다)
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Items(List<Row> item) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Body(Items items, Integer totalCount) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Response(Body body) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Envelope(Response response) {
    }

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(LocalDataClient.class);

    // 공공 API가 간헐적으로 응답을 물고 있으므로 타임아웃 필수 (없으면 무한 대기)
    private final RestClient restClient;
    private final String serviceKey;

    {
        var factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);
        factory.setReadTimeout(30_000);
        restClient = RestClient.builder().requestFactory(factory).build();
    }

    public LocalDataClient(@Value("${localdata.auth-key}") String serviceKey) {
        this.serviceKey = serviceKey;
    }

    public boolean isConfigured() {
        return !serviceKey.isBlank();
    }

    /** 지자체 코드 기준, 데이터갱신시점(DAT_UPDT_PNT) 범위의 rows 조회 */
    public List<Row> fetchChangedSince(Service service, String localCode, LocalDate from, LocalDate to) {
        return fetchPages(service, MAX_PAGES, builder -> builder
            .queryParam("cond%5BOPN_ATMY_GRP_CD%3A%3AEQ%5D", localCode)
            .queryParam("cond%5BDAT_UPDT_PNT%3A%3AGTE%5D", from.atStartOfDay().format(TS))
            .queryParam("cond%5BDAT_UPDT_PNT%3A%3ALT%5D", to.plusDays(1).atStartOfDay().format(TS)));
    }

    /** 지자체 코드 기준 영업중(01) 전량 조회 — 최초 데이터 유입(백필)용 */
    public List<Row> fetchAllOpen(Service service, String localCode) {
        // 마포구 영업중 일반음식점 약 8천 건 = 80페이지. 강남구는 그 두 배 가까이라 여유 포함 상한 400
        return fetchPages(service, 400, builder -> builder
            .queryParam("cond%5BOPN_ATMY_GRP_CD%3A%3AEQ%5D", localCode)
            .queryParam("cond%5BSALS_STTS_CD%3A%3AEQ%5D", "01"));
    }

    private List<Row> fetchPages(Service service, int maxPages, java.util.function.UnaryOperator<UriComponentsBuilder> conds) {
        List<Row> all = new ArrayList<>();
        for (int page = 1; page <= maxPages; page++) {
            // serviceKey는 이미 URL 인코딩된 값이라 재인코딩 금지 — build(true) + 직접 조립
            URI uri = conds.apply(UriComponentsBuilder.fromUriString(BASE_URL + service.path() + "/info")
                    .queryParam("serviceKey", serviceKey)
                    .queryParam("pageNo", page)
                    .queryParam("numOfRows", PAGE_SIZE)
                    .queryParam("returnType", "json"))
                .build(true)
                .toUri();

            Envelope envelope = fetchWithRetry(uri);
            // 활용신청이 안 된 API는 목록 대신 오류 봉투가 온다. 일반음식점은 예전부터 빈 목록으로 읽어 왔으니 그대로 두고,
            // 새로 붙인 API만 "0건"과 "못 불렀다"를 가른다 — 못 부른 구를 다 받은 것으로 적어 두면 안 된다 (CafeImport)
            if (service != Service.GENERAL && (envelope == null || envelope.response() == null)) {
                throw new IllegalStateException(service.label() + " API가 목록을 주지 않았어요 (활용신청 여부 확인)");
            }
            List<Row> rows = envelope == null || envelope.response() == null
                || envelope.response().body() == null
                || envelope.response().body().items() == null
                || envelope.response().body().items().item() == null
                ? List.of()
                : envelope.response().body().items().item();

            all.addAll(rows);
            if (page % 10 == 0) log.info("LOCALDATA {} 조회 중... {}페이지, 누적 {}건", service.label(), page, all.size());
            if (rows.size() < PAGE_SIZE) break;
            if (page == maxPages) log.warn("LOCALDATA {} 조회가 상한({}페이지)에서 잘렸어요 — 뒤쪽 행은 못 받음", service.label(), maxPages);
        }
        return all;
    }

    private Envelope fetchWithRetry(URI uri) {
        RuntimeException last = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            try {
                return restClient.get().uri(uri).retrieve().body(Envelope.class);
            } catch (RuntimeException e) {
                last = e;
                log.warn("LOCALDATA 요청 실패 ({}차): {}", attempt, e.getMessage());
                try {
                    Thread.sleep(1000L * attempt);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw last;
                }
            }
        }
        throw last;
    }
}
