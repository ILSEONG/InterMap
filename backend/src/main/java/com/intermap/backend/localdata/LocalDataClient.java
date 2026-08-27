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
 * 공공데이터포털 "행정안전부_식품_일반음식점 조회서비스" 클라이언트.
 * (구 localdata.go.kr 후속 — 2026-04 통합 이관)
 * https://www.data.go.kr/data/15154916/openapi.do
 */
@Component
public class LocalDataClient {

    private static final String BASE_URL = "https://apis.data.go.kr/1741000/general_restaurants/info";
    private static final int PAGE_SIZE = 100; // API max
    // ponytail: 페이지 상한 고정 — 주간 델타 조회엔 충분, 전체 백필이 필요해지면 상한 올리기
    private static final int MAX_PAGES = 50;
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

    /** 지자체 코드 기준, 데이터갱신시점(DAT_UPDT_PNT) 범위의 일반음식점 rows 조회 */
    public List<Row> fetchChangedSince(String localCode, LocalDate from, LocalDate to) {
        return fetchPages(MAX_PAGES, builder -> builder
            .queryParam("cond%5BOPN_ATMY_GRP_CD%3A%3AEQ%5D", localCode)
            .queryParam("cond%5BDAT_UPDT_PNT%3A%3AGTE%5D", from.atStartOfDay().format(TS))
            .queryParam("cond%5BDAT_UPDT_PNT%3A%3ALT%5D", to.plusDays(1).atStartOfDay().format(TS)));
    }

    /** 지자체 코드 기준 영업중(01) 일반음식점 전량 조회 — 최초 데이터 유입(백필)용 */
    public List<Row> fetchAllOpen(String localCode) {
        // 마포구 기준 영업중 약 8천 건 = 80페이지. 대형 지자체 여유분 포함 상한 200
        return fetchPages(200, builder -> builder
            .queryParam("cond%5BOPN_ATMY_GRP_CD%3A%3AEQ%5D", localCode)
            .queryParam("cond%5BSALS_STTS_CD%3A%3AEQ%5D", "01"));
    }

    private List<Row> fetchPages(int maxPages, java.util.function.UnaryOperator<UriComponentsBuilder> conds) {
        List<Row> all = new ArrayList<>();
        for (int page = 1; page <= maxPages; page++) {
            // serviceKey는 이미 URL 인코딩된 값이라 재인코딩 금지 — build(true) + 직접 조립
            URI uri = conds.apply(UriComponentsBuilder.fromUriString(BASE_URL)
                    .queryParam("serviceKey", serviceKey)
                    .queryParam("pageNo", page)
                    .queryParam("numOfRows", PAGE_SIZE)
                    .queryParam("returnType", "json"))
                .build(true)
                .toUri();

            Envelope envelope = fetchWithRetry(uri);
            List<Row> rows = envelope == null || envelope.response() == null
                || envelope.response().body() == null
                || envelope.response().body().items() == null
                || envelope.response().body().items().item() == null
                ? List.of()
                : envelope.response().body().items().item();

            all.addAll(rows);
            if (page % 10 == 0) log.info("LOCALDATA 조회 중... {}페이지, 누적 {}건", page, all.size());
            if (rows.size() < PAGE_SIZE) break;
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
