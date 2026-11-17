package com.intermap.backend.restaurant;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.List;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 네이버(NCP) Geocoding — 주소를 지도에 찍히는 좌표로 바꾼다.
 * https://api.ncloud-docs.com/docs/application-maps-geocoding
 * 지도도 네이버라 이 좌표가 지도 위 건물과 정확히 맞는다.
 */
@Component
public class NaverGeocoder implements GeocodeBackfill.Geocoder {

    private static final String URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode";

    /** 키가 틀렸거나 이용량을 다 쓴 경우 — 계속 불러도 다 실패하므로 백필을 멈춘다 */
    public static class Unavailable extends RuntimeException {
        Unavailable(String message) {
            super(message);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Address(String x, String y) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Response(String status, List<Address> addresses) {
    }

    private final RestClient client;
    private final String keyId;
    private final String key;

    public NaverGeocoder(@Value("${ncp.map.key-id:}") String keyId, @Value("${ncp.map.key:}") String key) {
        this.keyId = keyId;
        this.key = key;
        var factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5_000);
        factory.setReadTimeout(10_000);
        this.client = RestClient.builder().requestFactory(factory).build();
    }

    public boolean isConfigured() {
        return !keyId.isBlank() && !key.isBlank();
    }

    /** 주소 → [lat, lng]. 결과가 없으면 빈 값. 429(초당 한도)면 잠깐 쉬고 다시 묻는다 */
    @Override
    public Optional<double[]> geocode(String query) {
        for (int attempt = 0; ; attempt++) {
            try {
                return request(query);
            } catch (RestClientResponseException e) {
                int code = e.getStatusCode().value();
                if (code == 429 && attempt < 4) {
                    sleep(1_000L << attempt);
                    continue;
                }
                if (code == 401 || code == 403 || code == 429) {
                    throw new Unavailable(code + " " + e.getResponseBodyAsString());
                }
                if (code == 400) return Optional.empty(); // 주소로 못 알아본 질의 — 못 찾은 것과 같다
                throw e;
            }
        }
    }

    private Optional<double[]> request(String query) {
        Response res = client.get()
            .uri(UriComponentsBuilder.fromUriString(URL).queryParam("query", query).queryParam("count", 1)
                .encode().build().toUri())
            .header("x-ncp-apigw-api-key-id", keyId)
            .header("x-ncp-apigw-api-key", key)
            .header("Accept", "application/json")
            .retrieve()
            .body(Response.class);
        if (res == null || res.addresses() == null || res.addresses().isEmpty()) return Optional.empty();
        Address a = res.addresses().get(0);
        try {
            return Optional.of(new double[] {Double.parseDouble(a.y()), Double.parseDouble(a.x())});
        } catch (NumberFormatException | NullPointerException e) {
            return Optional.empty();
        }
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted");
        }
    }

    // 인허가 도로명 주소엔 "서울특별시 마포구 와우산로 21, 2층 (서교동)"처럼 층·호·동 이름이 붙는다.
    // 지오코딩은 건물까지만 알면 되고 꼬리가 붙으면 못 찾는 경우가 있어 쉼표·괄호 뒤를 자른다.
    static String cleanRoad(String road) {
        if (road == null) return null;
        String s = road.replaceAll("\\(.*?\\)", " ");
        int comma = s.indexOf(',');
        if (comma >= 0) s = s.substring(0, comma);
        s = s.replaceAll("\\s+", " ").trim();
        return s.isEmpty() ? null : s;
    }

    // 지번 주소는 "서울특별시 마포구 서교동 395-17 2층"처럼 번지 뒤에 층·호가 붙는다 — 번지까지만.
    private static final Pattern LOT = Pattern.compile("^(.*?\\s(?:산\\s?)?\\d+(?:-\\d+)?)(?:\\s|,|$)");

    static String cleanLot(String lot) {
        if (lot == null || lot.isBlank()) return null;
        Matcher m = LOT.matcher(lot.trim());
        return m.find() ? m.group(1).trim() : lot.trim();
    }
}
