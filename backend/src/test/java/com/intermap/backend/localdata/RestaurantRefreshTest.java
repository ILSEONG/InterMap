package com.intermap.backend.localdata;

import com.intermap.backend.restaurant.GeocodeBackfill;
import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import com.intermap.backend.state.ServerState;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

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

// 주간 음식점 최신화: 새로 연 가게는 넣고, 폐업한 가게는 지운다.
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

    private final String tag = UUID.randomUUID().toString().substring(0, 8);
    private final List<LocalDataClient.Row> changed = new ArrayList<>();

    // 마포구 변경분으로 changed를 돌려주는 가짜 인허가 API
    private RestaurantRefresh refresh() {
        LocalDataClient client = new LocalDataClient("test-key") {
            @Override
            public List<Row> fetchChangedSince(String localCode, LocalDate from, LocalDate to) {
                return MAPO.equals(localCode) ? List.copyOf(changed) : List.of();
            }
        };
        return new RestaurantRefresh(client, repository, geocode, state, MAPO + ",3140000");
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
}
