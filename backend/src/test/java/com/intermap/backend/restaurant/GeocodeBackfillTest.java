package com.intermap.backend.restaurant;

import com.intermap.backend.localdata.LocalDataClient;
import com.intermap.backend.localdata.RestaurantImportService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 트랜잭션으로 감싸지 않는다 — 보정은 별도 스레드·트랜잭션에서 돌아서 커밋 안 된 행을 못 고친다. 끝나면 지운다.
@SpringBootTest(properties = "admin.password=test-admin-password")
class GeocodeBackfillTest {

    @Autowired RestaurantRepository repository;
    @Autowired TransactionTemplate tx;
    @Autowired JdbcTemplate jdbc;

    private final AtomicInteger asked = new AtomicInteger();

    // 다듬은 도로명 주소(없으면 지번 주소)로 답하는 가짜 주소 API
    private GeocodeBackfill.Locator locator(Map<String, double[]> answers) {
        return locator(answers, true);
    }

    private GeocodeBackfill.Locator locator(Map<String, double[]> answers, boolean healthy) {
        return new GeocodeBackfill.Locator() {
            public boolean isConfigured() { return true; }

            public boolean answersKnownAddress() { return healthy; }

            public Optional<double[]> locate(String road, String lot) {
                asked.incrementAndGet();
                String roadQuery = AddressText.cleanRoad(road), lotQuery = AddressText.cleanLot(lot);
                double[] p = roadQuery == null ? null : answers.get(roadQuery);
                if (p == null && lotQuery != null) p = answers.get(lotQuery);
                return Optional.ofNullable(p);
            }
        };
    }

    // 공공데이터의 영업중 목록을 흉내 낸다 (구 하나)
    private static class FakeOriginals implements GeocodeBackfill.Originals {
        final List<LocalDataClient.Row> rows;
        final AtomicInteger fetched = new AtomicInteger();

        FakeOriginals(LocalDataClient.Row... rows) { this.rows = List.of(rows); }

        public boolean isConfigured() { return true; }

        public List<String> localCodes() { return List.of("3130000"); }

        public List<LocalDataClient.Row> openRows(String localCode) {
            fetched.incrementAndGet();
            return rows;
        }
    }

    // 예전에 네이버 지오코딩으로 좌표를 바꿔 둔 행을 흉내 낸다
    private void markAsNaver(Restaurant r) {
        jdbc.update("update restaurant set geocoded = true where id = ?", r.getId());
    }

    @Test
    void movesToAddressCoordinatesOrKeepsLicenseCoordinates() {
        // 한강공원 매점: 인허가 좌표는 강 위, 도로명 주소는 공원 안 건물
        Restaurant river = repository.save(new Restaurant("강변매점", "편의점",
            "서울특별시 영등포구 여의동로 330, 1층 (여의도동)", "서울특별시 영등포구 여의도동 85-1", 37.5300, 126.9350));
        // 지번으로만 찾히는 가게
        Restaurant lotOnly = repository.save(new Restaurant("지번집", "한식",
            null, "서울특별시 마포구 서교동 395-17 2층", 37.5550, 126.9200));
        Restaurant unknown = repository.save(new Restaurant("없는집", "한식",
            "어딘가 없는 주소 9", null, 37.5100, 127.0000));

        FakeOriginals originals = new FakeOriginals();
        GeocodeBackfill backfill = new GeocodeBackfill(repository, tx, locator(Map.of(
            "서울특별시 영등포구 여의동로 330", new double[] {37.5283, 126.9330},
            "서울특별시 마포구 서교동 395-17", new double[] {37.5552, 126.9204}
        )), originals, 0);

        assertTrue(backfill.fill() >= 2);

        Restaurant r = repository.findById(river.getId()).orElseThrow();
        assertEquals(37.5283, r.getLat(), 1e-9);
        assertEquals(126.9330, r.getLng(), 1e-9);
        assertEquals(Boolean.TRUE, r.getGeocoded());
        assertEquals("JUSO", r.getCoordSource());

        assertEquals(37.5552, repository.findById(lotOnly.getId()).orElseThrow().getLat(), 1e-9);

        // 주소로 못 찾으면 인허가 좌표를 그대로 쓴다
        Restaurant u = repository.findById(unknown.getId()).orElseThrow();
        assertEquals(37.5100, u.getLat(), 1e-9);
        assertEquals(Boolean.FALSE, u.getGeocoded());
        assertEquals("LICENSE", u.getCoordSource());
        assertEquals(0, originals.fetched.get(), "네이버 좌표가 없으면 공공데이터를 다시 받지 않는다");

        // 한 번 처리한 가게는 다시 묻지 않는다
        int before = asked.get();
        assertEquals(0, backfill.fill());
        assertEquals(before, asked.get());

        repository.deleteAllById(List.of(river.getId(), lotOnly.getId(), unknown.getId()));
    }

    @Test
    void naverCoordinatesAreReplaced() {
        // 주소 API에서 찾히는 가게 — 네이버 좌표가 주소 좌표로 바뀐다
        Restaurant found = repository.save(new Restaurant("찾는집", "한식",
            "서울특별시 중구 세종대로 110", "서울특별시 중구 태평로1가 31", 37.5660, 126.9780));
        // 주소 API에서 못 찾는 가게 — 공공데이터의 인허가 좌표로 되돌린다 (관리번호로 맞춘다)
        Restaurant byMgtNo = new Restaurant("못찾는집", "한식",
            "서울특별시 마포구 없는길 1", "서울특별시 마포구 없는동 1", 37.5551, 126.9201);
        byMgtNo.markStatus(Restaurant.Status.OPEN, "MGT-REVERT-1");
        byMgtNo = repository.save(byMgtNo);
        // 관리번호가 없는 가게 — 상호+주소로 맞춘다
        Restaurant byName = repository.save(new Restaurant("이름으로찾는집", "분식",
            "서울특별시 마포구 없는길 2", "서울특별시 마포구 없는동 2", 37.5552, 126.9202));
        // 공공데이터에도 없는 가게 — 되돌릴 좌표가 없다
        Restaurant orphan = repository.save(new Restaurant("사라진집", "한식",
            "서울특별시 마포구 없는길 3", "서울특별시 마포구 없는동 3", 37.5553, 126.9203));
        // 네이버 좌표가 아닌(인허가 좌표 그대로인) 가게는 건드리지 않는다
        Restaurant plain = repository.save(new Restaurant("그냥집", "한식",
            "서울특별시 마포구 없는길 4", "서울특별시 마포구 없는동 4", 37.5554, 126.9204));
        for (Restaurant r : List.of(found, byMgtNo, byName, orphan)) markAsNaver(r);

        FakeOriginals originals = new FakeOriginals(
            new LocalDataClient.Row("MGT-REVERT-1", "못찾는집", "서울특별시 마포구 없는길 1", "서울특별시 마포구 없는동 1",
                "한식", "191000", "450000", "01", null),
            new LocalDataClient.Row("MGT-OTHER", "이름으로찾는집", "서울특별시 마포구 없는길 2", "서울특별시 마포구 없는동 2",
                "분식", "192000", "451000", "01", null));
        GeocodeBackfill backfill = new GeocodeBackfill(repository, tx, locator(Map.of(
            "서울특별시 중구 세종대로 110", new double[] {37.56650, 126.97800}
        )), originals, 0);

        backfill.fill();

        Restaurant f = repository.findById(found.getId()).orElseThrow();
        assertEquals(37.56650, f.getLat(), 1e-9);
        assertEquals("JUSO", f.getCoordSource());

        double[] first = RestaurantImportService.toLatLng("191000", "450000");
        Restaurant m = repository.findById(byMgtNo.getId()).orElseThrow();
        assertEquals(first[0], m.getLat(), 1e-9);
        assertEquals(first[1], m.getLng(), 1e-9);
        assertEquals("LICENSE", m.getCoordSource());
        assertEquals(Boolean.FALSE, m.getGeocoded());

        double[] second = RestaurantImportService.toLatLng("192000", "451000");
        Restaurant n = repository.findById(byName.getId()).orElseThrow();
        assertEquals(second[0], n.getLat(), 1e-9);
        assertEquals("LICENSE", n.getCoordSource());

        // 되돌릴 좌표를 못 찾은 행은 표시가 남는다 — 남은 수로 드러난다
        assertEquals("REVERT", repository.findById(orphan.getId()).orElseThrow().getCoordSource());
        assertTrue(repository.countHoldingNaverCoords() >= 1);

        Restaurant p = repository.findById(plain.getId()).orElseThrow();
        assertEquals(37.5554, p.getLat(), 1e-9);
        assertEquals("LICENSE", p.getCoordSource());

        // 못 찾은 행만 남았으면 공공데이터를 또 통째로 받지 않는다
        int fetched = originals.fetched.get();
        assertEquals(1, fetched);
        backfill.fill();
        assertEquals(fetched, originals.fetched.get());

        repository.deleteAllById(List.of(found.getId(), byMgtNo.getId(), byName.getId(), orphan.getId(), plain.getId()));
    }

    @Test
    void nothingIsTouchedWhenTheApiCannotAnswerAKnownAddress() {
        // 응답을 잘못 읽고 있으면 모든 가게가 "못 찾음"이 된다 — 시작 전에 걸러서 좌표를 그대로 둔다
        Restaurant naver = repository.save(new Restaurant("그대로집", "한식",
            "서울특별시 중구 세종대로 110", "서울특별시 중구 태평로1가 31", 37.5660, 126.9780));
        markAsNaver(naver);
        FakeOriginals originals = new FakeOriginals();
        int before = asked.get();

        GeocodeBackfill backfill = new GeocodeBackfill(repository, tx, locator(Map.of(), false), originals, 0);
        assertEquals(0, backfill.fill());

        Restaurant r = repository.findById(naver.getId()).orElseThrow();
        assertEquals(37.5660, r.getLat(), 1e-9);
        assertEquals(Boolean.TRUE, r.getGeocoded());
        assertNull(r.getCoordSource());
        assertEquals(before, asked.get(), "가게 주소는 하나도 묻지 않는다");
        assertEquals(0, originals.fetched.get());

        repository.deleteById(naver.getId());
    }

    @Test
    void newRestaurantsStartUnprocessed() {
        Restaurant fresh = repository.save(new Restaurant("새집", "한식", "서울특별시 마포구 새길 1", null, 37.55, 126.92));
        assertNull(repository.findById(fresh.getId()).orElseThrow().getCoordSource());
        repository.deleteById(fresh.getId());
    }

    @Test
    void cleansAddressTails() {
        assertEquals("서울특별시 마포구 와우산로 21", AddressText.cleanRoad("서울특별시 마포구 와우산로 21, 2층 (서교동)"));
        assertEquals("서울특별시 마포구 와우산로 21", AddressText.cleanRoad("서울특별시 마포구 와우산로 21 (서교동)"));
        assertEquals("서울특별시 마포구 서교동 395-17", AddressText.cleanLot("서울특별시 마포구 서교동 395-17 2층"));
        assertEquals("서울특별시 종로구 부암동 산 2-1", AddressText.cleanLot("서울특별시 종로구 부암동 산 2-1"));
        assertNull(AddressText.cleanRoad("  "));
    }
}
