package com.intermap.backend.localdata;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RestaurantImportServiceTest {

    @Test
    void tmCoordinateConvertsIntoMapoBounds() {
        // 실제 인허가 데이터 샘플: 트라이포트 펍 (서울 마포구 서교동)
        double[] latLng = RestaurantImportService.toLatLng("192882.950546117", "449785.876729486");

        assertTrue(latLng != null, "좌표 변환 실패");
        assertTrue(latLng[0] > 37.5 && latLng[0] < 37.6, "lat 마포구 범위 벗어남: " + latLng[0]);
        assertTrue(latLng[1] > 126.88 && latLng[1] < 126.96, "lng 마포구 범위 벗어남: " + latLng[1]);
    }

    @Test
    void blankOrBogusCoordinatesReturnNull() {
        assertNull(RestaurantImportService.toLatLng("", "449785"));
        assertNull(RestaurantImportService.toLatLng(null, null));
        assertNull(RestaurantImportService.toLatLng("abc", "def"));
    }
}
