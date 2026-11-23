package com.intermap.backend.restaurant;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.review.Review;
import com.intermap.backend.review.ReviewController;
import com.intermap.backend.review.ReviewRepository;
import com.intermap.backend.state.ServerState;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 가게 업종 채우기 — 상가(상권)정보와 짝지어 소분류를 적고 업종을 정한다. 목록·요약·후기 응답에도 그 업종이 실린다.
@SpringBootTest
class CuisineBackfillTest {

    @Autowired CuisineBackfill backfill;
    @Autowired RestaurantRepository repository;
    @Autowired RestaurantController controller;
    @Autowired ReviewController reviewController;
    @Autowired ReviewRepository reviews;
    @Autowired AppUserRepository users;
    @Autowired ServerState state;

    // 숫자만 — 영문이 섞이면 우연히 업종 낱말("cafe")이 될 수 있다
    private final String tag = String.valueOf(ThreadLocalRandom.current().nextInt(10_000_000, 99_999_999));
    // 다른 테스트의 가게가 없는 자리 (제주 남쪽 바다 어딘가)
    private final double lat = 32.0 + ThreadLocalRandom.current().nextInt(1, 900) / 1000.0;
    private final double lng = 126.0 + ThreadLocalRandom.current().nextInt(1, 900) / 1000.0;

    private final List<Restaurant> savedPlaces = new ArrayList<>();
    private final List<Review> savedReviews = new ArrayList<>();

    @AfterEach
    void cleanUp() {
        reviews.deleteAll(savedReviews);
        repository.deleteAll(savedPlaces);
    }

    private Restaurant place(String name, String category, int building) {
        Restaurant r = repository.save(new Restaurant(name + tag, category,
                "서울특별시 강남구 시험로" + tag + "길 " + building + ", 2층 (역삼동)", "서울특별시 강남구 역삼동 " + tag + "-" + building, lat, lng));
        savedPlaces.add(r);
        return r;
    }

    // 상가 파일 한 줄 — 위 place와 같은 건물
    private String sbiz(String name, String category, int building) {
        return name + tag + ",," + category + ",서울특별시 강남구 시험로" + tag + "길 " + building + ",서울특별시 강남구 역삼동 " + tag + "-" + building;
    }

    private Restaurant reload(Restaurant r) {
        return repository.findById(r.getId()).orElseThrow();
    }

    @Test
    void fillsTheSbizCategoryAndTheCuisine() {
        Restaurant sushi = place("가나다", "기타", 1);
        Restaurant plain = place("라마바", "한식", 2);
        Restaurant noodle = place("할매칼국수", "한식", 3);
        assertNull(sushi.getCuisine(), "인허가 업종이 '기타'고 이름에도 단서가 없으면 처음엔 업종이 없다");
        assertEquals("KOREAN", plain.getCuisine(), "새 가게는 이름과 인허가 업종만으로 먼저 정해진다");
        assertEquals("NOODLE", noodle.getCuisine());

        SbizPlaces places = SbizPlacesTest.places(
                sbiz("가나다", "일식 회/초밥", 1),
                sbiz("전혀다른집", "카페", 2),
                sbiz("할매칼국수", "백반/한정식", 3));
        CuisineBackfill.Result first = backfill.fill(places);
        assertTrue(first.changed() >= 2 && first.matched() >= 2, first.toString());

        assertEquals("일식 회/초밥", reload(sushi).getSbizCategory());
        assertEquals("JAPANESE", reload(sushi).getCuisine(), "'기타'였던 가게가 상가 소분류로 업종을 얻는다");
        assertNull(reload(plain).getSbizCategory(), "같은 건물이어도 이름이 다르면 짝이 아니다");
        assertEquals("KOREAN", reload(plain).getCuisine());
        assertEquals("백반/한정식", reload(noodle).getSbizCategory());
        assertEquals("NOODLE", reload(noodle).getCuisine(), "이름의 낱말이 뭉뚱그린 소분류보다 앞선다");

        assertEquals(0, backfill.fill(places).changed(), "다시 돌리면 고칠 게 없다");

        // 상가 파일이 없는 빌드에서는 전에 짝지은 소분류를 지우지 않는다
        backfill.fill(SbizPlacesTest.places());
        assertEquals("일식 회/초밥", reload(sushi).getSbizCategory());
        assertEquals("JAPANESE", reload(sushi).getCuisine());
    }

    @Test
    void listSummaryAndReviewsCarryTheCuisine() {
        Restaurant sushi = place("가나다", "기타", 1);
        Restaurant plain = place("라마바", "한식", 2);
        Restaurant noodle = place("할매칼국수", "한식", 3);
        backfill.fill(SbizPlacesTest.places(sbiz("가나다", "일식 회/초밥", 1)));

        double d = 0.0005;
        Map<Long, String> listed = controller.list(lat - d, lat + d, lng - d, lng + d, null).getBody().stream()
                .collect(Collectors.toMap(RestaurantController.ListItem::id, i -> String.valueOf(i.cuisine())));
        assertEquals(Map.of(sushi.getId(), "JAPANESE", plain.getId(), "KOREAN", noodle.getId(), "NOODLE"), listed);

        assertEquals(3, counted(null));
        assertEquals(1, counted("JAPANESE"));
        assertEquals(2, counted("KOREAN, NOODLE"));
        assertEquals(0, counted("CAFE"));
        assertEquals(1, counted("JAPANESE,없는업종"), "모르는 코드는 버린다");
        assertEquals(0, counted("없는업종"), "아는 코드가 하나도 없으면 아무것도 세지 않는다 (전부 세지 않는다)");

        AppUser me = users.save(new AppUser("cuisine" + tag + "@test.local", null, "업종" + tag, null));
        String token = UUID.randomUUID().toString();
        me.issueToken(token);
        users.save(me);
        Review atSushi = review(me, sushi.getName(), "기타", sushi.getRoadAddress());
        Review unlisted = review(me, "목록에없는 김밥" + tag, "기타", "서울특별시 강남구 없는길 " + tag);
        Review unknown = review(me, "목록에없는집" + tag, "기타", "서울특별시 강남구 없는길 " + tag);
        Map<Long, ReviewController.Item> seen = reviewController.list("Bearer " + token).stream()
                .collect(Collectors.toMap(ReviewController.Item::id, i -> i));
        assertEquals("JAPANESE", seen.get(atSushi.getId()).restaurant().cuisine(), "가게에 채워 둔 업종");
        assertEquals("SNACK", seen.get(unlisted.getId()).restaurant().cuisine(), "목록에 없는 가게는 후기에 적힌 이름과 업종으로");
        assertNull(seen.get(unknown.getId()).restaurant().cuisine());
    }

    private Review review(AppUser author, String name, String category, String address) {
        Review r = reviews.save(new Review(author, name, category, address, 4, "업종 확인", null));
        savedReviews.add(r);
        return r;
    }

    // 내 가게들이 있는 자리의 요약 셀 건수 합
    private int counted(String cuisine) {
        double d = 0.0005;
        return controller.summary(lat - d, lat + d, lng - d, lng + d, 17, cuisine, null).getBody().stream()
                .mapToInt(RestaurantController.Cell::count).sum();
    }

    // 카페는 카페·베이커리·디저트로 한 번 더 갈린다 — 목록·요약·후기에 실린다
    @Test
    void cafesGetAKindAndTheSummaryCanCountByKind() {
        Restaurant coffee = place("모모", "커피숍", 1);
        Restaurant bakery = place("모모제빵소", "기타", 2);
        Restaurant dessert = place("가나다", "기타", 3);
        Restaurant boardGames = place("모모 보드게임카페", "까페", 4);
        Restaurant korean = place("라마바", "한식", 5);
        assertEquals("COFFEE", coffee.getCafeKind(), "새 가게는 이름과 인허가 업종만으로 먼저 정해진다");
        assertEquals("BAKERY", bakery.getCafeKind());
        assertNull(dessert.getCafeKind(), "아직 카페인 줄 모른다");
        assertNull(boardGames.getCuisine(), "보드게임카페는 카페로 치지 않는다");
        assertNull(korean.getCafeKind(), "카페가 아니면 종류도 없다");

        backfill.fill(SbizPlacesTest.places(sbiz("가나다", "아이스크림/빙수", 3), sbiz("모모 보드게임카페", "카페", 4)));
        assertEquals("CAFE", reload(dessert).getCuisine());
        assertEquals("DESSERT", reload(dessert).getCafeKind(), "상가 소분류로 카페가 되면 종류도 같이 채운다");
        assertNull(reload(boardGames).getCuisine(), "상가 소분류가 카페라고 해도 마찬가지");
        assertNull(reload(boardGames).getCafeKind());

        double d = 0.0005;
        Map<Long, String> kinds = controller.list(lat - d, lat + d, lng - d, lng + d, null).getBody().stream()
                .collect(Collectors.toMap(RestaurantController.ListItem::id, i -> String.valueOf(i.cafeKind())));
        assertEquals(Map.of(coffee.getId(), "COFFEE", bakery.getId(), "BAKERY", dessert.getId(), "DESSERT",
                boardGames.getId(), "null", korean.getId(), "null"), kinds);

        assertEquals(3, counted("CAFE"));
        assertEquals(1, countedKind("BAKERY"));
        assertEquals(2, countedKind("BAKERY, DESSERT"));
        assertEquals(3, countedKind("COFFEE,BAKERY,DESSERT"));
        assertEquals(1, countedKind("COFFEE,없는종류"), "모르는 코드는 버린다");
        assertEquals(0, countedKind("없는종류"), "아는 코드가 하나도 없으면 아무것도 세지 않는다");

        AppUser me = users.save(new AppUser("cafekind" + tag + "@test.local", null, "카페" + tag, null));
        String token = UUID.randomUUID().toString();
        me.issueToken(token);
        users.save(me);
        Review atBakery = review(me, bakery.getName(), "기타", bakery.getRoadAddress());
        Review unlisted = review(me, "목록에없는 케이크" + tag, "기타", "서울특별시 강남구 없는길 " + tag);
        Review atKorean = review(me, korean.getName(), "한식", korean.getRoadAddress());
        Map<Long, ReviewController.Item> seen = reviewController.list("Bearer " + token).stream()
                .collect(Collectors.toMap(ReviewController.Item::id, i -> i));
        assertEquals("BAKERY", seen.get(atBakery.getId()).restaurant().cafeKind(), "가게에 채워 둔 종류");
        assertEquals("DESSERT", seen.get(unlisted.getId()).restaurant().cafeKind(), "목록에 없는 가게는 후기에 적힌 이름으로");
        assertNull(seen.get(atKorean.getId()).restaurant().cafeKind());
    }

    private int countedKind(String cafeKind) {
        double d = 0.0005;
        return controller.summary(lat - d, lat + d, lng - d, lng + d, 17, null, cafeKind).getBody().stream()
                .mapToInt(RestaurantController.Cell::count).sum();
    }

    @Test
    void runsAgainOnlyWhenTheRulesOrTheDataChanged() {
        backfill.run(false);
        assertFalse(backfill.run(true), "방금 채웠으면 건너뛴다");
        state.put("cuisine", "applied", "예전 규칙:예전 파일", Duration.ofDays(1));
        assertTrue(backfill.run(true), "규칙이나 상가 파일이 달라졌으면 다시 채운다");
        assertFalse(backfill.run(true));
    }
}
