package com.intermap.backend.restaurant;

import com.intermap.backend.localdata.LocalDataClient;
import com.intermap.backend.localdata.RestaurantImportService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 가게 좌표를 도로명주소 API(행정안전부) 좌표로 바꾼다.
 * 인허가 좌표(EPSG:5174)는 필지 기준이라 실제 가게 자리와 어긋나고(중앙값 약 50m, 큰 건 수백 m),
 * 한강공원 매점처럼 하천 필지에 등록된 가게는 강 한가운데 수십 곳이 겹쳐 찍힌다.
 *
 * 예전에는 네이버 지오코딩 좌표를 저장했다. 네이버 Maps 약관(제7조)이 결과 데이터를 저장해 다시 쓰는 것을
 * 금지하므로 그 좌표는 모두 걷어낸다 — 가게마다 둘 중 하나가 된다:
 *   - 도로명주소 API에서 찾으면 그 좌표 (coordSource = JUSO)
 *   - 못 찾으면 인허가 좌표 (LICENSE). 네이버 좌표가 들어 있던 행은 인허가 좌표를 공공데이터에서 다시 받아 되돌린다
 *
 * 서버 시작 때, 가게를 새로 들여온 뒤, 그리고 매일 새벽에 뒤에서 돈다 (승인키의 하루 한도 때문에 며칠에 나눠 끝난다).
 * 다 고치면 빈 목록만 보고 끝난다.
 */
@Component
public class GeocodeBackfill implements ApplicationRunner {

    public interface Locator {
        boolean isConfigured();

        /** 도로명 주소(없으면 지번 주소) → [lat, lng]. 못 찾으면 빈 값 */
        Optional<double[]> locate(String roadAddress, String lotAddress);

        /**
         * 이미 답을 아는 주소 하나를 물어 봐서 제대로 답하는지 확인한다.
         * 응답을 잘못 읽고 있으면(형식이 바뀌었거나 다르면) 모든 가게가 "못 찾음"이 되어
         * 좌표가 한꺼번에 인허가 좌표로 밀려난다 — 그 전에 여기서 걸러 아무것도 건드리지 않게 한다
         */
        boolean answersKnownAddress();
    }

    /** 키가 틀렸거나 오늘 쓸 수 있는 양을 다 쓴 경우 — 계속 불러도 다 실패하므로 멈춘다 */
    public static class Unavailable extends RuntimeException {
        public Unavailable(String message) {
            super(message);
        }
    }

    /** 인허가 좌표의 원본 (공공데이터의 영업중 가게 목록) — 네이버 좌표를 되돌릴 때 쓴다 */
    public interface Originals {
        boolean isConfigured();

        List<String> localCodes();

        List<LocalDataClient.Row> openRows(String localCode);
    }

    private static final Logger log = LoggerFactory.getLogger(GeocodeBackfill.class);
    private static final int BATCH = 200;
    // 묶음 전체가 일시 오류(타임아웃·5xx)인 일이 이만큼 이어지면 멈추고 다음 기회에 이어서 한다
    private static final int MAX_CONSECUTIVE_ERRORS = 5;
    // 동시 요청 수. 초당 호출 수는 Locator가 따로 지킨다. DB 커넥션 풀(7)보다 작게
    private static final int WORKERS = 4;

    private final RestaurantRepository repository;
    private final TransactionTemplate tx;
    private final Locator locator;
    private final Originals originals;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final long pauseMillis;
    // 원본에서도 못 찾은 행 때문에 공공데이터를 매번 통째로 다시 받지 않게 — 마지막으로 못 되돌린 행 수
    private volatile long unresolvedReverts = -1;

    @Autowired
    public GeocodeBackfill(RestaurantRepository repository, TransactionTemplate tx, JusoGeocoder locator,
                           LocalDataClient localData, @Value("${localdata.local-codes}") String localCodesCsv) {
        this(repository, tx, locator, new Originals() {
            public boolean isConfigured() { return localData.isConfigured(); }

            public List<String> localCodes() {
                return Arrays.stream(localCodesCsv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
            }

            public List<LocalDataClient.Row> openRows(String localCode) { return localData.fetchAllOpen(localCode); }
        }, 40);
    }

    GeocodeBackfill(RestaurantRepository repository, TransactionTemplate tx, Locator locator, Originals originals,
                    long pauseMillis) {
        this.repository = repository;
        this.tx = tx;
        this.locator = locator;
        this.originals = originals;
        this.pauseMillis = pauseMillis;
    }

    @Override
    public void run(ApplicationArguments args) {
        start();
    }

    // 하루 한도에 걸려 멈춘 날의 다음 날 이어서 한다. 할 일이 없으면 빈 목록만 보고 끝난다
    @Scheduled(cron = "0 20 4 * * *", zone = "Asia/Seoul")
    public void daily() {
        start();
    }

    /** 뒤에서 한 번 돈다. 이미 돌고 있으면 아무것도 안 한다 */
    public void start() {
        if (!locator.isConfigured()) {
            log.info("JUSO_SEARCH_KEY/JUSO_COORD_KEY가 없어 가게 좌표 보정을 건너뜀");
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

    private enum Outcome { MOVED, KEPT, ERROR, STOP }

    /** 주소 좌표로 옮긴 건수를 돌려준다 */
    int fill() {
        if (!locator.answersKnownAddress()) {
            log.error("도로명주소 API가 이미 아는 주소(서울시청)를 제대로 답하지 못해 좌표 보정을 시작하지 않음 — 승인키와 응답 형식을 확인해야 함");
            return 0;
        }
        int moved = 0;
        try {
            moved = relocateAll();
        } finally {
            try {
                revertLeftovers();
            } catch (RuntimeException e) {
                log.warn("네이버 좌표 되돌리기 중단: {}", e.getMessage());
            }
            long left = repository.countHoldingNaverCoords();
            if (left > 0) log.info("네이버 좌표가 아직 남은 가게: {}곳", left);
        }
        return moved;
    }

    private int relocateAll() {
        int moved = 0, kept = 0, errors = 0, batches = 0;
        ExecutorService pool = Executors.newFixedThreadPool(WORKERS, r -> {
            Thread t = new Thread(r, "geocode-worker");
            t.setDaemon(true);
            return t;
        });
        try {
            // 네이버 좌표가 든 행부터 — 저장해 두면 안 되는 좌표라 먼저 바꾼다
            for (boolean fromNaver : new boolean[] {true, false}) {
                while (true) {
                    PageRequest page = PageRequest.of(0, BATCH);
                    List<Object[]> rows = fromNaver
                        ? repository.findCoordPendingFromNaver(Restaurant.Status.OPEN, page)
                        : repository.findCoordPending(Restaurant.Status.OPEN, page);
                    if (rows.isEmpty()) break;
                    List<Future<Outcome>> results = new ArrayList<>();
                    for (Object[] row : rows) results.add(pool.submit(() -> process(row)));
                    int batchErrors = 0;
                    boolean stop = false;
                    for (Future<Outcome> f : results) {
                        Outcome o;
                        try {
                            o = f.get();
                        } catch (ExecutionException e) {
                            o = Outcome.ERROR;
                        }
                        switch (o) {
                            case MOVED -> moved++;
                            case KEPT -> kept++;
                            case ERROR -> batchErrors++;
                            case STOP -> stop = true;
                        }
                    }
                    if (stop) {
                        log.warn("도로명주소 API를 더 쓸 수 없어 좌표 보정 멈춤 (이번에 고침 {}건, 못 찾음 {}건) — 다음에 이어서", moved, kept);
                        return moved;
                    }
                    // 묶음 전체가 오류면 연속 오류로 친다. 일부만 실패한 행은 그대로 남아 다음 묶음에서 다시 잡힌다
                    errors = batchErrors == rows.size() ? errors + 1 : 0;
                    if (errors >= MAX_CONSECUTIVE_ERRORS) {
                        log.warn("도로명주소 API 오류가 이어져 좌표 보정 멈춤 (다음에 이어서)");
                        return moved;
                    }
                    if (batchErrors > 0) pause(1_000);
                    if (++batches % 10 == 0) log.info("가게 좌표 보정 중... 고침 {}건, 못 찾음 {}건", moved, kept);
                }
            }
            if (moved + kept > 0) log.info("가게 좌표 보정 끝: 고침 {}건, 못 찾음 {}건", moved, kept);
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

    // row = [id, roadAddress, address, geocoded]
    private Outcome process(Object[] row) {
        Long id = (Long) row[0];
        boolean holdsNaver = Boolean.TRUE.equals(row[3]);
        final Optional<double[]> found;
        try {
            found = locator.locate((String) row[1], (String) row[2]);
        } catch (Unavailable e) {
            log.warn("도로명주소 API 거절: {}", e.getMessage());
            return Outcome.STOP;
        } catch (RuntimeException e) {
            return Outcome.ERROR;
        }
        Integer changed = found.isPresent()
            ? tx.execute(s -> repository.relocate(id, found.get()[0], found.get()[1]))
            // 못 찾으면 인허가 좌표를 쓴다. 지금 든 좌표가 네이버 것이면 되돌릴 차례를 기다린다
            : tx.execute(s -> repository.markCoordSource(id, holdsNaver ? "REVERT" : "LICENSE"));
        // 0행이면 고치지 못한 것 — 같은 행을 끝없이 다시 잡지 않게 오류로 센다
        if (changed == null || changed == 0) return Outcome.ERROR;
        return found.isPresent() ? Outcome.MOVED : Outcome.KEPT;
    }

    /**
     * 주소로 못 찾았는데 네이버 좌표가 남은 행(REVERT)을 인허가 좌표로 되돌린다.
     * 인허가 좌표는 DB에 따로 남기지 않았으므로 공공데이터의 영업중 목록을 구마다 다시 받아 관리번호(없으면 상호+주소)로 맞춘다.
     * 되돌린 건수를 돌려준다
     */
    int revertLeftovers() {
        List<Object[]> rows = repository.findRevertRows();
        if (rows.isEmpty()) {
            unresolvedReverts = 0;
            return 0;
        }
        // 지난번에 원본에서도 못 찾은 행만 남았으면 다시 받아 봐야 같다 (서버가 다시 켜지면 한 번 더 본다)
        if (rows.size() == unresolvedReverts) return 0;
        if (!originals.isConfigured()) {
            log.warn("LOCALDATA_AUTH_KEY가 없어 네이버 좌표 {}곳을 인허가 좌표로 되돌리지 못함", rows.size());
            return 0;
        }
        Map<String, Long> wanted = new HashMap<>();
        Set<Long> remaining = new HashSet<>();
        for (Object[] r : rows) {
            Long id = (Long) r[0];
            remaining.add(id);
            if (r[4] != null) wanted.put("M:" + r[4], id);
            String road = (String) r[2];
            wanted.putIfAbsent("K:" + RestaurantImportService.key((String) r[1],
                road != null && !road.isBlank() ? road : (String) r[3]), id);
        }
        int reverted = 0;
        for (String code : originals.localCodes()) {
            if (remaining.isEmpty()) break;
            for (LocalDataClient.Row row : originals.openRows(code)) {
                Long id = row.mgtNo() == null ? null : wanted.get("M:" + row.mgtNo());
                if (id == null) id = wanted.get("K:" + RestaurantImportService.key(row));
                if (id == null || !remaining.contains(id)) continue;
                double[] p = RestaurantImportService.toLatLng(row.crdX(), row.crdY());
                if (p == null) continue;
                Long target = id;
                Integer changed = tx.execute(s -> repository.revertToLicense(target, p[0], p[1]));
                if (changed != null && changed > 0) {
                    remaining.remove(id);
                    reverted++;
                }
            }
        }
        unresolvedReverts = remaining.size();
        log.info("네이버 좌표를 인허가 좌표로 되돌림: {}곳", reverted);
        if (!remaining.isEmpty()) {
            log.warn("공공데이터에서 원래 좌표를 못 찾아 네이버 좌표가 남은 가게: {}곳", remaining.size());
        }
        return reverted;
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
