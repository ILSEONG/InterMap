package com.intermap.backend.restaurant;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 가게 검색(/api/restaurants?q=) — 낱말마다 이름·업종·주소 중 어디든 들어 있으면 걸린다.
// 같은 검사를 H2(RestaurantSearchTest)와 실제 PostgreSQL(RestaurantSearchPostgresTest)에서 돌린다.
abstract class RestaurantSearchChecks {

    @Autowired RestaurantController controller;
    @Autowired RestaurantRepository repository;

    // 다른 테스트의 가게와 섞이지 않게 이름에 붙이는 꼬리표 (영문 소문자·숫자 — 대소문자 무시도 같이 본다)
    private final String tag = "s" + UUID.randomUUID().toString().substring(0, 8);
    private final List<Restaurant> saved = new ArrayList<>();

    @AfterEach
    void cleanUp() {
        repository.deleteAll(saved);
    }

    private Restaurant place(String name, String category, String roadAddress, String address) {
        Restaurant r = repository.save(new Restaurant(name, category, roadAddress, address, 37.5, 127.0));
        saved.add(r);
        return r;
    }

    private List<Long> search(String q) {
        return search(q, null);
    }

    private List<Long> search(String q, String cuisine) {
        ResponseEntity<List<RestaurantController.ListItem>> res = controller.list(null, null, null, null, q, cuisine);
        return res.getBody().stream().map(RestaurantController.ListItem::id).toList();
    }

    // 카페 화면의 검색: 같은 낱말이라도 카페만
    @Test
    void aCuisineNarrowsTheSearch() {
        Restaurant cafe = place("모모커피 " + tag, "커피숍", "서울특별시 중구 검색길 1", "서울특별시 중구 검색동 1");
        Restaurant sushi = place("모모스시 " + tag, "일식", "서울특별시 중구 검색길 2", "서울특별시 중구 검색동 2");

        assertEquals(List.of(cafe.getId(), sushi.getId()), search(tag));
        assertEquals(List.of(cafe.getId()), search(tag, "CAFE"));
        assertEquals(List.of(sushi.getId()), search(tag, " JAPANESE "));
        assertEquals(List.of(cafe.getId(), sushi.getId()), search(tag, "없는업종"), "모르는 코드는 없는 셈 친다");
    }

    @Test
    void aPlaceWordPicksTheBranchInThatNeighborhood() {
        Restaurant yeouido = place("타마" + tag, "일식", "서울특별시 영등포구 국제금융로 10", "서울특별시 영등포구 여의도동 23");
        Restaurant yeoksam = place("타마" + tag, "일식", "서울특별시 강남구 테헤란로 1", "서울특별시 강남구 역삼동 1");

        assertEquals(List.of(yeouido.getId(), yeoksam.getId()), search("타마" + tag), "이름만 치면 둘 다");
        assertEquals(List.of(yeouido.getId()), search("타마" + tag + " 여의도"), "지번 주소의 동 이름");
        assertEquals(List.of(yeouido.getId()), search("여의도   타마" + tag), "낱말 순서와 띄어쓰기 개수는 상관없다");
        assertEquals(List.of(yeouido.getId()), search("타마" + tag + " 국제금융로"), "도로명");
        assertEquals(List.of(yeoksam.getId()), search("타마" + tag + " 강남구 일식"), "구 이름과 업종");
        assertEquals(List.of(), search("타마" + tag + " 마포"), "낱말 하나라도 안 맞으면 없다");
    }

    @Test
    void lettersMatchInEitherCase() {
        Restaurant r = place("Tama " + tag, "일식", "서울특별시 중구 검색길 1", "서울특별시 중구 검색동 1");
        assertEquals(List.of(r.getId()), search("tAMa " + tag.toUpperCase()));
    }

    @Test
    void namesComeBeforePlacesThatOnlyMatchByAddress() {
        // 먼저 저장한(id가 작은) 가게는 주소로만 걸리고, 나중 가게는 이름으로 걸린다 — 이름으로 걸린 쪽이 앞에 와야 한다
        Restaurant byAddress = place("국수집", "한식", "서울특별시 중구 " + tag + "길 1", "서울특별시 중구 검색동 1");
        Restaurant byName = place(tag + " 본점", "한식", "서울특별시 중구 검색길 2", "서울특별시 중구 검색동 2");
        assertEquals(List.of(byName.getId(), byAddress.getId()), search(tag));
    }

    @Test
    void percentAndUnderscoreAreOrdinaryLetters() {
        Restaurant plain = place("가나" + tag, "한식", "서울특별시 중구 검색길 3", "서울특별시 중구 검색동 3");
        Restaurant percent = place("50%" + tag, "한식", "서울특별시 중구 검색길 4", "서울특별시 중구 검색동 4");
        assertEquals(List.of(), search("가_" + tag), "_가 '아무 글자'로 통하면 안 된다");
        assertEquals(List.of(percent.getId()), search("0%" + tag), "%는 글자 그대로 찾는다");
        assertEquals(List.of(plain.getId()), search("가나" + tag));
    }

    @Test
    void missingCategoryOrAddressDoesNotHideAPlace() {
        Restaurant bare = place("빈칸" + tag, null, null, "서울특별시 중구 검색동 5");
        assertEquals(List.of(bare.getId()), search("빈칸" + tag + " 검색동"));
    }

    @Test
    void closedPlacesAreLeftOut() {
        Restaurant open = place("폐업시험" + tag, "한식", "서울특별시 중구 검색길 6", "서울특별시 중구 검색동 6");
        Restaurant closed = place("폐업시험" + tag, "한식", "서울특별시 중구 검색길 7", "서울특별시 중구 검색동 7");
        closed.markStatus(Restaurant.Status.CLOSED, null);
        repository.save(closed);
        assertEquals(List.of(open.getId()), search("폐업시험" + tag));
    }

    @Test
    void wordsBeyondTheFourthAreIgnored() {
        assertEquals(List.of("A", "B", "C", "D"), RestaurantSearch.words("  a b  c d e f "));
        assertTrue(RestaurantSearch.words("   ").isEmpty());
        assertEquals(List.of("!%", "!_", "!!"), RestaurantSearch.words("% _ !"));
    }
}
