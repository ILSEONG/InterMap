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

    private final RestClient restClient = RestClient.create();
    private final String serviceKey;

    public LocalDataClient(@Value("${localdata.auth-key}") String serviceKey) {
        this.serviceKey = serviceKey;
    }

    public boolean isConfigured() {
        return !serviceKey.isBlank();
    }

    /** 지자체 코드 기준, 데이터갱신시점(DAT_UPDT_PNT) 범위의 일반음식점 rows 조회 */
    public List<Row> fetchChangedSince(String localCode, LocalDate from, LocalDate to) {
        List<Row> all = new ArrayList<>();
        for (int page = 1; page <= MAX_PAGES; page++) {
            // serviceKey는 이미 URL 인코딩된 값이라 재인코딩 금지 — build(true) + 직접 조립
            URI uri = UriComponentsBuilder.fromUriString(BASE_URL)
                .queryParam("serviceKey", serviceKey)
                .queryParam("pageNo", page)
                .queryParam("numOfRows", PAGE_SIZE)
                .queryParam("returnType", "json")
                .queryParam("cond%5BOPN_ATMY_GRP_CD%3A%3AEQ%5D", localCode)
                .queryParam("cond%5BDAT_UPDT_PNT%3A%3AGTE%5D", from.atStartOfDay().format(TS))
                .queryParam("cond%5BDAT_UPDT_PNT%3A%3ALT%5D", to.plusDays(1).atStartOfDay().format(TS))
                .build(true)
                .toUri();

            Envelope envelope = restClient.get().uri(uri).retrieve().body(Envelope.class);
            List<Row> rows = envelope == null || envelope.response() == null
                || envelope.response().body() == null
                || envelope.response().body().items() == null
                || envelope.response().body().items().item() == null
                ? List.of()
                : envelope.response().body().items().item();

            all.addAll(rows);
            if (rows.size() < PAGE_SIZE) break;
        }
        return all;
    }
}
