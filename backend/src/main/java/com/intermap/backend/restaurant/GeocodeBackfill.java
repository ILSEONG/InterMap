package com.intermap.backend.restaurant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 인허가 좌표를 네이버 지오코딩 좌표로 바꾼다.
 * 인허가 좌표(EPSG:5174)는 필지 기준이라 실제 가게 자리와 어긋나고(중앙값 약 50m, 큰 건 수백 m),
 * 한강공원 매점처럼 하천 필지에 등록된 가게는 강 한가운데 수십 곳이 겹쳐 찍힌다.
 * 서버 시작 때와 가게를 새로 들여온 뒤 뒤에서 돈다. 다 고치면 빈 목록만 보고 끝난다.
 */
@Component
public class GeocodeBackfill implements ApplicationRunner {

    public interface Geocoder {
        boolean isConfigured();

        Optional<double[]> geocode(String query);
    }

    private static final Logger log = LoggerFactory.getLogger(GeocodeBackfill.class);
    private static final int BATCH = 200;
    // 지오코딩 결과가 인허가 좌표에서 이보다 멀면 다른 동네 같은 이름 주소를 잡은 것으로 보고 버린다
    static final double MAX_SHIFT_METERS = 1_500;
    // 묶음 전체가 일시 오류(타임아웃·5xx)인 일이 이만큼 이어지면 멈추고 다음 기회에 이어서 한다
    private static final int MAX_CONSECUTIVE_ERRORS = 5;
    // 동시 요청 수. 한 건씩이면 서울 11만 건에 반나절이 걸린다. DB 커넥션 풀(10)보다 작게
    private static final int WORKERS = 6;

    private final RestaurantRepository repository;
    private final TransactionTemplate tx;
    private final Geocoder geocoder;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final long pauseMillis;

    @org.springframework.beans.factory.annotation.Autowired
    public GeocodeBackfill(RestaurantRepository repository, TransactionTemplate tx, NaverGeocoder geocoder) {
        this(repository, tx, geocoder, 40);
    }

    GeocodeBackfill(RestaurantRepository repository, TransactionTemplate tx, Geocoder geocoder, long pauseMillis) {
        this.repository = repository;
        this.tx = tx;
        this.geocoder = geocoder;
        this.pauseMillis = pauseMillis;
    }

    @Override
    public void run(ApplicationArguments args) {
        start();
    }

    /** 뒤에서 한 번 돈다. 이미 돌고 있으면 아무것도 안 한다 */
    public void start() {
        if (!geocoder.isConfigured()) {
            log.info("NCP_MAP_KEY_ID/NCP_MAP_KEY가 없어 가게 좌표 보정을 건너뜀");
            return;
        }
        if (!running.compareAndSet(false, true)) return;
        Thread worker = new Thread(() -> {
            try {
                fill();
            } finally {
                running.set(false);
            }
        }, "geocode-backfill");
        worker.setDaemon(true);
        worker.start();
    }

    private enum Outcome { MOVED, FAILED, ERROR, STOP }

    /** 고친 건수를 돌려준다 */
    int fill() {
        int moved = 0, failed = 0, errors = 0, batches = 0;
        ExecutorService pool = Executors.newFixedThreadPool(WORKERS, r -> {
            Thread t = new Thread(r, "geocode-worker");
            t.setDaemon(true);
            return t;
        });
        try {
            // 한 점에 여러 가게가 겹친 것(한강공원 매점 같은 필지 좌표)부터 — 지도에서 제일 티 나게 틀린 곳
            for (boolean stackedOnly : new boolean[] {true, false}) {
                while (true) {
                    PageRequest page = PageRequest.of(0, BATCH);
                    List<Object[]> rows = stackedOnly
                        ? repository.findUngeocodedStacked(Restaurant.Status.OPEN, page)
                        : repository.findUngeocoded(Restaurant.Status.OPEN, page);
                    if (rows.isEmpty()) break;
                    List<Future<Outcome>> results = new ArrayList<>();
                    for (Object[] row : rows) results.add(pool.submit(() -> process(row)));
                    int batchErrors = 0;
                    for (Future<Outcome> f : results) {
                        Outcome o;
                        try {
                            o = f.get();
                        } catch (ExecutionException e) {
                            o = Outcome.ERROR;
                        }
                        switch (o) {
                            case MOVED -> moved++;
                            case FAILED -> failed++;
                            case ERROR -> batchErrors++;
                            case STOP -> {
                                log.warn("네이버 지오코딩 사용 불가 — 좌표 보정 멈춤 (고침 {}건)", moved);
                                return moved;
                            }
                        }
                    }
                    // 묶음 전체가 오류면 연속 오류로 친다. 일부만 실패한 행은 null로 남아 다음 묶음에서 다시 잡힌다
                    errors = batchErrors == rows.size() ? errors + 1 : 0;
                    if (errors >= MAX_CONSECUTIVE_ERRORS) {
                        log.warn("지오코딩 오류가 이어져 좌표 보정 멈춤 (다음 시작 때 이어서)");
                        return moved;
                    }
                    if (batchErrors > 0) pause(1_000);
                    if (++batches % 10 == 0) log.info("가게 좌표 보정 중... 고침 {}건, 못 찾음 {}건", moved, failed);
                }
            }
            if (moved + failed > 0) log.info("가게 좌표 보정 끝: 고침 {}건, 못 찾음 {}건", moved, failed);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (RuntimeException e) {
            // 서버가 꺼지는 중이거나 DB가 잠깐 안 될 때 — 다음 시작 때 이어서 한다
            log.warn("가게 좌표 보정 중단: {}", e.getMessage());
        } finally {
            pool.shutdownNow();
        }
        return moved;
    }

    private Outcome process(Object[] row) {
        Long id = (Long) row[0];
        double lat = ((Number) row[3]).doubleValue();
        double lng = ((Number) row[4]).doubleValue();
        Optional<double[]> found;
        try {
            found = locate((String) row[1], (String) row[2], lat, lng);
        } catch (NaverGeocoder.Unavailable e) {
            log.warn("지오코딩 거절: {}", e.getMessage());
            return Outcome.STOP;
        } catch (RuntimeException e) {
            return Outcome.ERROR;
        }
        if (found.isPresent()) {
            double[] p = found.get();
            tx.executeWithoutResult(s -> repository.relocate(id, p[0], p[1]));
            return Outcome.MOVED;
        }
        tx.executeWithoutResult(s -> repository.markGeocodeFailed(id));
        return Outcome.FAILED;
    }

    // 도로명(건물) 먼저, 없으면 지번. 인허가 좌표에서 너무 멀면 엉뚱한 곳을 잡은 것이라 버린다.
    private Optional<double[]> locate(String road, String lot, double lat, double lng) {
        for (String query : new String[] {NaverGeocoder.cleanRoad(road), NaverGeocoder.cleanLot(lot)}) {
            if (query == null) continue;
            Optional<double[]> p = geocoder.geocode(query);
            if (p.isPresent() && distanceMeters(lat, lng, p.get()[0], p.get()[1]) <= MAX_SHIFT_METERS) return p;
        }
        return Optional.empty();
    }

    static double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1) * Math.cos(Math.toRadians((lat1 + lat2) / 2));
        return 6_371_000 * Math.hypot(dLat, dLng);
    }

    private void pause(long millis) {
        if (pauseMillis <= 0) return;
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted");
        }
    }
}
