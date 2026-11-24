package com.intermap.backend.localdata;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.restaurant.GeocodeBackfill;
import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import com.intermap.backend.review.Review;
import com.intermap.backend.review.ReviewCleanup;
import com.intermap.backend.review.ReviewComment;
import com.intermap.backend.review.ReviewCommentRepository;
import com.intermap.backend.review.ReviewRepository;
import com.intermap.backend.state.ServerState;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 주간 음식점 최신화: 새로 연 가게는 넣고, 폐업한 가게는 후기와 함께 지운다.
@SpringBootTest(properties = "admin.password=test-admin-password")
@Transactional
class RestaurantRefreshTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final String MAPO = "3130000";
    // 실제 인허가 좌표 샘플 (서울 마포구 서교동)
    private static final String X = "192882.950546117";
    private static final String Y = "449785.876729486";

    @Autowired RestaurantRepository repository;
    @Autowired GeocodeBackfill geocode;
    @Autowired ServerState state;
    @Autowired ReviewRepository reviews;
    @Autowired ReviewCommentRepository comments;
    @Autowired ReviewCleanup cleanup;
    @Autowired TransactionTemplate tx;
    @Autowired AppUserRepository users;

    private final String tag = UUID.randomUUID().toString().substring(0, 8);
    private final List<LocalDataClient.Row> changed = new ArrayList<>();
    // 휴게음식점·제과점영업의 마포구 변경분
    private final List<LocalDataClient.Row> restCafeChanged = new ArrayList<>();
    private final List<LocalDataClient.Row> bakeryChanged = new ArrayList<>();
    // 켜면 휴게음식점·제과점 API가 불리지 않는다 (활용신청 전)
    private boolean cafeApisDown;

    // 마포구 변경분으로 changed를 돌려주는 가짜 인허가 API
    private RestaurantRefresh refresh() {
        LocalDataClient client = new LocalDataClient("test-key") {
            @Override
            public List<Row> fetchChangedSince(Service service, String localCode, LocalDate from, LocalDate to) {
                if (service != Service.GENERAL && cafeApisDown) throw new IllegalStateException("활용신청 전");
                if (!MAPO.equals(localCode)) return List.of();
                return List.copyOf(switch (service) {
                    case GENERAL -> changed;
                    case REST_CAFE -> restCafeChanged;
                    case BAKERY -> bakeryChanged;
                });
            }
        };
        return new RestaurantRefresh(client, repository, geocode, state, reviews, cleanup, tx, MAPO + ",3140000");
    }

    private String name(String base) {
        return base + tag;
    }

    private String addr(int number) {
        return "서울특별시 마포구 테스트로" + tag + " " + number;
    }

    private Restaurant existing(String name, String roadAddr, String mgtNo) {
        Restaurant r = new Restaurant(name, "한식", roadAddr, "서울 마포구 서교동 1", 37.55, 126.92);
        if (mgtNo != null) r.markStatus(Restaurant.Status.OPEN, mgtNo);
        return repository.saveAndFlush(r);
    }

    private static LocalDataClient.Row row(String mgtNo, String name, String roadAddr, String state, String x, String y) {
        return new LocalDataClient.Row(mgtNo, name, roadAddr, "서울 마포구 서교동 1", "한식", x, y, state, null);
    }

    private boolean exists(Restaurant r) {
        return repository.existsById(r.getId());
    }

    private static final String LOT = "서울 마포구 서교동 1";

    private Review review(String restaurantName, String restaurantAddress) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        AppUser author = users.save(new AppUser("refresh" + suffix + "@test.local", null, "refresh" + suffix, null));
        return reviews.saveAndFlush(new Review(author, restaurantName, "한식", restaurantAddress, 4, "후기", null));
    }

    @Test
    void closedRestaurantIsDeleted() {
        Restaurant closed = existing(name("문닫은집"), addr(1), "MGT-A-" + tag);
        Restaurant open = existing(name("영업중인집"), addr(2), "MGT-B-" + tag);
        changed.add(row("MGT-A-" + tag, "이름이 바뀌어도", "주소가 달라도", "03", X, Y));
        changed.add(row("MGT-B-" + tag, name("영업중인집"), addr(2), "01", X, Y));

        RestaurantRefresh.Result result = refresh().refresh(31);

        assertFalse(exists(closed), "폐업한 가게는 지운다");
        assertTrue(exists(open), "영업중인 가게는 그대로");
        assertEquals(2, result.fetched());
        assertEquals(0, result.added(), "이미 있는 가게를 또 넣지 않는다");
    }

    @Test
    void cancelledLicenseCountsAsClosed() {
        Restaurant cancelled = existing(name("말소된집"), addr(3), "MGT-C-" + tag);
        changed.add(row("MGT-C-" + tag, name("말소된집"), addr(3), "04", X, Y));

        refresh().refresh(31);

        assertFalse(exists(cancelled));
    }

    @Test
    void newlyOpenedRestaurantIsAdded() {
        changed.add(row("MGT-N-" + tag, name("새로연집"), addr(4), "01", X, Y));
        changed.add(row("MGT-N2-" + tag, name("좌표없는집"), addr(5), "01", "", ""));
        changed.add(row("MGT-N3-" + tag, name("휴업중인집"), addr(6), "02", X, Y));

        RestaurantRefresh.Result result = refresh().refresh(31);

        Restaurant added = repository.findFirstByNameAndRoadAddress(name("새로연집"), addr(4)).orElseThrow();
        assertEquals("MGT-N-" + tag, added.getLocalDataMgtNo());
        assertEquals(Restaurant.Status.OPEN, added.getStatus());
        assertTrue(added.getLat() > 37.5 && added.getLat() < 37.6, "인허가 좌표를 위경도로 바꿔 넣는다");
        assertTrue(repository.findFirstByNameAndRoadAddress(name("좌표없는집"), addr(5)).isEmpty(), "좌표가 없으면 넣지 않는다");
        assertTrue(repository.findFirstByNameAndRoadAddress(name("휴업중인집"), addr(6)).isEmpty(), "영업중이 아니면 넣지 않는다");
        assertEquals(1, result.added());

        // 다시 돌려도 또 들어가지 않는다
        assertEquals(0, refresh().refresh(31).added());
    }

    @Test
    void restaurantMarkedClosedEarlierIsDeleted() {
        Restaurant marked = existing(name("표시만해둔집"), addr(7), "MGT-M-" + tag);
        marked.markStatus(Restaurant.Status.CLOSED, "MGT-M-" + tag);
        repository.saveAndFlush(marked);

        RestaurantRefresh.Result result = refresh().refresh(31);

        assertFalse(exists(marked), "예전에 폐업으로 표시만 해 둔 행도 지운다");
        assertTrue(result.removed() >= 1);
    }

    @Test
    void reopenedUnderTheSameNameReplacesTheClosedOne() {
        Restaurant old = existing(name("주인바뀐집"), addr(8), "MGT-OLD-" + tag);
        changed.add(row("MGT-NEW-" + tag, name("주인바뀐집"), addr(8), "01", X, Y));
        changed.add(row("MGT-OLD-" + tag, name("주인바뀐집"), addr(8), "03", X, Y));

        refresh().refresh(31);

        assertFalse(exists(old));
        Restaurant reopened = repository.findFirstByNameAndRoadAddress(name("주인바뀐집"), addr(8)).orElseThrow();
        assertEquals("MGT-NEW-" + tag, reopened.getLocalDataMgtNo(), "같은 자리에 다시 연 가게는 새로 넣는다");
        assertNotEquals(old.getId(), reopened.getId());
    }

    @Test
    void closureOfAnotherLicenseDoesNotDeleteALinkedRestaurant() {
        // 우리 가게는 새 인허가(MGT-NOW)에 묶여 있다 — 같은 상호·주소의 옛 인허가가 폐업으로 와도 지우지 않는다
        Restaurant current = existing(name("그대로인집"), addr(9), "MGT-NOW-" + tag);
        changed.add(row("MGT-PAST-" + tag, name("그대로인집"), addr(9), "03", X, Y));

        refresh().refresh(31);

        assertTrue(exists(current));
    }

    @Test
    void unlinkedRestaurantIsMatchedByNameAndAddress() {
        Restaurant unlinked = existing(name("번호없는 집"), addr(10), null);
        changed.add(row("MGT-U-" + tag, name("번호없는집"), addr(10), "03", X, Y));

        refresh().refresh(31);

        assertFalse(exists(unlinked), "관리번호가 없는 가게는 상호+주소(띄어쓰기 무시)로 맞춘다");
    }

    @Test
    void reviewsOfAClosedRestaurantAreDeletedWithTheirComments() {
        existing(name("문닫은집"), addr(11), "MGT-RA-" + tag);
        existing(name("영업중인집"), addr(12), "MGT-RB-" + tag);
        Review byRoadAddress = review(name("문닫은집"), addr(11));
        Review byLotAddress = review(name("문닫은집"), LOT);
        Review elsewhere = review(name("영업중인집"), addr(12));
        Review sameAddressOtherName = review(name("옆집"), addr(11));
        comments.saveAndFlush(new ReviewComment(byRoadAddress, byRoadAddress.getAuthor(), null, "맛있었는데"));
        changed.add(row("MGT-RA-" + tag, name("문닫은집"), addr(11), "03", X, Y));

        RestaurantRefresh.Result result = refresh().refresh(31);

        assertEquals(2, result.reviewsRemoved());
        assertFalse(reviews.existsById(byRoadAddress.getId()), "도로명 주소로 남긴 후기");
        assertFalse(reviews.existsById(byLotAddress.getId()), "지번 주소로 남긴 후기");
        assertTrue(comments.idsByReviewId(byRoadAddress.getId()).isEmpty(), "댓글도 같이 지운다");
        assertTrue(reviews.existsById(elsewhere.getId()), "영업중인 가게의 후기는 그대로");
        assertTrue(reviews.existsById(sameAddressOtherName.getId()), "주소만 같은 다른 가게의 후기는 그대로");
    }

    @Test
    void reviewsStayWhenTheRestaurantReopensUnderTheSameName() {
        existing(name("주인바뀐집"), addr(13), "MGT-RO-" + tag);
        Review kept = review(name("주인바뀐집"), addr(13));
        changed.add(row("MGT-RO-" + tag, name("주인바뀐집"), addr(13), "03", X, Y));
        changed.add(row("MGT-RN-" + tag, name("주인바뀐집"), addr(13), "01", X, Y));

        RestaurantRefresh.Result result = refresh().refresh(31);

        assertEquals(0, result.reviewsRemoved());
        assertTrue(reviews.existsById(kept.getId()), "같은 자리에 같은 이름으로 다시 열면 후기를 남긴다");
    }

    @Test
    void reviewsOfARestaurantMarkedClosedEarlierAreDeleted() {
        Restaurant marked = existing(name("표시만해둔집"), addr(14), "MGT-RM-" + tag);
        marked.markStatus(Restaurant.Status.CLOSED, "MGT-RM-" + tag);
        repository.saveAndFlush(marked);
        Review gone = review(name("표시만해둔집"), addr(14));

        refresh().refresh(31);

        assertFalse(exists(marked));
        assertFalse(reviews.existsById(gone.getId()));
    }

    @Test
    void reviewsOfPlacesOutsideTheListAreNeverTouched() {
        // 가게 목록에 없는 곳(서울 밖, 직접 검색해 남긴 곳)의 후기는 폐업 여부를 모른다 — 건드리지 않는다
        Review outside = review(name("목록에없는집"), "부산광역시 해운대구 1");
        changed.add(row("MGT-RX-" + tag, name("목록에없는집"), "부산광역시 해운대구 1", "03", X, Y));

        refresh().refresh(31);

        assertTrue(reviews.existsById(outside.getId()));
    }

    @Test
    void latestSlotIsTheMostRecentThursdayTenPm() {
        Instant thursday = ZonedDateTime.of(2026, 11, 19, 22, 0, 0, 0, KST).toInstant();
        Instant previous = ZonedDateTime.of(2026, 11, 12, 22, 0, 0, 0, KST).toInstant();
        // 목요일 22시 정각과 그 뒤
        assertEquals(thursday, RestaurantRefresh.latestSlot(ZonedDateTime.of(2026, 11, 19, 22, 0, 0, 0, KST)));
        assertEquals(thursday, RestaurantRefresh.latestSlot(ZonedDateTime.of(2026, 11, 19, 23, 30, 0, 0, KST)));
        assertEquals(thursday, RestaurantRefresh.latestSlot(ZonedDateTime.of(2026, 11, 25, 9, 0, 0, 0, KST)));
        // 목요일이지만 22시 전이면 지난주 것
        assertEquals(previous, RestaurantRefresh.latestSlot(ZonedDateTime.of(2026, 11, 19, 21, 59, 0, 0, KST)));
        assertEquals(previous, RestaurantRefresh.latestSlot(ZonedDateTime.of(2026, 11, 17, 0, 40, 0, 0, KST)));
    }

    private static LocalDataClient.Row cafeRow(String mgtNo, String name, String roadAddr, String category, String state) {
        return new LocalDataClient.Row(mgtNo, name, roadAddr, LOT, category, X, Y, state, null);
    }

    // 휴게음식점·제과점영업에서는 카페만 넣는다
    @Test
    void newCafesComeFromTheOtherTwoLicenses() {
        restCafeChanged.add(cafeRow("MGT-RC1-" + tag, name("모모"), addr(31), "커피숍", "01"));
        restCafeChanged.add(cafeRow("MGT-RC2-" + tag, name("메가엠지씨커피 시험점"), addr(32), "기타 휴게음식점", "01"));
        restCafeChanged.add(cafeRow("MGT-RC3-" + tag, name("씨유 시험점"), addr(33), "편의점", "01"));
        restCafeChanged.add(cafeRow("MGT-RC4-" + tag, name("씨유 카페점"), addr(34), "편의점", "01"));
        restCafeChanged.add(cafeRow("MGT-RC5-" + tag, name("맘스터치 시험점"), addr(35), "패스트푸드", "01"));
        restCafeChanged.add(cafeRow("MGT-RC6-" + tag, name("홈즈 보드게임카페"), addr(36), "기타 휴게음식점", "01"));
        bakeryChanged.add(cafeRow("MGT-BK1-" + tag, name("성심당"), addr(37), "", "01"));

        RestaurantRefresh.Result result = refresh().refresh(31);

        assertEquals(3, result.added(), "커피숍, 이름이 커피인 가게, 빵집");
        Restaurant coffee = repository.findFirstByNameAndRoadAddress(name("모모"), addr(31)).orElseThrow();
        assertEquals("CAFE", coffee.getCuisine());
        assertEquals("COFFEE", coffee.getCafeKind());
        assertEquals("MGT-RC1-" + tag, coffee.getLocalDataMgtNo());
        assertTrue(repository.findFirstByNameAndRoadAddress(name("메가엠지씨커피 시험점"), addr(32)).isPresent());
        Restaurant bakery = repository.findFirstByNameAndRoadAddress(name("성심당"), addr(37)).orElseThrow();
        assertEquals("제과점", bakery.getCategory());
        assertEquals("BAKERY", bakery.getCafeKind());
        assertTrue(repository.findFirstByNameAndRoadAddress(name("홈즈 보드게임카페"), addr(36)).isEmpty(), "보드게임카페는 넣지 않는다");
        assertTrue(repository.findFirstByNameAndRoadAddress(name("씨유 시험점"), addr(33)).isEmpty(), "편의점은 넣지 않는다");
        assertTrue(repository.findFirstByNameAndRoadAddress(name("씨유 카페점"), addr(34)).isEmpty(), "이름에 카페가 있어도 편의점은 넣지 않는다");
        assertTrue(repository.findFirstByNameAndRoadAddress(name("맘스터치 시험점"), addr(35)).isEmpty(), "패스트푸드는 넣지 않는다");

        assertEquals(0, refresh().refresh(31).added(), "다시 돌려도 또 들어가지 않는다");
    }

    @Test
    void aCafeListedUnderTwoLicensesIsAddedOnce() {
        Restaurant already = existing(name("이미있는 카페"), addr(41), "MGT-G-" + tag);
        restCafeChanged.add(cafeRow("MGT-RC7-" + tag, name("이미있는 카페"), addr(41), "커피숍", "01"));
        restCafeChanged.add(cafeRow("MGT-RC8-" + tag, name("두번나오는 베이커리"), addr(42), "커피숍", "01"));
        bakeryChanged.add(cafeRow("MGT-BK2-" + tag, name("두번나오는 베이커리"), addr(42), "", "01"));

        assertEquals(1, refresh().refresh(31).added(), "이미 있는 카페는 건너뛰고, 두 인허가에 다 나온 가게는 한 번만");
        assertTrue(exists(already));
        assertTrue(repository.findFirstByNameAndRoadAddress(name("두번나오는 베이커리"), addr(42)).isPresent());
    }

    @Test
    void closedCafeIsDeleted() {
        Restaurant cafe = existing(name("문닫은 카페"), addr(43), "MGT-RC9-" + tag);
        restCafeChanged.add(cafeRow("MGT-RC9-" + tag, name("문닫은 카페"), addr(43), "커피숍", "03"));

        RestaurantRefresh.Result result = refresh().refresh(31);

        assertFalse(exists(cafe));
        assertEquals(1, result.removed());
    }

    // 휴게음식점·제과점 API를 못 불러도(활용신청 전) 일반음식점 최신화는 끝까지 한다
    @Test
    void restaurantsStillRefreshWhenTheCafeApisCannotBeCalled() {
        cafeApisDown = true;
        Restaurant closed = existing(name("문닫은집"), addr(44), "MGT-D-" + tag);
        changed.add(row("MGT-D-" + tag, name("문닫은집"), addr(44), "03", X, Y));
        changed.add(row("MGT-E-" + tag, name("새로연집"), addr(45), "01", X, Y));
        restCafeChanged.add(cafeRow("MGT-RC10-" + tag, name("못받는 카페"), addr(46), "커피숍", "01"));

        RestaurantRefresh.Result result = refresh().refresh(31);

        assertFalse(exists(closed));
        assertEquals(1, result.added());
        assertTrue(repository.findFirstByNameAndRoadAddress(name("못받는 카페"), addr(46)).isEmpty());
    }
}
