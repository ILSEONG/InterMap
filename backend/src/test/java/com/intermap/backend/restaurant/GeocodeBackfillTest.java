package com.intermap.backend.restaurant;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 트랜잭션으로 감싸지 않는다 — 보정은 별도 스레드·트랜잭션에서 돌아서 커밋 안 된 행을 못 고친다. 끝나면 지운다.
@SpringBootTest(properties = "admin.password=test-admin-password")
class GeocodeBackfillTest {

    @Autowired RestaurantRepository repository;
    @Autowired TransactionTemplate tx;

    private static GeocodeBackfill.Geocoder fake(Map<String, double[]> answers) {
        return new GeocodeBackfill.Geocoder() {
            public boolean isConfigured() { return true; }
            public Optional<double[]> geocode(String query) { return Optional.ofNullable(answers.get(query)); }
        };
    }

    @Test
    void movesRestaurantsToGeocodedPointAndSkipsFarOrMissing() {
        // 한강공원 매점: 인허가 좌표는 강 위, 도로명 주소는 공원 안 건물
        Restaurant river = repository.save(new Restaurant("강변매점", "편의점",
            "서울특별시 영등포구 여의동로 330, 1층 (여의도동)", "서울특별시 영등포구 여의도동 85-1", 37.5300, 126.9350));
        // 지번으로만 찾히는 가게
        Restaurant lotOnly = repository.save(new Restaurant("지번집", "한식",
            null, "서울특별시 마포구 서교동 395-17 2층", 37.5550, 126.9200));
        // 지오코딩이 다른 동네(10km 밖)를 잡은 경우 — 원래 좌표를 지킨다
        Restaurant far = repository.save(new Restaurant("먼집", "한식",
            "서울특별시 강남구 테헤란로 1", null, 37.5000, 127.0300));
        Restaurant unknown = repository.save(new Restaurant("없는집", "한식",
            "어딘가 없는 주소 9", null, 37.5100, 127.0000));

        GeocodeBackfill backfill = new GeocodeBackfill(repository, tx, fake(Map.of(
            "서울특별시 영등포구 여의동로 330", new double[] {37.5283, 126.9330},
            "서울특별시 마포구 서교동 395-17", new double[] {37.5552, 126.9204},
            "서울특별시 강남구 테헤란로 1", new double[] {37.6000, 127.0300}
        )), 0);

        assertTrue(backfill.fill() >= 2);

        Restaurant r = repository.findById(river.getId()).orElseThrow();
        assertEquals(37.5283, r.getLat(), 1e-9);
        assertEquals(126.9330, r.getLng(), 1e-9);
        assertEquals(Boolean.TRUE, r.getGeocoded());

        assertEquals(37.5552, repository.findById(lotOnly.getId()).orElseThrow().getLat(), 1e-9);

        Restaurant f = repository.findById(far.getId()).orElseThrow();
        assertEquals(37.5000, f.getLat(), 1e-9);
        assertEquals(Boolean.FALSE, f.getGeocoded());

        assertEquals(Boolean.FALSE, repository.findById(unknown.getId()).orElseThrow().getGeocoded());

        // 한 번 처리한 가게는 다시 묻지 않는다
        assertEquals(0, backfill.fill());

        repository.deleteAllById(java.util.List.of(river.getId(), lotOnly.getId(), far.getId(), unknown.getId()));
    }

    @Test
    void cleansAddressTails() {
        assertEquals("서울특별시 마포구 와우산로 21", NaverGeocoder.cleanRoad("서울특별시 마포구 와우산로 21, 2층 (서교동)"));
        assertEquals("서울특별시 마포구 와우산로 21", NaverGeocoder.cleanRoad("서울특별시 마포구 와우산로 21 (서교동)"));
        assertEquals("서울특별시 마포구 서교동 395-17", NaverGeocoder.cleanLot("서울특별시 마포구 서교동 395-17 2층"));
        assertEquals("서울특별시 종로구 부암동 산 2-1", NaverGeocoder.cleanLot("서울특별시 종로구 부암동 산 2-1"));
        assertFalse(NaverGeocoder.cleanRoad("  ") != null);
    }
}
