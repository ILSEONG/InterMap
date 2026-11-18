package com.intermap.backend.restaurant;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 도로명주소 API를 흉내 내는 작은 서버에 대고 확인한다 (실제 API는 부르지 않는다)
class JusoGeocoderTest {

    private HttpServer server;
    private final List<String> searches = new CopyOnWriteArrayList<>();
    private final List<String> coords = new CopyOnWriteArrayList<>();
    private volatile String searchBody;
    private volatile String coordBody;

    private static final String OK = "\"common\":{\"errorMessage\":\"정상\",\"countPerPage\":\"10\",\"totalCount\":\"1\",\"errorCode\":\"0\",\"currentPage\":\"1\"}";

    private static String building(String road, String lot, String mainNo) {
        return "{\"roadAddr\":\"" + road + " (어떤동)\",\"roadAddrPart1\":\"" + road + "\",\"jibunAddr\":\"" + lot + "\","
            + "\"admCd\":\"1114010300\",\"rnMgtSn\":\"111402005001\",\"udrtYn\":\"0\",\"buldMnnm\":\"" + mainNo + "\","
            + "\"buldSlno\":\"0\",\"bdMgtSn\":\"1114010300100310000019718\",\"zipNo\":\"04524\"}";
    }

    private static String found(String... buildings) {
        return "{\"results\":{" + OK + ",\"juso\":[" + String.join(",", buildings) + "]}}";
    }

    private static String failed(String code, String message) {
        return "{\"results\":{\"common\":{\"errorMessage\":\"" + message + "\",\"totalCount\":\"0\",\"errorCode\":\"" + code + "\"},\"juso\":null}}";
    }

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/addrlink/addrLinkApi.do", exchange -> answer(exchange, searches, searchBody));
        server.createContext("/addrlink/addrCoordApi.do", exchange -> answer(exchange, coords, coordBody));
        server.start();
        // 서울시청 근처 한 점 (UTM-K) — WGS84로 약 37.566495, 126.978001
        coordBody = "{\"results\":{" + OK + ",\"juso\":[{\"admCd\":\"1114010300\",\"rnMgtSn\":\"111402005001\","
            + "\"udrtYn\":\"0\",\"buldMnnm\":\"110\",\"buldSlno\":\"0\",\"entX\":\"953901.25\",\"entY\":\"1952031.50\",\"bdNm\":\"서울특별시청\"}]}}";
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private static void answer(HttpExchange exchange, List<String> seen, String body) throws IOException {
        seen.add(exchange.getRequestURI().getQuery());
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json;charset=UTF-8");
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private JusoGeocoder geocoder(int dailyCalls) {
        return new JusoGeocoder("http://127.0.0.1:" + server.getAddress().getPort() + "/addrlink",
            "search-key", "coord-key", dailyCalls, 0);
    }

    @Test
    void findsTheBuildingAndConvertsItsCoordinates() {
        searchBody = found(
            building("서울특별시 중구 세종대로 1100", "서울특별시 중구 어떤동 1", "1100"),
            building("서울특별시 중구 세종대로 110", "서울특별시 중구 태평로1가 31 서울특별시청", "110"));

        Optional<double[]> p = geocoder(1000).locate("서울특별시 중구 세종대로 110, 1층 (태평로1가)", "서울특별시 중구 태평로1가 31");

        assertTrue(p.isPresent());
        assertEquals(37.566495, p.get()[0], 1e-4);
        assertEquals(126.978001, p.get()[1], 1e-4);
        // 층·동 이름을 뗀 주소로 묻고, 검색 키와 좌표 키를 각각 쓴다
        assertTrue(searches.get(0).contains("keyword=서울특별시 중구 세종대로 110"), searches.get(0));
        assertFalse(searches.get(0).contains("1층"));
        assertTrue(searches.get(0).contains("confmKey=search-key"));
        assertTrue(searches.get(0).contains("resultType=json"));
        String coord = coords.get(0);
        assertTrue(coord.contains("confmKey=coord-key"), coord);
        assertTrue(coord.contains("admCd=1114010300") && coord.contains("rnMgtSn=111402005001")
            && coord.contains("udrtYn=0") && coord.contains("buldMnnm=110") && coord.contains("buldSlno=0"), coord);
    }

    @Test
    void anotherBuildingOnTheSameRoadIsNotAccepted() {
        searchBody = found(building("서울특별시 중구 세종대로 1100", "서울특별시 중구 어떤동 1", "1100"));

        assertTrue(geocoder(1000).locate("서울특별시 중구 세종대로 110", null).isEmpty());
        assertTrue(coords.isEmpty(), "건물이 안 맞으면 좌표는 묻지 않는다");
    }

    @Test
    void lotAddressMatchesUpToTheLotNumber() {
        searchBody = found(
            building("서울특별시 마포구 어떤길 1", "서울특별시 마포구 서교동 395-171 다른빌딩", "1"),
            building("서울특별시 마포구 어떤길 7", "서울특별시 마포구 서교동 395-17 서교빌딩", "7"));

        assertTrue(geocoder(1000).locate(null, "서울특별시 마포구 서교동 395-17 2층").isPresent());
        assertTrue(searches.get(0).contains("keyword=서울특별시 마포구 서교동 395-17"));
        assertTrue(coords.get(0).contains("buldMnnm=7"), coords.get(0));
    }

    @Test
    void theSameAddressIsAskedOnce() {
        searchBody = found(building("서울특별시 중구 세종대로 110", "서울특별시 중구 태평로1가 31", "110"));
        JusoGeocoder geocoder = geocoder(1000);

        geocoder.locate("서울특별시 중구 세종대로 110, 1층", null);
        geocoder.locate("서울특별시 중구 세종대로 110, 지하1층", null);

        assertEquals(1, searches.size());
        assertEquals(1, coords.size());
    }

    @Test
    void rejectedKeyStopsTheRun() {
        searchBody = failed("E0001", "승인되지 않은 KEY 입니다.");

        assertThrows(GeocodeBackfill.Unavailable.class, () -> geocoder(1000).locate("서울특별시 중구 세종대로 110", null));
    }

    @Test
    void unreadableQueryCountsAsNotFound() {
        searchBody = failed("E0006", "주소를 상세히 입력해 주시기 바랍니다.");

        assertTrue(geocoder(1000).locate("서울특별시 중구 세종대로 110", null).isEmpty());
    }

    @Test
    void refusedAddressIsSkippedButServerTroubleIsNot() {
        JusoGeocoder geocoder = geocoder(1000);
        server.removeContext("/addrlink/addrLinkApi.do");
        server.createContext("/addrlink/addrLinkApi.do", exchange -> {
            int status = exchange.getRequestURI().getQuery().contains("거절") ? 400 : 503;
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });

        assertTrue(geocoder.locate("서울특별시 중구 거절로 1", null).isEmpty(), "그 주소만 거절되면 못 찾은 것으로 넘어간다");
        assertThrows(RuntimeException.class, () -> geocoder.locate("서울특별시 중구 세종대로 110", null),
            "서버가 안 되는 건 다음에 다시 물어볼 일");
    }

    @Test
    void dailyBudgetStopsTheRun() {
        searchBody = found(building("서울특별시 중구 세종대로 110", "서울특별시 중구 태평로1가 31", "110"));
        JusoGeocoder geocoder = geocoder(2);

        assertTrue(geocoder.locate("서울특별시 중구 세종대로 110", null).isPresent());
        assertThrows(GeocodeBackfill.Unavailable.class, () -> geocoder.locate("서울특별시 중구 세종대로 120", null));
        assertEquals(1, searches.size(), "한도를 넘으면 더 부르지 않는다");
    }

    @Test
    void needsBothKeys() {
        assertTrue(geocoder(1).isConfigured());
        assertFalse(new JusoGeocoder("http://localhost", "search-key", "", 1, 0).isConfigured());
        assertFalse(new JusoGeocoder("http://localhost", "", "coord-key", 1, 0).isConfigured());
    }
}
