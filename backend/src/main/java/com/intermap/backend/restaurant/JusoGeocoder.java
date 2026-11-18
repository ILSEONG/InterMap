package com.intermap.backend.restaurant;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.locationtech.proj4j.CRSFactory;
import org.locationtech.proj4j.CoordinateTransform;
import org.locationtech.proj4j.CoordinateTransformFactory;
import org.locationtech.proj4j.ProjCoordinate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 행정안전부 도로명주소 API(주소기반산업지원서비스, business.juso.go.kr) — 주소를 건물 출입구 좌표로 바꾼다.
 * 두 번 묻는다: 주소 검색 API로 건물을 찾고(검색 키), 그 건물의 좌표를 좌표제공 API로 받는다(좌표 키).
 * 공공데이터라 받은 좌표를 DB에 저장해도 된다 — 네이버 지오코딩은 약관이 결과 저장을 금지해서 쓰지 않는다.
 * 좌표는 UTM-K(GRS80, EPSG:5179)로 오므로 WGS84로 바꾼다.
 */
@Component
public class JusoGeocoder implements GeocodeBackfill.Locator {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    // 같은 건물에 든 가게들이 같은 주소를 다시 묻지 않게 — 한 번에 도는 동안만 들고 있는다
    private static final int CACHE_MAX = 60_000;

    private static final CoordinateTransform UTMK_TO_WGS84;

    static {
        CRSFactory factory = new CRSFactory();
        UTMK_TO_WGS84 = new CoordinateTransformFactory().createTransform(
            factory.createFromParameters("EPSG:5179",
                "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs"),
            factory.createFromParameters("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs"));
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Common(String errorCode, String errorMessage, String totalCount) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Juso(String roadAddr, String roadAddrPart1, String jibunAddr, String admCd, String rnMgtSn, String udrtYn,
                String buldMnnm, String buldSlno, String entX, String entY) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Results(Common common, List<Juso> juso) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Envelope(Results results) {
    }

    private final ObjectMapper mapper = new ObjectMapper();
    private final RestClient client;
    private final String baseUrl;
    private final String searchKey;
    private final String coordKey;
    private final int dailyCalls;
    private final long minIntervalMillis;

    private final Map<String, Optional<double[]>> cache = new ConcurrentHashMap<>();
    private LocalDate countedDay;
    private int callsToday;
    private long nextCallAt;

    public JusoGeocoder(@Value("${juso.base-url:https://business.juso.go.kr/addrlink}") String baseUrl,
                        @Value("${juso.search-key:}") String searchKey,
                        @Value("${juso.coord-key:}") String coordKey,
                        @Value("${juso.daily-calls:90000}") int dailyCalls,
                        @Value("${juso.min-interval-ms:130}") long minIntervalMillis) {
        this.baseUrl = baseUrl;
        this.searchKey = searchKey;
        this.coordKey = coordKey;
        this.dailyCalls = dailyCalls;
        this.minIntervalMillis = minIntervalMillis;
        var factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5_000);
        factory.setReadTimeout(10_000);
        this.client = RestClient.builder().requestFactory(factory).build();
    }

    @Override
    public boolean isConfigured() {
        return !searchKey.isBlank() && !coordKey.isBlank();
    }

    /** 도로명 주소(건물) 먼저, 없으면 지번 주소로 찾는다. 주소가 글자까지 맞는 건물만 받는다 */
    @Override
    public Optional<double[]> locate(String roadAddress, String lotAddress) {
        String road = AddressText.cleanRoad(roadAddress);
        if (road != null) {
            Optional<double[]> p = cached(road, true);
            if (p.isPresent()) return p;
        }
        String lot = AddressText.cleanLot(lotAddress);
        if (lot != null) return cached(lot, false);
        return Optional.empty();
    }

    // 서울시청. 이 주소의 좌표는 바뀔 일이 없다 — 답이 500m 넘게 벗어나면 응답을 잘못 읽고 있는 것
    private static final String KNOWN_ADDRESS = "서울특별시 중구 세종대로 110";
    private static final double KNOWN_LAT = 37.5663, KNOWN_LNG = 126.9779;

    @Override
    public boolean answersKnownAddress() {
        try {
            Optional<double[]> p = lookup(KNOWN_ADDRESS, true);
            if (p.isEmpty()) return false;
            double dLat = (p.get()[0] - KNOWN_LAT) * 111_000;
            double dLng = (p.get()[1] - KNOWN_LNG) * 88_000;
            return Math.hypot(dLat, dLng) < 500;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private Optional<double[]> cached(String query, boolean road) {
        String key = (road ? "R:" : "L:") + query;
        Optional<double[]> hit = cache.get(key);
        if (hit != null) return hit;
        Optional<double[]> found = lookup(query, road);
        if (cache.size() >= CACHE_MAX) cache.clear();
        cache.put(key, found);
        return found;
    }

    private Optional<double[]> lookup(String query, boolean road) {
        Map<String, String> search = new LinkedHashMap<>();
        search.put("currentPage", "1");
        search.put("countPerPage", "10");
        // 검색어에 넣을 수 없는 글자(%, =, <, > 등)는 뺀다 — 넣으면 그 주소만 계속 거절된다
        search.put("keyword", query.replaceAll("[%=<>\\[\\]]", " ").trim());
        Juso building = null;
        for (Juso j : call("/addrLinkApi.do", searchKey, search)) {
            if (road ? sameRoad(query, j.roadAddrPart1()) : sameLot(query, j.jibunAddr())) {
                building = j;
                break;
            }
        }
        if (building == null || building.admCd() == null || building.rnMgtSn() == null || building.buldMnnm() == null) {
            return Optional.empty();
        }
        Map<String, String> coord = new LinkedHashMap<>();
        coord.put("admCd", building.admCd());
        coord.put("rnMgtSn", building.rnMgtSn());
        coord.put("udrtYn", building.udrtYn() == null ? "0" : building.udrtYn());
        coord.put("buldMnnm", building.buldMnnm());
        coord.put("buldSlno", building.buldSlno() == null ? "0" : building.buldSlno());
        for (Juso j : call("/addrCoordApi.do", coordKey, coord)) {
            double[] p = toLatLng(j.entX(), j.entY());
            if (p != null) return Optional.of(p);
        }
        return Optional.empty();
    }

    // 도로명 주소는 건물번호까지 글자가 같아야 한다 (띄어쓰기만 무시)
    static boolean sameRoad(String query, String roadAddrPart1) {
        return roadAddrPart1 != null && AddressText.squash(roadAddrPart1).equals(AddressText.squash(query));
    }

    // 지번 주소는 뒤에 건물 이름이 붙어 온다 — 번지까지 같고, 그 뒤가 번지의 연장(숫자·-)이 아니어야 한다
    static boolean sameLot(String query, String jibunAddr) {
        if (jibunAddr == null) return false;
        String a = AddressText.squash(jibunAddr), q = AddressText.squash(query);
        if (!a.startsWith(q)) return false;
        if (a.length() == q.length()) return true;
        char next = a.charAt(q.length());
        return !Character.isDigit(next) && next != '-';
    }

    private List<Juso> call(String path, String key, Map<String, String> params) {
        reserve();
        UriComponentsBuilder uri = UriComponentsBuilder.fromUriString(baseUrl + path)
            .queryParam("confmKey", key)
            .queryParam("resultType", "json");
        params.forEach(uri::queryParam);
        final String body;
        try {
            body = client.get().uri(uri.encode().build().toUri()).retrieve().body(String.class);
        } catch (RestClientResponseException e) {
            int status = e.getStatusCode().value();
            if (status == 401 || status == 403) throw new GeocodeBackfill.Unavailable("HTTP " + status);
            // 그 주소 하나가 거절된 것(허용되지 않는 글자 등) — 못 찾은 것으로 넘어간다. 같은 행을 끝없이 다시 묻지 않게
            if (status >= 400 && status < 500 && status != 429) return List.of();
            throw e; // 429·5xx는 잠깐 뒤 다시 물어볼 일
        }
        final Envelope envelope;
        try {
            envelope = mapper.readValue(body, Envelope.class);
        } catch (Exception e) {
            throw new IllegalStateException("도로명주소 API 응답을 읽지 못했어요: " + e.getMessage());
        }
        Results results = envelope == null ? null : envelope.results();
        Common common = results == null ? null : results.common();
        if (common == null) throw new IllegalStateException("도로명주소 API 응답에 결과가 없어요");
        String code = common.errorCode() == null ? "" : common.errorCode().trim();
        if (!code.equals("0")) {
            String message = common.errorMessage() == null ? "" : common.errorMessage();
            // 승인키 문제나 이용 한도 — 계속 불러도 다 실패하므로 멈춘다
            if (message.contains("승인") || message.contains("키") || message.toUpperCase().contains("KEY")
                || message.contains("초과") || message.contains("제한") || message.contains("만료")) {
                throw new GeocodeBackfill.Unavailable(code + " " + message);
            }
            // 시스템 오류 — 잠깐 뒤 다시 물어볼 일
            if (code.equals("-999")) throw new IllegalStateException(code + " " + message);
            // 그 밖은 검색어로 못 알아본 것(주소를 더 자세히, 허용되지 않는 글자 등) — 못 찾은 것과 같다
            return List.of();
        }
        return results.juso() == null ? List.of() : results.juso();
    }

    // 초당 호출 수를 넘지 않게 간격을 두고, 하루 호출 수를 센다 (승인키마다 초당·하루 한도가 있다)
    private void reserve() {
        long wait;
        synchronized (this) {
            LocalDate today = LocalDate.now(KST);
            if (!today.equals(countedDay)) {
                countedDay = today;
                callsToday = 0;
            }
            if (callsToday >= dailyCalls) {
                throw new GeocodeBackfill.Unavailable("오늘 쓸 호출 수(" + dailyCalls + "건)를 다 썼어요 — 내일 이어서 해요");
            }
            callsToday++;
            long now = System.currentTimeMillis();
            long at = Math.max(now, nextCallAt);
            nextCallAt = at + minIntervalMillis;
            wait = at - now;
        }
        if (wait > 0) {
            try {
                Thread.sleep(wait);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("interrupted");
            }
        }
    }

    /** UTM-K 좌표 문자열을 WGS84 [lat, lng]로. 비어 있거나 한국 범위를 벗어나면 null */
    static double[] toLatLng(String x, String y) {
        if (x == null || y == null || x.isBlank() || y.isBlank()) return null;
        try {
            ProjCoordinate out = new ProjCoordinate();
            // 여러 스레드가 함께 부른다 — 변환기가 안에 든 상태를 같이 쓰지 않게 한 번에 하나씩
            synchronized (UTMK_TO_WGS84) {
                UTMK_TO_WGS84.transform(new ProjCoordinate(Double.parseDouble(x), Double.parseDouble(y)), out);
            }
            double lat = out.y, lng = out.x;
            if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return null;
            return new double[] {lat, lng};
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
