package com.intermap.backend.localdata;

import com.intermap.backend.restaurant.GeocodeBackfill;
import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import com.intermap.backend.state.ServerState;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 카페 처음 받아 오기: 휴게음식점·제과점영업의 영업중 가게 가운데 카페만 넣고, 구 단위로 이어서 한다.
@SpringBootTest(properties = "admin.password=test-admin-password")
@Transactional
class CafeImportTest {

    // 실제 인허가 좌표 샘플 (서울 마포구 서교동)
    private static final String X = "192882.950546117";
    private static final String Y = "449785.876729486";
    private static final String LOT = "서울 마포구 서교동 1";

    @Autowired RestaurantRepository repository;
    @Autowired GeocodeBackfill geocode;
    @Autowired ServerState state;

    private final String tag = UUID.randomUUID().toString().substring(0, 8);
    // 다른 테스트와 겹치지 않는 가짜 구 코드 둘
    private final String guA = "A" + tag;
    private final String guB = "B" + tag;
    private final Map<String, List<LocalDataClient.Row>> open = new HashMap<>();
    private final List<String> calls = new ArrayList<>();
    // 이 (종류:구)를 부르면 실패한다
    private String failing;

    private CafeImport cafeImport() {
        LocalDataClient client = new LocalDataClient("test-key") {
            @Override
            public List<Row> fetchAllOpen(Service service, String localCode) {
                String key = service.path() + ":" + localCode;
                calls.add(key);
                if (key.equals(failing)) throw new IllegalStateException("활용신청 전");
                return List.copyOf(open.getOrDefault(key, List.of()));
            }
        };
        return new CafeImport(client, repository, geocode, state, guA + ", " + guB);
    }

    private void rows(LocalDataClient.Service service, String gu, LocalDataClient.Row... rows) {
        open.put(service.path() + ":" + gu, List.of(rows));
    }

    private String name(String base) {
        return base + tag;
    }

    private String addr(int number) {
        return "서울특별시 마포구 카페로" + tag + " " + number;
    }

    private static LocalDataClient.Row row(String mgtNo, String name, String roadAddr, String category, String x, String y) {
        return new LocalDataClient.Row(mgtNo, name, roadAddr, LOT, category, x, y, "01", null);
    }

    private boolean has(String name, int number) {
        return repository.findFirstByNameAndRoadAddress(name(name), addr(number)).isPresent();
    }

    @Test
    void addsOnlyCafesAndOnlyOnce() {
        Restaurant sameNameAddr = repository.saveAndFlush(new Restaurant(name("이미있는 카페"), "까페", addr(1), LOT, 37.55, 126.92));
        Restaurant sameMgtNo = new Restaurant(name("옛이름 카페"), "까페", addr(2), LOT, 37.55, 126.92);
        sameMgtNo.markStatus(Restaurant.Status.OPEN, "RC-KNOWN-" + tag);
        repository.saveAndFlush(sameMgtNo);

        rows(LocalDataClient.Service.REST_CAFE, guA,
                row("RC-1-" + tag, name("모모"), addr(3), "커피숍", X, Y),
                row("RC-2-" + tag, name("컴포즈커피 시험점"), addr(4), "기타 휴게음식점", X, Y),
                row("RC-3-" + tag, name("지에스25 시험점"), addr(5), "편의점", X, Y),
                row("RC-4-" + tag, name("버거킹 시험점"), addr(6), "패스트푸드", X, Y),
                row("RC-5-" + tag, name("작심 스터디카페"), addr(7), "기타 휴게음식점", X, Y),
                row("RC-6-" + tag, name("좌표없는 커피"), addr(8), "커피숍", "", ""),
                row("RC-7-" + tag, name("이미있는 카페"), addr(1), "커피숍", X, Y),
                row("RC-KNOWN-" + tag, name("새이름 카페"), addr(2), "커피숍", X, Y),
                row("RC-8-" + tag, name("빵굽는 커피집"), addr(9), "커피숍", X, Y));
        rows(LocalDataClient.Service.REST_CAFE, guB,
                row("RC-9-" + tag, name("젤라또 모모"), addr(10), "아이스크림", X, Y));
        rows(LocalDataClient.Service.BAKERY, guA,
                row("BK-1-" + tag, name("성심당"), addr(11), "", X, Y),
                row("BK-2-" + tag, name("빵굽는 커피집"), addr(9), "", X, Y));

        CafeImport cafes = cafeImport();
        assertEquals(4, cafes.pendingCount(), "두 종류 × 두 구");
        CafeImport.Result result = cafes.runPending();

        assertEquals(12, result.fetched());
        assertEquals(5, result.added(), "모모, 컴포즈, 빵굽는 커피집, 젤라또, 성심당");
        Restaurant coffee = repository.findFirstByNameAndRoadAddress(name("모모"), addr(3)).orElseThrow();
        assertEquals("CAFE", coffee.getCuisine());
        assertEquals("COFFEE", coffee.getCafeKind());
        assertEquals("커피숍", coffee.getCategory());
        assertEquals("RC-1-" + tag, coffee.getLocalDataMgtNo());
        assertEquals(Restaurant.Status.OPEN, coffee.getStatus());
        assertTrue(coffee.getLat() > 37.5 && coffee.getLat() < 37.6, "인허가 좌표를 위경도로 바꿔 넣는다");
        assertTrue(has("컴포즈커피 시험점", 4), "업태가 '기타'여도 이름이 커피면 카페");
        assertEquals("DESSERT", repository.findFirstByNameAndRoadAddress(name("젤라또 모모"), addr(10)).orElseThrow().getCafeKind());
        Restaurant bakery = repository.findFirstByNameAndRoadAddress(name("성심당"), addr(11)).orElseThrow();
        assertEquals("제과점", bakery.getCategory(), "제과점영업은 업태가 비어 있어도 빵집이다");
        assertEquals("BAKERY", bakery.getCafeKind());
        assertTrue(!has("지에스25 시험점", 5) && !has("버거킹 시험점", 6), "편의점·패스트푸드는 넣지 않는다");
        assertTrue(!has("작심 스터디카페", 7), "스터디카페는 넣지 않는다");
        assertTrue(!has("좌표없는 커피", 8), "좌표가 없으면 넣지 않는다");
        assertTrue(!has("새이름 카페", 2), "관리번호가 같은 가게가 이미 있으면 넣지 않는다");
        assertEquals(sameNameAddr.getId(), repository.findFirstByNameAndRoadAddress(name("이미있는 카페"), addr(1)).orElseThrow().getId(),
                "상호와 주소가 같은 가게가 이미 있으면 넣지 않는다");

        // 다 받았으면 다시 부르지 않는다
        assertEquals(0, cafes.pendingCount());
        calls.clear();
        assertEquals(new CafeImport.Result(0, 0), cafeImport().runPending());
        assertEquals(List.of(), calls);
    }

    // 활용신청 전이거나 API가 잠깐 죽었을 때: 받은 데까지만 남기고, 다음에 남은 것만 이어서 받는다
    @Test
    void stopsWhereTheApiFailsAndPicksUpFromThereLater() {
        rows(LocalDataClient.Service.REST_CAFE, guA, row("RC-A-" + tag, name("모모A"), addr(21), "커피숍", X, Y));
        rows(LocalDataClient.Service.REST_CAFE, guB, row("RC-B-" + tag, name("모모B"), addr(22), "커피숍", X, Y));
        rows(LocalDataClient.Service.BAKERY, guA, row("BK-A-" + tag, name("성심당A"), addr(23), "", X, Y));
        failing = "rest_cafes:" + guB;

        CafeImport.Result first = cafeImport().runPending();

        assertEquals(1, first.added());
        assertTrue(has("모모A", 21));
        assertTrue(!has("모모B", 22) && !has("성심당A", 23), "못 받은 구부터는 멈춘다");
        assertEquals(List.of("rest_cafes:" + guA, "rest_cafes:" + guB), calls);
        assertEquals(3, cafeImport().pendingCount(), "못 받은 구를 받은 것으로 적어 두지 않는다");

        failing = null;
        calls.clear();
        CafeImport.Result second = cafeImport().runPending();

        assertEquals(2, second.added());
        assertTrue(has("모모B", 22) && has("성심당A", 23));
        assertEquals(List.of("rest_cafes:" + guB, "bakeries:" + guA, "bakeries:" + guB), calls, "이미 받은 구는 다시 부르지 않는다");
        assertEquals(0, cafeImport().pendingCount());
    }
}
