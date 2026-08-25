package com.intermap.backend.localdata;

import com.intermap.backend.restaurant.Restaurant;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StatusSyncServiceTest {

    private final Restaurant mongdol =
        new Restaurant("몽돌식당", "한식", "서울특별시 마포구 성미산로 23", "서울 마포구 연남동 223-14", 37.5625, 126.9256);

    @Test
    void matchesSameNameAndAddressIgnoringSpacing() {
        var row = new LocalDataClient.Row("MGT1", "몽돌 식당", "서울특별시 마포구 성미산로 23, 1층", "01", null);
        assertTrue(StatusSyncService.matches(mongdol, row));
    }

    @Test
    void rejectsDifferentName() {
        var row = new LocalDataClient.Row("MGT2", "몽돌분식", "서울특별시 마포구 성미산로 23", "01", null);
        assertFalse(StatusSyncService.matches(mongdol, row));
    }

    @Test
    void rejectsSameNameDifferentAddress() {
        var row = new LocalDataClient.Row("MGT3", "몽돌식당", "서울특별시 강남구 테헤란로 1", "01", null);
        assertFalse(StatusSyncService.matches(mongdol, row));
    }

    @Test
    void matchesByMgtNoOnceLinked() {
        mongdol.markStatus(Restaurant.Status.OPEN, "MGT9");
        var row = new LocalDataClient.Row("MGT9", "상호가바뀐집", "완전 다른 주소", "03", "20260801");
        assertTrue(StatusSyncService.matches(mongdol, row));
        assertTrue(row.isClosed());
    }
}
