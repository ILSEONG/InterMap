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

    // 검색어 쪽 문제를 뜻하는 오류 코드 (입력 없음, 더 자세히, 한 글자, 문자+숫자, 너무 김, 긴 숫자,
    // 특수문자+숫자만, 예약어·특수문자, 검색 범위 초과). 이 코드일 때만 "그 주소는 못 찾음"으로 본다
    private static final java.util.Set<String> QUERY_PROBLEMS = java.util.Set.of(
        "E0005", "E0006", "E0008", "E0009", "E0010", "E0011", "E0012", "E0013", "E0015");

    // "짧은 시간동안 다량의 주소검색 요청이 있습니다" — 너무 빨리 불렀다는 거절. 잠깐 뒤에는 다시 받아 준다
    private static final String TOO_FAST = "E0007";
    // 같은 요청을 이만큼 물어도 계속 거절되면 잠깐의 오류로 넘긴다 (기다리는 시간은 5·10·15·20초로 늘어난다)
    private static final int BUSY_ATTEMPTS = 5;
    private static final long SLOW_DOWN_AT_MOST_EVERY_MILLIS = 30_000;
    // 처음 간격(API마다). 가게 한 곳에 두 API를 한 번씩 부르므로 초당 약 2.9곳에서 시작해 받아 주는 만큼 빨라진다
    private static final long START_INTERVAL_MILLIS = 350;

    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(JusoGeocoder.class);

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
    private final Pace searchPace;
    private final Pace coordPace;

    private final Map<String, Optional<double[]>> cache = new ConcurrentHashMap<>();
    private LocalDate countedDay;
    private int callsToday;

    @org.springframework.beans.factory.annotation.Autowired
    public JusoGeocoder(@Value("${juso.base-url:https://business.juso.go.kr/addrlink}") String baseUrl,
                        @Value("${juso.search-key:}") String searchKey,
                        @Value("${juso.coord-key:}") String coordKey,
                        @Value("${juso.daily-calls:0}") int dailyCalls,
                        @Value("${juso.min-interval-ms:0}") long minIntervalMillis) {
        this(baseUrl, searchKey, coordKey, dailyCalls, START_INTERVAL_MILLIS, minIntervalMillis, 5_000);
    }

    JusoGeocoder(String baseUrl, String searchKey, String coordKey, int dailyCalls,
                 long startIntervalMillis, long minIntervalMillis, long cooldownMillis) {
        this.baseUrl = baseUrl;
        this.searchKey = searchKey;
        this.coordKey = coordKey;
        this.dailyCalls = dailyCalls;
        this.searchPace = new Pace("검색", startIntervalMillis, minIntervalMillis, cooldownMillis);
        this.coordPace = new Pace("좌표", startIntervalMillis, minIntervalMillis, cooldownMillis);
        var factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5_000);
        factory.setReadTimeout(10_000);
        this.client = RestClient.builder().requestFactory(factory).build();
    }

    @Override
    public String pace() {
        return "간격 검색 " + searchPace.intervalMillis() + "ms·좌표 " + coordPace.intervalMillis() + "ms";
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
        for (Juso j : call(searchPace, "/addrLinkApi.do", searchKey, search)) {
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
        for (Juso j : call(coordPace, "/addrCoordApi.do", coordKey, coord)) {
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

    private List<Juso> call(Pace pace, String path, String key, Map<String, String> params) {
        UriComponentsBuilder uri = UriComponentsBuilder.fromUriString(baseUrl + path)
            .queryParam("confmKey", key)
            .queryParam("resultType", "json");
        params.forEach(uri::queryParam);
        java.net.URI target = uri.encode().build().toUri();
        for (int attempt = 1; ; attempt++) {
            countCall();
            long startedAt = pace.await();
            final String body;
            try {
                body = client.get().uri(target).retrieve().body(String.class);
            } catch (RestClientResponseException e) {
                int status = e.getStatusCode().value();
                if (status == 401 || status == 403) throw new GeocodeBackfill.Unavailable("HTTP " + status);
                if (status == 429) {
                    pace.refused(startedAt, attempt);
                    if (attempt < BUSY_ATTEMPTS) continue;
                    throw e;
                }
                // 그 주소 하나가 거절된 것(허용되지 않는 글자 등) — 못 찾은 것으로 넘어간다. 같은 행을 끝없이 다시 묻지 않게
                if (status >= 400 && status < 500) return List.of();
                throw e; // 5xx는 잠깐 뒤 다시 물어볼 일
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
            if (code.equals("0")) {
                pace.succeeded();
                return results.juso() == null ? List.of() : results.juso();
            }
            String message = common.errorMessage() == null ? "" : common.errorMessage();
            // 너무 빨리 불렀다는 거절 — 간격을 벌리고 잠깐 기다렸다 같은 것을 다시 묻는다.
            // 거듭 거절되면 잠깐의 오류로 넘긴다(가게는 그대로 남아 다음에 다시 묻는다). "못 찾음"으로도 "거절"로도 치지 않는다
            if (code.equals(TOO_FAST)) {
                pace.refused(startedAt, attempt);
                if (attempt < BUSY_ATTEMPTS) continue;
                throw new IllegalStateException(code + " " + message);
            }
            // 시스템 오류 — 잠깐 뒤 다시 물어볼 일
            if (code.equals("-999")) throw new IllegalStateException(code + " " + message);
            // 검색어로 못 알아본 것(주소를 더 자세히, 너무 긴 검색어, 허용되지 않는 글자 등) — 그 주소만 못 찾은 것이다
            if (QUERY_PROBLEMS.contains(code)) return List.of();
            // 그 밖은 전부 거절로 본다: 승인키 문제, 그리고 모르는 오류.
            // 모르는 오류를 "못 찾음"으로 넘기면 그 순간부터 모든 가게가 못 찾은 것으로 처리되어
            // 좌표가 한꺼번에 인허가 좌표로 밀려난다 — 가게는 그대로 두고 다음에 다시 묻는다
            throw new GeocodeBackfill.Unavailable(code + " " + message);
        }
    }

    // 설정으로 하루 한도를 걸었을 때만 센다 (0 = 없음). 도로명주소 API에 하루 건수 제한은 없다
    private synchronized void countCall() {
        LocalDate today = LocalDate.now(KST);
        if (!today.equals(countedDay)) {
            countedDay = today;
            callsToday = 0;
        }
        if (dailyCalls > 0 && callsToday >= dailyCalls) {
            throw new GeocodeBackfill.Unavailable("오늘 쓸 호출 수(" + dailyCalls + "건)를 다 썼어요 — 내일 이어서 해요");
        }
        callsToday++;
    }

    /**
     * 한 API를 부르는 간격. 도로명주소 API는 짧은 시간에 많이 부르면 E0007로 거절하는데 기준이 공개돼 있지 않다.
     * 그래서 거절당하면 간격을 벌리고, 잘 되는 동안에는 아주 조금씩 좁혀서 API가 받아 주는 가장 빠른 속도 근처에 머문다.
     */
    static final class Pace {
        private final String name;
        private final double floorMillis;
        private final long cooldownMillis;
        private double intervalMillis;
        private double nextAt;
        private long lastSlowedAt;

        Pace(String name, long startMillis, long floorMillis, long cooldownMillis) {
            this.name = name;
            this.intervalMillis = Math.max(startMillis, floorMillis);
            this.floorMillis = floorMillis;
            this.cooldownMillis = cooldownMillis;
        }

        /** 내 차례까지 기다린다. 요청을 보내는 시각을 돌려준다 */
        long await() {
            long wait;
            synchronized (this) {
                double now = System.currentTimeMillis();
                double at = Math.max(now, nextAt);
                nextAt = at + intervalMillis;
                wait = (long) (at - now);
            }
            if (wait > 0) {
                try {
                    Thread.sleep(wait);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("interrupted");
                }
            }
            return System.currentTimeMillis();
        }

        // 간격이 실제로 속도를 붙잡고 있을 때만 좁힌다. 천천히 — 한 번 벌어진 간격(1.25배)이 돌아오는 데 1,100번쯤 걸려서
        // 거절당하는 일이 몇 분에 한 번을 넘지 않는다
        synchronized void succeeded() {
            if (nextAt > System.currentTimeMillis()) intervalMillis = Math.max(floorMillis, intervalMillis * 0.9998);
        }

        synchronized void refused(long startedAt, int attempt) {
            long now = System.currentTimeMillis();
            // 같은 때 나간 요청들이 한꺼번에 거절되거나, 풀리기 전에 다시 물어 또 거절돼도 한 번만 벌린다
            if (startedAt > lastSlowedAt && now - lastSlowedAt > SLOW_DOWN_AT_MOST_EVERY_MILLIS) {
                intervalMillis = Math.min(10_000, Math.max(intervalMillis, 40) * 1.25);
                lastSlowedAt = now;
                log.info("도로명주소 API({})가 요청이 많다고 거절 — 간격을 {}ms로 벌림", name, Math.round(intervalMillis));
            }
            // 풀릴 때까지 모두 쉰다. 거듭 거절될수록 더 오래
            nextAt = Math.max(nextAt, now + (double) cooldownMillis * attempt);
        }

        synchronized long intervalMillis() {
            return Math.round(intervalMillis);
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
