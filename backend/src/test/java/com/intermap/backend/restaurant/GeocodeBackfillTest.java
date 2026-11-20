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
    void stopsWhenMostOfABatchIsNotFoundAndTheApiLooksBroken() {
        // 처음엔 멀쩡하다가 도중에 API가 이상해진 경우: 아는 주소 확인이 실패하면 묶음 하나에서 멈춘다
        java.util.List<Long> ids = new java.util.ArrayList<>();
        for (int i = 0; i < 450; i++) {
            ids.add(repository.save(new Restaurant("몰린집" + i, "한식", "서울특별시 마포구 몰린길 " + i, null, 37.55, 126.92)).getId());
        }
        AtomicInteger checks = new AtomicInteger();
        GeocodeBackfill.Locator breaking = new GeocodeBackfill.Locator() {
            public boolean isConfigured() { return true; }

            // 시작할 때 한 번은 통과하고 그다음부터 실패한다
            public boolean answersKnownAddress() { return checks.getAndIncrement() == 0; }

            public Optional<double[]> locate(String road, String lot) { return Optional.empty(); }
        };

        new GeocodeBackfill(repository, tx, breaking, new FakeOriginals(), 0).fill();

        long untouched = ids.stream().filter(id -> repository.findById(id).orElseThrow().getCoordSource() == null).count();
        assertTrue(untouched >= 200, "첫 묶음(200곳)에서 멈춰 나머지는 그대로 남는다: " + untouched);
        assertEquals(2, checks.get(), "시작할 때 한 번, 못 찾음이 몰렸을 때 한 번");

        repository.deleteAllById(ids);
    }

    // 주소마다 정해 둔 대로 답하는 가짜 주소 API: 거절(Unavailable), 잠깐의 오류, 또는 좌표
    private static class Scripted implements GeocodeBackfill.Locator {
        final java.util.Set<String> refused = java.util.concurrent.ConcurrentHashMap.newKeySet();
        final java.util.Set<String> failsOnce = java.util.concurrent.ConcurrentHashMap.newKeySet();
        final AtomicInteger checks = new AtomicInteger();
        volatile boolean healthyAfterStart = true;

        public boolean isConfigured() { return true; }

        public boolean answersKnownAddress() { return checks.getAndIncrement() == 0 || healthyAfterStart; }

        public Optional<double[]> locate(String road, String lot) {
            if (road == null) return Optional.empty();
            if (refused.contains(road)) throw new GeocodeBackfill.Unavailable("E9999 처음 보는 오류");
            if (failsOnce.remove(road)) throw new IllegalStateException("잠깐의 오류");
            return Optional.of(new double[] {37.5, 127.0});
        }
    }

    @Test
    void aRowTheApiKeepsRefusingDoesNotHoldUpTheRest() {
        // 한 주소만 거듭 거절되는 경우(모르는 오류 코드): 나머지는 고치고, 그 주소는 못 찾은 것으로 두고 끝낸다
        Restaurant first = repository.save(new Restaurant("앞집", "한식", "서울특별시 마포구 거절길 1", null, 37.55, 126.92));
        Restaurant stuck = repository.save(new Restaurant("걸린집", "한식", "서울특별시 마포구 거절길 2", null, 37.55, 126.92));
        Restaurant last = repository.save(new Restaurant("뒷집", "한식", "서울특별시 마포구 거절길 3", null, 37.55, 126.92));
        Scripted api = new Scripted();
        api.refused.add(stuck.getRoadAddress());

        new GeocodeBackfill(repository, tx, api, new FakeOriginals(), 0).fill();

        assertEquals("JUSO", repository.findById(first.getId()).orElseThrow().getCoordSource());
        assertEquals("JUSO", repository.findById(last.getId()).orElseThrow().getCoordSource(), "걸린 행 뒤의 가게도 고친다");
        Restaurant s2 = repository.findById(stuck.getId()).orElseThrow();
        assertEquals("LICENSE", s2.getCoordSource(), "다른 주소는 답하는데 이 주소만 거듭 거절되면 못 찾은 것으로 둔다");
        assertEquals(37.55, s2.getLat(), 1e-9);

        repository.deleteAllById(List.of(first.getId(), stuck.getId(), last.getId()));
    }

    @Test
    void aPassingErrorIsAskedAgainAtTheEnd() {
        Restaurant flaky = repository.save(new Restaurant("깜빡집", "한식", "서울특별시 마포구 깜빡길 1", null, 37.55, 126.92));
        Scripted api = new Scripted();
        api.failsOnce.add(flaky.getRoadAddress());

        new GeocodeBackfill(repository, tx, api, new FakeOriginals(), 0).fill();

        Restaurant r = repository.findById(flaky.getId()).orElseThrow();
        assertEquals("JUSO", r.getCoordSource(), "한 번 실패한 행은 다 돈 뒤에 다시 물어 고친다");
        assertEquals(37.5, r.getLat(), 1e-9);

        repository.deleteById(flaky.getId());
    }

    @Test
    void stopsAndLeavesRowsAloneWhenTheApiRefusesEverything() {
        // 한도·차단처럼 API가 전부 거절하기 시작한 경우: 아는 주소도 답하지 못하므로 멈추고, 가게는 건드리지 않는다
        java.util.List<Restaurant> saved = new java.util.ArrayList<>();
        for (int i = 0; i < 30; i++) {
            saved.add(repository.save(new Restaurant("막힌집" + i, "한식", "서울특별시 마포구 막힌길 " + i, null, 37.55, 126.92)));
        }
        Scripted api = new Scripted();
        api.healthyAfterStart = false;
        for (Restaurant r : saved) api.refused.add(r.getRoadAddress());

        new GeocodeBackfill(repository, tx, api, new FakeOriginals(), 0).fill();

        for (Restaurant r : saved) {
            Restaurant now = repository.findById(r.getId()).orElseThrow();
            assertNull(now.getCoordSource(), "거절된 가게는 다음에 다시 묻도록 그대로 둔다");
            assertEquals(37.55, now.getLat(), 1e-9);
        }
        assertEquals(2, api.checks.get(), "시작할 때 한 번, 거절이 나왔을 때 한 번");

        repository.deleteAllById(saved.stream().map(Restaurant::getId).toList());
    }

    @Test
    void notFoundMarksWithoutACheckTimeAreAskedAgainOnce() {
        // 속도 제한(E0007)을 못 찾은 것으로 잘못 읽던 때에 표시된 가게들 — 확인한 때가 비어 있다
        Restaurant wrong = repository.save(new Restaurant("다시묻는집", "한식", "서울특별시 마포구 다시길 1", null, 37.55, 126.92));
        Restaurant wrongNaver = repository.save(new Restaurant("다시묻는네이버집", "한식", "서울특별시 마포구 다시길 2", null, 37.55, 126.92));
        Restaurant missing = repository.save(new Restaurant("정말없는집", "한식", "서울특별시 마포구 다시길 3", null, 37.55, 126.92));
        Restaurant missingNaver = repository.save(new Restaurant("정말없는네이버집", "한식", "서울특별시 마포구 다시길 4", null, 37.55, 126.92));
        for (Restaurant r : List.of(wrong, missing)) {
            jdbc.update("update restaurant set coord_source = 'LICENSE', geocoded = false where id = ?", r.getId());
        }
        for (Restaurant r : List.of(wrongNaver, missingNaver)) {
            jdbc.update("update restaurant set coord_source = 'REVERT', geocoded = false where id = ?", r.getId());
        }
        GeocodeBackfill backfill = new GeocodeBackfill(repository, tx, locator(Map.of(
            "서울특별시 마포구 다시길 1", new double[] {37.5601, 126.9301},
            "서울특별시 마포구 다시길 2", new double[] {37.5602, 126.9302}
        )), new FakeOriginals(), 0);

        backfill.fill();

        Restaurant a = repository.findById(wrong.getId()).orElseThrow();
        assertEquals("JUSO", a.getCoordSource());
        assertEquals(37.5601, a.getLat(), 1e-9);
        assertEquals("JUSO", repository.findById(wrongNaver.getId()).orElseThrow().getCoordSource());
        // 다시 물어도 없는 가게는 그대로 — 네이버 좌표가 든 행은 되돌릴 차례를 계속 기다린다
        assertEquals("LICENSE", repository.findById(missing.getId()).orElseThrow().getCoordSource());
        assertEquals("REVERT", repository.findById(missingNaver.getId()).orElseThrow().getCoordSource());
        assertEquals(0, jdbc.queryForObject("select count(*) from restaurant where id in (?, ?) and coord_checked_at is null",
            Integer.class, missing.getId(), missingNaver.getId()), "확인한 때가 적힌다");

        // 한 번 확인한 표시는 다시 묻지 않는다
        int before = asked.get();
        backfill.fill();
        assertEquals(before, asked.get());

        repository.deleteAllById(List.of(wrong.getId(), wrongNaver.getId(), missing.getId(), missingNaver.getId()));
    }

    @Test
    void aFailedDownloadOfOriginalsIsNotRepeatedEveryRun() {
        // 공공 API가 응답하지 않을 때: 되돌리기는 다음으로 미루고, 돌 때마다 통째로 다시 받지 않는다
        Restaurant waiting = repository.save(new Restaurant("기다리는집", "한식", "서울특별시 마포구 기다림길 1", null, 37.5551, 126.9201));
        markAsNaver(waiting);
        AtomicInteger tried = new AtomicInteger();
        GeocodeBackfill.Originals broken = new GeocodeBackfill.Originals() {
            public boolean isConfigured() { return true; }

            public List<String> localCodes() { return List.of("3130000"); }

            public List<LocalDataClient.Row> openRows(String localCode) {
                tried.incrementAndGet();
                throw new IllegalStateException("Read timed out");
            }
        };
        GeocodeBackfill backfill = new GeocodeBackfill(repository, tx, locator(Map.of()), broken, 0);

        backfill.fill();
        backfill.fill();

        assertEquals(1, tried.get(), "실패한 뒤에는 하루 동안 다시 받지 않는다");
        assertEquals("REVERT", repository.findById(waiting.getId()).orElseThrow().getCoordSource());

        repository.deleteById(waiting.getId());
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
