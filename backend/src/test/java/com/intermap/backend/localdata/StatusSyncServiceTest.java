package com.intermap.backend.localdata;

import com.intermap.backend.restaurant.Restaurant;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StatusSyncServiceTest {

    private final Restaurant mongdol =
        new Restaurant("몽돌식당", "한식", "서울특별시 마포구 성미산로 23", "서울 마포구 연남동 223-14", 37.5625, 126.9256);

    private static LocalDataClient.Row row(String mgtNo, String name, String addr, String state, String dcbYmd) {
        return new LocalDataClient.Row(mgtNo, name, addr, null, null, null, null, state, dcbYmd);
    }

    @Test
    void matchesSameNameAndAddressIgnoringSpacing() {
        assertTrue(StatusSyncService.matches(mongdol, row("MGT1", "몽돌 식당", "서울특별시 마포구 성미산로 23, 1층", "01", null)));
    }

    @Test
    void rejectsDifferentName() {
        assertFalse(StatusSyncService.matches(mongdol, row("MGT2", "몽돌분식", "서울특별시 마포구 성미산로 23", "01", null)));
    }

    @Test
    void rejectsSameNameDifferentAddress() {
        assertFalse(StatusSyncService.matches(mongdol, row("MGT3", "몽돌식당", "서울특별시 강남구 테헤란로 1", "01", null)));
    }

    @Test
    void matchesByMgtNoOnceLinked() {
        mongdol.markStatus(Restaurant.Status.OPEN, "MGT9");
        var linked = row("MGT9", "상호가바뀐집", "완전 다른 주소", "03", "20260801");
        assertTrue(StatusSyncService.matches(mongdol, linked));
        assertTrue(linked.isClosed());
    }
}
