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

/**
 * 카페를 처음 한 번 받아 온다 — 서울 25개 구의 영업중 휴게음식점·제과점영업을 전부 받아, 카페(카페·베이커리·디저트)만 가게로 넣는다.
 * 가게 목록은 일반음식점 인허가로만 채워 왔는데, 카페는 주로 휴게음식점으로, 빵집은 제과점으로 등록해서 대부분 빠져 있었다.
 *
 * - (인허가 종류, 구) 하나를 다 받을 때마다 끝났다고 적어 둔다. 도중에 멈춰도(서버 재시작, API 오류) 남은 것만 이어서 받는다.
 * - 이 두 API는 공공데이터포털에서 따로 활용신청을 해야 불린다. 신청 전이면 첫 호출에서 멈추고, 다음 번에 다시 해 본다
 *   (서버가 켜지고 3분 뒤, 그리고 하루 네 번). 다 받고 나면 더는 부르지 않는다.
 * - 다 받은 뒤의 새 카페·폐업은 주간 최신화(RestaurantRefresh)가 맡는다.
 * - 이미 있는 가게(같은 관리번호, 또는 같은 상호+주소 — 일반음식점으로 등록한 카페)는 다시 넣지 않는다.
 */
@Service
public class CafeImport implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(CafeImport.class);
    static final List<LocalDataClient.Service> SERVICES = List.of(LocalDataClient.Service.REST_CAFE, LocalDataClient.Service.BAKERY);
    private static final int BATCH_SIZE = 500;
    // 다 받았다는 표시를 적어 두는 기간 (ServerState는 만료가 있어야 해서 넉넉히)
    private static final Duration REMEMBER = Duration.ofDays(3650);
    // 서버가 켜진 뒤 이만큼 지나서 시작한다 — 배포 직후의 상태 확인, 업종 채우기(90초 뒤)와 겹치지 않게
    private static final Duration START_DELAY = Duration.ofMinutes(3);

    public record Result(int fetched, int added) {
    }

    private record Pending(LocalDataClient.Service service, String localCode) {
        String key() {
            return service.path() + ":" + localCode;
        }
    }

    private final LocalDataClient client;
    private final RestaurantRepository repository;
    private final GeocodeBackfill geocode;
    private final ServerState state;
    private final List<String> localCodes;
    private final AtomicBoolean running = new AtomicBoolean();

    public CafeImport(LocalDataClient client, RestaurantRepository repository, GeocodeBackfill geocode, ServerState state,
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

    /** 하루 네 번 — 남은 구가 있으면 이어서 받는다. 다 받았으면 표시만 읽고 끝난다 */
    @Scheduled(cron = "0 40 4,10,16,22 * * *", zone = "Asia/Seoul")
    public void retry() {
        if (!client.isConfigured()) return;
        startInBackground(Duration.ZERO);
    }

    // 구 25곳 × 두 종류를 받는 데 몇 분씩 걸린다 — 서버 시작도, 다른 예약 작업도 막지 않게 따로 돈다
    private void startInBackground(Duration delay) {
        Thread worker = new Thread(() -> {
            try {
                Thread.sleep(delay.toMillis());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            try {
                runPending();
            } catch (RuntimeException e) {
                log.warn("카페 받아 오기 실패 — 다음 번에 이어서 해요: {}", e.toString());
            }
        }, "cafe-import");
        worker.setDaemon(true);
        worker.setPriority(Thread.MIN_PRIORITY);
        worker.start();
    }

    private List<Pending> pending() {
        List<Pending> out = new ArrayList<>();
        for (LocalDataClient.Service service : SERVICES) {
            for (String code : localCodes) {
                Pending p = new Pending(service, code);
                if (state.get("cafe-import", p.key()).isEmpty()) out.add(p);
            }
        }
        return out;
    }

    /** 아직 다 받지 못한 (인허가 종류, 구)가 몇 개인지 */
    public int pendingCount() {
        return pending().size();
    }

    /**
     * 아직 안 받은 (인허가 종류, 구)를 차례로 받는다. API를 못 부르면 거기서 멈춘다 — 받은 데까지는 남고, 다음에 이어서 한다.
     * 이미 돌고 있으면 아무것도 안 한다.
     */
    public Result runPending() {
        List<Pending> pending = pending();
        if (pending.isEmpty() || !running.compareAndSet(false, true)) return new Result(0, 0);
        int fetched = 0, added = 0;
        // 주간 최신화와 같이 돌지 않는다 — 둘 다 "이미 있는 가게"를 읽어 두고 일한다
        RestaurantImportService.WRITING.lock();
        try {
            Set<String> knownMgtNos = null;
            Set<String> knownNameAddrs = null;
            for (Pending p : pending) {
                List<LocalDataClient.Row> rows;
                try {
                    rows = client.fetchAllOpen(p.service(), p.localCode());
                } catch (RuntimeException e) {
                    log.warn("카페 받아 오기를 멈춤 — {} {} 를 못 받았어요 (공공데이터포털에서 이 API를 활용신청했는지 확인). 남은 {}개는 다음에 이어서: {}",
                            p.service().label(), p.localCode(), pending.size() - pending.indexOf(p), e.getMessage());
                    break;
                }
                if (knownMgtNos == null) {
                    // 기존 가게는 키만 올린다 (엔티티 전체는 서울 규모에서 메모리를 넘긴다) — [id, name, roadAddress, mgtNo]
                    knownMgtNos = new HashSet<>();
                    knownNameAddrs = new HashSet<>();
                    for (Object[] r : repository.findAllKeys()) {
                        if (r[3] != null) knownMgtNos.add((String) r[3]);
                        knownNameAddrs.add(RestaurantImportService.key((String) r[1], (String) r[2]));
                    }
                }
                int here = insert(p.service(), rows, knownMgtNos, knownNameAddrs);
                state.put("cafe-import", p.key(), "done", REMEMBER);
                fetched += rows.size();
                added += here;
                log.info("카페 받아 오기 {} {}: 영업중 {}건 가운데 새 카페 {}곳", p.service().label(), p.localCode(), rows.size(), here);
            }
        } finally {
            RestaurantImportService.WRITING.unlock();
            running.set(false);
        }
        if (fetched > 0) log.info("카페 받아 오기: 이번에 영업중 {}건을 보고 카페 {}곳을 넣음, 남은 구 {}개", fetched, added, pendingCount());
        if (added > 0) geocode.start(); // 인허가 좌표는 필지 기준이라 어긋난다 — 주소 좌표로 고친다
        return new Result(fetched, added);
    }

    // 처음 보는 카페만 넣는다. 넣은 것은 known에 더해, 같은 가게가 두 인허가에 다 있어도 한 번만 넣는다
    private int insert(LocalDataClient.Service service, List<LocalDataClient.Row> rows, Set<String> knownMgtNos, Set<String> knownNameAddrs) {
        List<Restaurant> batch = new ArrayList<>();
        int added = 0;
        for (LocalDataClient.Row row : rows) {
            if (!row.isOpen()) continue;
            if (row.mgtNo() != null && knownMgtNos.contains(row.mgtNo())) continue;
            String key = RestaurantImportService.key(row);
            if (knownNameAddrs.contains(key)) continue;
            Restaurant cafe = RestaurantImportService.toCafe(service, row);
            if (cafe == null) continue;
            if (row.mgtNo() != null) knownMgtNos.add(row.mgtNo());
            knownNameAddrs.add(key);
            batch.add(cafe);
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
