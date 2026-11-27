package com.intermap.backend.localdata;

import com.intermap.backend.restaurant.GeocodeBackfill;
import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import com.intermap.backend.state.ServerState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Supplier;

/**
 * 휴게음식점으로 등록한 식당을 처음 한 번 받아 온다 — 1인 샤브·분식·김밥·토스트·버거 가게 가운데는 일반음식점이 아니라
 * 휴게음식점으로 등록한 곳이 있어, 네이버에는 있는데 우리 목록에는 없었다 (샤브토랑 대학로점).
 *
 * - 받는 곳: 업태가 "기타 휴게음식점·일반조리판매·패스트푸드·백화점"이고, 상가(상권)정보에 같은 건물·같은 이름의 음식점으로
 *   잡힌 곳 (RestaurantImportService.toEatery). 업태만으로 받으면 PC방·매점·스터디카페가 섞인다.
 *   서울에서 세어 보니 빠져 있던 11,500곳 가운데 4,600곳이 이렇게 들어온다 (2026-11).
 * - 구 하나를 다 받을 때마다 끝났다고 적어 둔다. 도중에 멈춰도(서버 재시작, API 오류) 남은 구만 이어서 받는다.
 * - 서버가 켜지고 10분 뒤, 그리고 하루 두 번 남은 구가 있으면 받는다. 다 받고 나면 더는 부르지 않는다.
 * - 다 받은 뒤의 새 가게·폐업은 주간 최신화(RestaurantRefresh)가 맡는다.
 * - 이미 있는 가게(같은 관리번호, 또는 같은 상호+주소)는 다시 넣지 않는다.
 */
@Service
public class RestEateryImport implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RestEateryImport.class);
    private static final String STATE_KIND = "rest-eatery-import";
    private static final int BATCH_SIZE = 500;
    private static final Duration REMEMBER = Duration.ofDays(3650);
    // 배포 직후의 업종 채우기(상가 파일을 같이 올린다)·카페 받아 오기와 겹치지 않게
    private static final Duration START_DELAY = Duration.ofMinutes(10);
    // 남은 구가 있으면 이 간격으로 몇 번 더 해 본다. 그래도 남으면 하루 두 번의 예약이 이어 간다
    private static final Duration PAUSE = Duration.ofMinutes(30);
    private static final int ROUNDS = 6;
    private static final int FETCH_TRIES = 5;

    public record Result(int fetched, int added) {
    }

    private final LocalDataClient client;
    private final RestaurantRepository repository;
    private final GeocodeBackfill geocode;
    private final ServerState state;
    private final List<String> localCodes;
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicBoolean looping = new AtomicBoolean();
    // 상가(상권)정보 짝짓기 — 테스트에서 바꿔 끼운다
    Supplier<RestaurantImportService.SbizMatcher> sbizSource = RestaurantImportService::loadSbiz;
    // 공공데이터포털은 응답이 자주 늦는다 — 구 하나가 늦으면 이만큼 쉬고 그 구만 다시 부른다
    Duration fetchPause = Duration.ofSeconds(40);

    public RestEateryImport(LocalDataClient client, RestaurantRepository repository, GeocodeBackfill geocode, ServerState state,
                            @Value("${localdata.local-codes}") String localCodesCsv) {
        this.client = client;
        this.repository = repository;
        this.geocode = geocode;
        this.state = state;
        this.localCodes = List.of(localCodesCsv.split(",")).stream().map(String::trim).filter(c -> !c.isEmpty()).toList();
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!client.isConfigured()) return;
        startInBackground(START_DELAY);
    }

    /** 하루 두 번 — 남은 구가 있으면 이어서 받는다. 다 받았으면 표시만 읽고 끝난다 */
    @Scheduled(cron = "0 10 5,17 * * *", zone = "Asia/Seoul")
    public void retry() {
        if (!client.isConfigured()) return;
        startInBackground(Duration.ZERO);
    }

    private void startInBackground(Duration delay) {
        if (pendingCount() == 0 || !looping.compareAndSet(false, true)) return;
        Thread worker = new Thread(() -> {
            try {
                Thread.sleep(delay.toMillis());
                for (int round = 1; round <= ROUNDS; round++) {
                    try {
                        runPending();
                    } catch (RuntimeException e) {
                        log.warn("휴게음식점 식당 받아 오기 실패 — 잠시 뒤에 이어서 해요: {}", LocalDataClient.safe(e.toString()));
                    }
                    if (pendingCount() == 0) return;
                    Thread.sleep(PAUSE.toMillis());
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                looping.set(false);
            }
        }, "rest-eatery-import");
        worker.setDaemon(true);
        worker.setPriority(Thread.MIN_PRIORITY);
        worker.start();
    }

    private List<String> pending() {
        return localCodes.stream().filter(code -> state.get(STATE_KIND, code).isEmpty()).toList();
    }

    /** 아직 다 받지 못한 구가 몇 개인지 */
    public int pendingCount() {
        return pending().size();
    }

    /**
     * 아직 안 받은 구를 차례로 받는다. API를 끝내 못 부르면 거기서 멈춘다 — 받은 데까지는 남고, 다음에 이어서 한다.
     * 이미 돌고 있으면 아무것도 안 한다.
     */
    public Result runPending() {
        List<String> pending = pending();
        if (pending.isEmpty() || !running.compareAndSet(false, true)) return new Result(0, 0);
        int fetched = 0, added = 0;
        // 주간 최신화·카페 받아 오기와 같이 돌지 않는다 — 저마다 "이미 있는 가게"를 읽어 두고 일한다
        RestaurantImportService.WRITING.lock();
        try {
            RestaurantImportService.SbizMatcher sbiz = sbizSource.get();
            // 기존 가게는 키만 올린다 (엔티티 전체는 서울 규모에서 메모리를 넘긴다) — [id, name, roadAddress, mgtNo]
            Set<String> knownMgtNos = new HashSet<>();
            Set<String> knownNameAddrs = new HashSet<>();
            for (Object[] r : repository.findAllKeys()) {
                if (r[3] != null) knownMgtNos.add((String) r[3]);
                knownNameAddrs.add(RestaurantImportService.key((String) r[1], (String) r[2]));
            }
            for (String code : pending) {
                List<LocalDataClient.Row> rows;
                try {
                    rows = fetch(code);
                } catch (RuntimeException e) {
                    log.warn("휴게음식점 식당 받아 오기를 멈춤 — {} 를 못 받았어요. 남은 {}개 구는 다음에 이어서: {}",
                            code, pending.size() - pending.indexOf(code), LocalDataClient.safe(e.getMessage()));
                    break;
                }
                int here = insert(rows, sbiz, knownMgtNos, knownNameAddrs);
                state.put(STATE_KIND, code, "done", REMEMBER);
                fetched += rows.size();
                added += here;
                log.info("휴게음식점 식당 받아 오기 {}: 영업중 {}건 가운데 새 가게 {}곳", code, rows.size(), here);
            }
        } finally {
            RestaurantImportService.WRITING.unlock();
            running.set(false);
        }
        if (fetched > 0) log.info("휴게음식점 식당 받아 오기: 이번에 영업중 {}건을 보고 {}곳을 넣음, 남은 구 {}개", fetched, added, pendingCount());
        if (added > 0) geocode.start(); // 인허가 좌표는 필지 기준이라 어긋난다 — 주소 좌표로 고친다
        return new Result(fetched, added);
    }

    private List<LocalDataClient.Row> fetch(String code) {
        for (int i = 1; ; i++) {
            try {
                return client.fetchAllOpen(LocalDataClient.Service.REST_CAFE, code);
            } catch (RuntimeException e) {
                if (i == FETCH_TRIES) throw e;
                try {
                    Thread.sleep(fetchPause.toMillis());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw e;
                }
            }
        }
    }

    // 처음 보는 가게만 넣는다. 카페 규칙에 맞는데 아직 없는 곳(카페 받아 오기 뒤에 연 곳)도 같이 넣는다
    private int insert(List<LocalDataClient.Row> rows, RestaurantImportService.SbizMatcher sbiz,
                       Set<String> knownMgtNos, Set<String> knownNameAddrs) {
        List<Restaurant> batch = new ArrayList<>();
        int added = 0;
        for (LocalDataClient.Row row : rows) {
            if (!row.isOpen()) continue;
            if (row.mgtNo() != null && knownMgtNos.contains(row.mgtNo())) continue;
            String key = RestaurantImportService.key(row);
            if (knownNameAddrs.contains(key)) continue;
            Restaurant place = RestaurantImportService.toCafe(LocalDataClient.Service.REST_CAFE, row);
            if (place == null) place = RestaurantImportService.toEatery(row, sbiz);
            if (place == null) continue;
            if (row.mgtNo() != null) knownMgtNos.add(row.mgtNo());
            knownNameAddrs.add(key);
            batch.add(place);
            added++;
            // 묶음마다 저장·해제해서 영속성 컨텍스트가 수천 건을 물고 있지 않게
            if (batch.size() >= BATCH_SIZE) {
                repository.saveAll(batch);
                batch.clear();
            }
        }
        repository.saveAll(batch);
        return added;
    }
}
