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

import com.intermap.backend.state.ServerState;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
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
 *     못 찾았다고 표시할 때 확인한 때를 같이 적는다 — 그때가 없는 표시는 한 번 다시 묻는다
 *
 * 서버 시작 때, 가게를 새로 들여온 뒤, 그리고 매시간 뒤에서 돈다. 도로명주소 API에 하루 건수 제한은 없지만
 * 짧은 시간에 많이 부르면 거절한다(E0007) — 부르는 간격은 Locator가 API가 받아 주는 만큼으로 맞춘다.
 * 실패가 몰리면 동시 요청을 줄이고, API가 아예 답하지 못하면 멈췄다가 다음 시간에 잇는다.
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

        /** 지금 부르는 속도 (진행 로그에 붙인다) */
        default String pace() {
            return "";
        }
    }

    /** 주소와 상관없이 API가 거절한 경우 (키가 틀렸거나, 쓸 수 있는 양을 다 썼거나, 모르는 오류) */
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
    // 묶음 전체가 실패한 일이 이만큼 이어지면 멈추고 다음 기회에 이어서 한다
    private static final int MAX_CONSECUTIVE_ERRORS = 5;
    // 동시에 묻는 수의 기본값. 속도는 Locator가 정한 간격이 붙잡는다 — 응답이 느려져도 그 속도를 채울 만큼만 둔다
    private static final int DEFAULT_WORKERS = 8;

    private final RestaurantRepository repository;
    private final TransactionTemplate tx;
    private final Locator locator;
    private final Originals originals;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final long pauseMillis;
    private final int maxWorkers;
    private volatile String lastRefusal;
    // 되돌리기를 언제 다시 해 볼지 적어 두는 곳 (서버가 다시 켜져도 남게 DB에 둔다)
    private final Notes notes;

    /** 잠깐 적어 두는 메모 — 운영에서는 DB(ServerState), 테스트에서는 메모리 */
    interface Notes {
        Optional<String> get(String key);

        void put(String key, String value, Duration ttl);
    }

    private static Notes inMemoryNotes() {
        Map<String, String> map = new java.util.concurrent.ConcurrentHashMap<>();
        return new Notes() {
            public Optional<String> get(String key) { return Optional.ofNullable(map.get(key)); }

            public void put(String key, String value, Duration ttl) { map.put(key, value); }
        };
    }

    @Autowired
    public GeocodeBackfill(RestaurantRepository repository, TransactionTemplate tx, JusoGeocoder locator,
                           LocalDataClient localData, @Value("${localdata.local-codes}") String localCodesCsv,
                           @Value("${juso.workers:8}") int workers, ServerState serverState) {
        this(repository, tx, locator, new Originals() {
            public boolean isConfigured() { return localData.isConfigured(); }

            public List<String> localCodes() {
                return Arrays.stream(localCodesCsv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
            }

            public List<LocalDataClient.Row> openRows(String localCode) { return localData.fetchAllOpen(LocalDataClient.Service.GENERAL, localCode); }
        }, 40, workers, new Notes() {
            public Optional<String> get(String key) { return serverState.get("geocode", key); }

            public void put(String key, String value, Duration ttl) { serverState.put("geocode", key, value, ttl); }
        });
    }

    GeocodeBackfill(RestaurantRepository repository, TransactionTemplate tx, Locator locator, Originals originals,
                    long pauseMillis) {
        this(repository, tx, locator, originals, pauseMillis, DEFAULT_WORKERS);
    }

    GeocodeBackfill(RestaurantRepository repository, TransactionTemplate tx, Locator locator, Originals originals,
                    long pauseMillis, int workers) {
        this(repository, tx, locator, originals, pauseMillis, workers, inMemoryNotes());
    }

    GeocodeBackfill(RestaurantRepository repository, TransactionTemplate tx, Locator locator, Originals originals,
                    long pauseMillis, int workers, Notes notes) {
        this.repository = repository;
        this.tx = tx;
        this.locator = locator;
        this.originals = originals;
        this.pauseMillis = pauseMillis;
        this.maxWorkers = Math.max(1, workers);
        this.notes = notes;
    }

    @Override
    public void run(ApplicationArguments args) {
        start();
    }

    // 도중에 멈췄으면 다음 시간에 이어서 한다. 할 일이 없으면 빈 목록만 보고 끝난다
    @Scheduled(cron = "0 20 * * * *", zone = "Asia/Seoul")
    public void hourly() {
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

    // REFUSED = API가 주소와 상관없이 거절한 것(키·한도·모르는 오류), ERROR = 잠깐의 오류(타임아웃·5xx)
    private enum Outcome { MOVED, KEPT, ERROR, REFUSED }

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
        int moved = 0, kept = 0, errors = 0, batches = 0, calmBatches = 0;
        int workers = maxWorkers;
        ThreadPoolExecutor pool = new ThreadPoolExecutor(workers, workers, 0L, TimeUnit.MILLISECONDS,
            new LinkedBlockingQueue<>(), r -> {
                Thread t = new Thread(r, "geocode-worker");
                t.setDaemon(true);
                return t;
            });
        // 이번에 실패한 행. 뒤에 남겨 두고 앞으로 나아가고, 다 돈 뒤에 한 번 더 묻는다
        List<Object[]> leftBehind = new ArrayList<>();
        try {
            // 네이버 좌표가 든 행부터 — 저장해 두면 안 되는 좌표라 먼저 바꾼다. 그다음 아직 안 본 행,
            // 마지막으로 확인한 때가 없는 "못 찾음" 표시를 다시 묻는다 (속도 제한을 못 찾은 것으로 잘못 읽던 때의 표시)
            for (int phase = 0; phase < 3; phase++) {
                long after = 0;
                while (true) {
                    PageRequest page = PageRequest.of(0, BATCH);
                    List<Object[]> rows = switch (phase) {
                        case 0 -> repository.findCoordPendingFromNaver(Restaurant.Status.OPEN, after, page);
                        case 1 -> repository.findCoordPending(Restaurant.Status.OPEN, after, page);
                        default -> repository.findCoordRecheck(Restaurant.Status.OPEN, after, page);
                    };
                    if (rows.isEmpty()) break;
                    after = (Long) rows.get(rows.size() - 1)[0];
                    List<Future<Outcome>> results = new ArrayList<>();
                    for (Object[] row : rows) results.add(pool.submit(() -> process(row)));
                    int batchErrors = 0, batchKept = 0, batchRefused = 0;
                    for (int i = 0; i < rows.size(); i++) {
                        Outcome o;
                        try {
                            o = results.get(i).get();
                        } catch (ExecutionException e) {
                            o = Outcome.ERROR;
                        }
                        switch (o) {
                            case MOVED -> moved++;
                            case KEPT -> {
                                kept++;
                                batchKept++;
                            }
                            case ERROR -> {
                                batchErrors++;
                                leftBehind.add(rows.get(i));
                            }
                            case REFUSED -> {
                                batchRefused++;
                                leftBehind.add(rows.get(i));
                            }
                        }
                    }
                    int failed = batchErrors + batchRefused;
                    // 거절이 나왔거나 실패가 묶음의 5%를 넘으면 API가 버거워하거나 막은 것일 수 있다 — 잠깐 쉬고 아는 주소로 확인한다.
                    // 아는 주소도 답하지 못하면 멈추고(다음 시간에 이어서), 답하면 동시 요청을 절반으로 줄여 계속한다
                    boolean struggling = batchRefused > 0 || failed * 20 >= rows.size();
                    if (struggling) {
                        if (batchRefused > 0) log.warn("도로명주소 API 거절 {}건: {}", batchRefused, lastRefusal);
                        pause(batchRefused > 0 ? 5_000 : 1_000);
                        if (!locator.answersKnownAddress()) {
                            log.warn("도로명주소 API를 더 쓸 수 없어 좌표 보정 멈춤 (이번에 고침 {}건, 못 찾음 {}건) — 다음 시간에 이어서", moved, kept);
                            return moved;
                        }
                    }
                    // 한 묶음의 절반 넘게 못 찾았으면 API가 이상해진 것일 수 있다(한도·형식) — 아는 주소로 다시 확인하고,
                    // 답이 틀리면 더 진행하지 않는다. 가게들이 줄줄이 "못 찾음"으로 넘어가는 것을 묶음 하나에서 끊는다
                    if (rows.size() >= 20 && batchKept * 2 > rows.size() && !locator.answersKnownAddress()) {
                        log.error("가게를 못 찾는 일이 몰렸고 도로명주소 API가 아는 주소도 제대로 답하지 못해 좌표 보정 멈춤 (고침 {}건, 못 찾음 {}건)", moved, kept);
                        return moved;
                    }
                    // 묶음 전체가 실패한 일이 이어지면 멈춘다 (아는 주소는 답하는데 가게는 하나도 못 고치는 경우 — DB 문제 등)
                    errors = failed == rows.size() ? errors + 1 : 0;
                    if (errors >= MAX_CONSECUTIVE_ERRORS) {
                        log.warn("오류가 이어져 좌표 보정 멈춤 (다음 시간에 이어서)");
                        return moved;
                    }
                    if (struggling) {
                        calmBatches = 0;
                        if (workers > 1) {
                            workers = Math.max(1, workers / 2);
                            resize(pool, workers);
                            log.warn("도로명주소 API 실패 {}건 — 동시 요청을 {}개로 줄임", failed, workers);
                        }
                    } else if (workers < maxWorkers && ++calmBatches >= 2) {
                        // 조용한 묶음이 이어지면 하나씩 다시 늘린다
                        calmBatches = 0;
                        resize(pool, ++workers);
                    }
                    if (++batches % 10 == 0) log.info("가게 좌표 보정 중... 고침 {}건, 못 찾음 {}건 ({})", moved, kept, locator.pace());
                }
            }
            // 남겨 둔 행을 하나씩 다시 묻는다. 잠깐의 오류였으면 이번에 고쳐진다
            for (Object[] row : leftBehind) {
                switch (process(row)) {
                    case MOVED -> moved++;
                    case KEPT -> kept++;
                    case REFUSED -> {
                        // 다른 주소는 잘 답하는데 이 주소만 거듭 거절됐다 — API가 이 주소에는 답하지 못하는 것이라 못 찾은 것으로 둔다.
                        // (그대로 두면 이 행 때문에 매번 같은 자리에서 걸린다.) 아는 주소도 답하지 못하면 API 쪽 문제라 멈춘다
                        if (!locator.answersKnownAddress()) {
                            log.warn("도로명주소 API를 더 쓸 수 없어 좌표 보정 멈춤 (이번에 고침 {}건, 못 찾음 {}건) — 다음 시간에 이어서", moved, kept);
                            return moved;
                        }
                        if (markNotFound(row)) kept++;
                    }
                    // 또 오류면 그대로 둔다 — 다음 시간에 다시 묻는다
                    case ERROR -> { }
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

    // 묶음 사이(도는 일이 없을 때)에만 부른다. 줄일 때와 늘릴 때 순서가 다르다 — 최대가 기본보다 작아지면 안 된다
    private static void resize(ThreadPoolExecutor pool, int workers) {
        if (workers < pool.getCorePoolSize()) {
            pool.setCorePoolSize(workers);
            pool.setMaximumPoolSize(workers);
        } else {
            pool.setMaximumPoolSize(workers);
            pool.setCorePoolSize(workers);
        }
    }

    // row = [id, roadAddress, address, 네이버 좌표가 들어 있는지]
    private Outcome process(Object[] row) {
        Long id = (Long) row[0];
        final Optional<double[]> found;
        try {
            found = locator.locate((String) row[1], (String) row[2]);
        } catch (Unavailable e) {
            lastRefusal = e.getMessage();
            return Outcome.REFUSED;
        } catch (RuntimeException e) {
            return Outcome.ERROR;
        }
        if (found.isEmpty()) return markNotFound(row) ? Outcome.KEPT : Outcome.ERROR;
        Integer changed = tx.execute(s -> repository.relocate(id, found.get()[0], found.get()[1]));
        // 0행이면 고치지 못한 것 — 오류로 센다
        return changed == null || changed == 0 ? Outcome.ERROR : Outcome.MOVED;
    }

    // 못 찾으면 인허가 좌표를 쓴다. 지금 든 좌표가 네이버 것이면 되돌릴 차례를 기다린다
    private boolean markNotFound(Object[] row) {
        Long id = (Long) row[0];
        boolean holdsNaver = Boolean.TRUE.equals(row[3]);
        Instant now = Instant.now();
        Integer changed = tx.execute(s -> repository.markCoordSource(id, holdsNaver ? "REVERT" : "LICENSE", now));
        return changed != null && changed > 0;
    }

    /**
     * 주소로 못 찾았는데 네이버 좌표가 남은 행(REVERT)을 인허가 좌표로 되돌린다.
     * 인허가 좌표는 DB에 따로 남기지 않았으므로 공공데이터의 영업중 목록을 구마다 다시 받아 관리번호(없으면 상호+주소)로 맞춘다.
     * 되돌린 건수를 돌려준다
     */
    int revertLeftovers() {
        List<Object[]> rows = repository.findRevertRows();
        if (rows.isEmpty()) return 0;
        // 공공데이터를 구마다 통째로 받는 일이라(서울 전체 천 번 넘는 요청) 소득 없이 되풀이하지 않는다:
        //   - 지난번에 끝까지 받아 봤는데도 못 찾은 행만 그대로 남았으면 일주일 뒤에나 다시 본다
        //   - 받다가 실패했으면(공공 API 응답 없음) 하루 뒤에 다시 한다
        String leftover = signature(rows.stream().map(r -> (Long) r[0]).toList());
        if (notes.get(REVERT_UNRESOLVED).filter(leftover::equals).isPresent()) return 0;
        if (notes.get(REVERT_FAILED).isPresent()) return 0;
        if (!originals.isConfigured()) {
            log.warn("LOCALDATA_AUTH_KEY가 없어 네이버 좌표 {}곳을 인허가 좌표로 되돌리지 못함", rows.size());
            return 0;
        }
        Map<String, Long> wanted = new HashMap<>();
        Map<Long, Object[]> remaining = new HashMap<>();
        for (Object[] r : rows) {
            Long id = (Long) r[0];
            remaining.put(id, r);
            if (r[4] != null) wanted.put("M:" + r[4], id);
            String road = (String) r[2];
            wanted.putIfAbsent("K:" + RestaurantImportService.key((String) r[1],
                road != null && !road.isBlank() ? road : (String) r[3]), id);
        }
        int reverted = 0;
        try {
            for (String code : originals.localCodes()) {
                if (remaining.isEmpty()) break;
                for (LocalDataClient.Row row : originals.openRows(code)) {
                    Long id = row.mgtNo() == null ? null : wanted.get("M:" + row.mgtNo());
                    if (id == null) id = wanted.get("K:" + RestaurantImportService.key(row));
                    if (id == null || !remaining.containsKey(id)) continue;
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
        } catch (RuntimeException e) {
            notes.put(REVERT_FAILED, "1", Duration.ofHours(24));
            if (reverted > 0) log.info("네이버 좌표를 인허가 좌표로 되돌림: {}곳", reverted);
            throw new IllegalStateException(e.getMessage() + " — 하루 뒤에 다시 해요", e);
        }
        log.info("네이버 좌표를 인허가 좌표로 되돌림: {}곳", reverted);
        if (!remaining.isEmpty()) {
            notes.put(REVERT_UNRESOLVED, signature(remaining.keySet()), Duration.ofDays(7));
            log.warn("공공데이터의 영업중 목록에 없어 네이버 좌표가 남은 가게: {}곳 (일주일 뒤 다시 확인)", remaining.size());
            // 어떤 가게인지 — 폐업했거나 이름·주소가 바뀐 가게일 가능성이 높다. 운영자가 보고 정리할 수 있게 적는다
            remaining.values().stream().limit(100).forEach(r -> log.warn("  남은 가게: {} | {} | 관리번호 {}",
                r[1], r[2] != null && !((String) r[2]).isBlank() ? r[2] : r[3], r[4] == null ? "없음" : "있음"));
        }
        return reverted;
    }

    private static final String REVERT_UNRESOLVED = "revert-unresolved";
    private static final String REVERT_FAILED = "revert-failed";

    // 남은 행들이 지난번과 같은지 견줄 값 (행 수와 id 묶음의 해시)
    private static String signature(java.util.Collection<Long> ids) {
        return ids.size() + ":" + ids.stream().sorted().toList().hashCode();
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
