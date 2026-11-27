package com.intermap.backend.localdata;

import com.intermap.backend.restaurant.Cuisine;
import com.intermap.backend.restaurant.GeocodeBackfill;
import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import com.intermap.backend.state.ServerState;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 휴게음식점으로 등록한 식당 받아 오기: 받는 업태이고 상가(상권)정보에 음식점으로 잡힌 곳만 넣고, 구 단위로 이어서 한다.
@SpringBootTest(properties = "admin.password=test-admin-password")
@Transactional
class RestEateryImportTest {

    // 실제 인허가 좌표 샘플 (서울 마포구 서교동)
    private static final String X = "192882.950546117";
    private static final String Y = "449785.876729486";
    private static final String LOT = "서울 마포구 서교동 1";

    @Autowired RestaurantRepository repository;
    @Autowired GeocodeBackfill geocode;
    @Autowired ServerState state;

    private final String tag = UUID.randomUUID().toString().substring(0, 8);
    private final String guA = "EA" + tag;
    private final String guB = "EB" + tag;
    private final Map<String, List<LocalDataClient.Row>> open = new HashMap<>();
    private final List<String> calls = new ArrayList<>();
    // 이 구를 이만큼 실패시킨다
    private String failing;
    private int failTimes;

    private RestEateryImport eateryImport() {
        LocalDataClient client = new LocalDataClient("test-key") {
            @Override
            public List<Row> fetchAllOpen(Service service, String localCode) {
                calls.add(service.path() + ":" + localCode);
                if (localCode.equals(failing) && failTimes-- > 0) throw new IllegalStateException("시간 초과");
                return List.copyOf(open.getOrDefault(localCode, List.of()));
            }
        };
        RestEateryImport out = new RestEateryImport(client, repository, geocode, state, guA + ", " + guB);
        // 상가에 음식점으로 잡힌 곳 — 이름에 '상가'가 든 가게만 짝이 있다고 친다
        out.sbizSource = () -> (name, road, lot) -> name.contains("상가") ? "김밥/만두/분식" : null;
        out.fetchPause = Duration.ZERO;
        return out;
    }

    private String name(String base) {
        return base + tag;
    }

    private String addr(int number) {
        return "서울특별시 마포구 식당로" + tag + " " + number;
    }

    private static LocalDataClient.Row row(String mgtNo, String name, String roadAddr, String category, String x, String y) {
        return new LocalDataClient.Row(mgtNo, name, roadAddr, LOT, category, x, y, "01", null);
    }

    private boolean has(String name, int number) {
        return repository.findFirstByNameAndRoadAddress(name(name), addr(number)).isPresent();
    }

    @Test
    void addsOnlyEateriesKnownToTheShopData() {
        repository.saveAndFlush(new Restaurant(name("이미있는 상가분식"), "분식", addr(1), LOT, 37.55, 126.92));
        open.put(guA, List.of(
                row("RE-1-" + tag, name("샤브토랑 상가점"), addr(2), "기타 휴게음식점", X, Y),
                row("RE-2-" + tag, name("별빛 피씨방"), addr(3), "기타 휴게음식점", X, Y),
                row("RE-3-" + tag, name("씨유 상가점"), addr(4), "편의점", X, Y),
                row("RE-4-" + tag, name("좌표없는 상가김밥"), addr(5), "일반조리판매", "", ""),
                row("RE-5-" + tag, name("이미있는 상가분식"), addr(1), "일반조리판매", X, Y),
                row("RE-6-" + tag, name("상가버거"), addr(6), "패스트푸드", X, Y)));
        open.put(guB, List.of(
                row("RE-1-" + tag, name("샤브토랑 상가점"), addr(2), "기타 휴게음식점", X, Y),
                row("RE-7-" + tag, name("상가 토스트"), addr(7), "일반조리판매", X, Y)));

        RestEateryImport eateries = eateryImport();
        assertEquals(2, eateries.pendingCount());
        RestEateryImport.Result result = eateries.runPending();

        assertEquals(8, result.fetched());
        assertEquals(3, result.added(), "샤브토랑, 상가버거, 상가 토스트 — 두 구에 다 있어도 한 번만");
        Restaurant shabu = repository.findFirstByNameAndRoadAddress(name("샤브토랑 상가점"), addr(2)).orElseThrow();
        assertEquals("기타 휴게음식점", shabu.getCategory());
        assertEquals("김밥/만두/분식", shabu.getSbizCategory(), "짝지은 상가 소분류를 같이 적는다");
        assertEquals(Cuisine.of(shabu.getName(), "김밥/만두/분식", "기타 휴게음식점"), shabu.getCuisine());
        assertEquals("RE-1-" + tag, shabu.getLocalDataMgtNo());
        assertEquals(Restaurant.Status.OPEN, shabu.getStatus());
        assertTrue(shabu.getLat() > 37.5 && shabu.getLat() < 37.6, "인허가 좌표를 위경도로 바꿔 넣는다");
        assertTrue(has("상가버거", 6) && has("상가 토스트", 7));
        assertTrue(!has("별빛 피씨방", 3), "상가에 음식점으로 잡히지 않은 곳은 넣지 않는다");
        assertTrue(!has("씨유 상가점", 4), "편의점은 상가와 짝지어져도 넣지 않는다");
        assertTrue(!has("좌표없는 상가김밥", 5), "좌표가 없으면 넣지 않는다");

        // 다 받았으면 다시 부르지 않는다
        assertEquals(0, eateries.pendingCount());
        calls.clear();
        assertEquals(new RestEateryImport.Result(0, 0), eateryImport().runPending());
        assertEquals(List.of(), calls);
    }

    @Test
    void retriesASlowDistrictAndPicksUpWhereItStopped() {
        open.put(guA, List.of(row("RE-A-" + tag, name("상가분식A"), addr(1), "일반조리판매", X, Y)));
        open.put(guB, List.of(row("RE-B-" + tag, name("상가분식B"), addr(2), "일반조리판매", X, Y)));

        // 잠깐 늦는 구는 그 구만 다시 불러 끝낸다
        failing = guA;
        failTimes = 2;
        assertEquals(new RestEateryImport.Result(2, 2), eateryImport().runPending());

        // 끝내 못 받은 구는 남겨 두고, 다음에 그 구만 받는다
        state.remove("rest-eatery-import", guB);
        open.put(guB, List.of(row("RE-B2-" + tag, name("상가분식B2"), addr(3), "일반조리판매", X, Y)));
        failing = guB;
        failTimes = 99;
        RestEateryImport stuck = eateryImport();
        assertEquals(new RestEateryImport.Result(0, 0), stuck.runPending());
        assertEquals(1, stuck.pendingCount());
        failing = null;
        calls.clear();
        assertEquals(new RestEateryImport.Result(1, 1), eateryImport().runPending());
        assertEquals(List.of("rest_cafes:" + guB), calls);
        assertTrue(has("상가분식B2", 3));
    }
}
