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

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 서울 음식점 목록 최신화 — 매주 목요일 22시(한국시간).
 * 인허가 데이터(LOCALDATA)의 최근 변경분을 받아, 새로 문을 연 가게는 넣고 폐업한 가게는 지운다.
 *
 * - 변경분은 매번 한 달 치를 다시 본다. 넣기·지우기 모두 이미 반영된 행에는 아무 일도 하지 않으므로,
 *   한두 주를 건너뛰어도, 중간에 실패해도 다음 번에 따라잡는다.
 * - 무료 서버는 잠들어 있으면 스케줄이 돌지 않는다. 그래서 마지막으로 돈 시각을 적어 두고,
 *   서버가 켜질 때 지난 목요일 22시 것을 아직 안 했으면 그때 돈다. 목요일 22시에 서버를 깨우는 것은
 *   .github/workflows/restaurant-refresh.yml 이 한다.
 * - 이름·주소가 바뀐 가게는 건드리지 않는다 — 후기가 상호+주소로 가게를 찾아서, 고치면 그 후기가 가게를 잃는다.
 * - 폐업한 가게에 달린 후기는 남는다. 가게 행이 없으니 지도에 핀만 서지 않는다 (예전에 폐업으로 표시했을 때와 같다).
 */
@Service
public class RestaurantRefresh implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RestaurantRefresh.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final int BATCH_SIZE = 500;
    static final int DAYS_BACK = 31;
    // 실패한 뒤 따라잡기를 다시 해 보기까지 두는 간격
    private static final Duration RETRY_AFTER = Duration.ofHours(6);

    public record Result(int fetched, int added, int removed) {
    }

    private final LocalDataClient client;
    private final RestaurantRepository repository;
    private final GeocodeBackfill geocode;
    private final ServerState state;
    private final List<String> localCodes;
    private final AtomicBoolean running = new AtomicBoolean(false);

    public RestaurantRefresh(LocalDataClient client, RestaurantRepository repository, GeocodeBackfill geocode,
                             ServerState state, @Value("${localdata.local-codes}") String localCodesCsv) {
        this.client = client;
        this.repository = repository;
        this.geocode = geocode;
        this.state = state;
        this.localCodes = List.of(localCodesCsv.split(","));
    }

    /** 매주 목요일 22:00 (한국시간) */
    @Scheduled(cron = "0 0 22 * * THU", zone = "Asia/Seoul")
    public void weekly() {
        runOnce();
    }

    // 서버가 켜질 때: 지난 목요일 22시 것을 아직 안 했으면 뒤에서 돈다
    @Override
    public void run(ApplicationArguments args) {
        if (!client.isConfigured()) return;
        Instant last = lastRun();
        if (last == null) {
            // 처음 켜진 것 — 지금을 기준으로 삼고 다음 목요일부터 돈다
            remember(Instant.now());
            return;
        }
        if (!last.isBefore(latestSlot(ZonedDateTime.now(KST)))) return;
        // 방금 실패한 것을 서버가 켜질 때마다 다시 부르지 않는다 (무료 서버는 하루에도 여러 번 켜진다 — 공공 API 호출 한도를 아낀다)
        if (state.get("restaurant-refresh", "attempt").isPresent()) return;
        Thread worker = new Thread(this::runOnce, "restaurant-refresh");
        worker.setDaemon(true);
        worker.start();
    }

    // now 이전의 가장 가까운 목요일 22시
    static Instant latestSlot(ZonedDateTime now) {
        ZonedDateTime slot = now.with(TemporalAdjusters.previousOrSame(DayOfWeek.THURSDAY))
                .withHour(22).withMinute(0).withSecond(0).withNano(0);
        if (slot.isAfter(now)) slot = slot.minusWeeks(1);
        return slot.toInstant();
    }

    // 스케줄·따라잡기용: 실패해도 예외를 밖으로 내지 않고, 성공했을 때만 돈 시각을 적는다 (실패하면 나중에 켜질 때 다시 한다)
    private void runOnce() {
        if (!client.isConfigured()) return;
        if (!running.compareAndSet(false, true)) return;
        Instant startedAt = Instant.now();
        try {
            state.put("restaurant-refresh", "attempt", startedAt.toString(), RETRY_AFTER);
            Result result = refresh(DAYS_BACK);
            remember(startedAt);
            log.info("음식점 최신화 끝: 변경분 {}건, 새 가게 {}곳 추가, 폐업 {}곳 삭제", result.fetched(), result.added(), result.removed());
        } catch (RuntimeException e) {
            log.warn("음식점 최신화 실패 — 6시간 뒤부터, 서버가 켜질 때 다시 해요: {}", e.getMessage());
        } finally {
            running.set(false);
        }
    }

    private Instant lastRun() {
        try {
            return state.get("restaurant-refresh", "last").map(Instant::parse).orElse(null);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private void remember(Instant at) {
        state.put("restaurant-refresh", "last", at.toString(), Duration.ofDays(120));
    }

    /**
     * 최근 daysBack일의 변경분을 반영한다. 구 하나씩 받아 바로 반영한다 (25개 구를 한꺼번에 들고 있지 않게).
     * 조회에 실패하면 예외 — 그 앞의 구까지는 반영된 채로 남고, 다시 돌리면 이어서 맞춰진다.
     */
    public Result refresh(int daysBack) {
        if (!client.isConfigured()) {
            throw new IllegalStateException("LOCALDATA_AUTH_KEY 환경변수가 설정되지 않았습니다");
        }
        // 예전에 폐업으로 표시만 해 둔 행부터 지운다
        int removed = repository.deleteByStatus(Restaurant.Status.CLOSED);

        // 기존 가게는 키만 올린다 (엔티티 전체는 서울 규모에서 메모리를 넘긴다) — [id, name, roadAddress, mgtNo]
        Map<String, Long> idByMgtNo = new HashMap<>();
        Map<String, Long> idByNameAddr = new HashMap<>();
        Set<Long> unlinked = new HashSet<>(); // 관리번호가 아직 없는 가게
        for (Object[] r : repository.findAllKeys()) {
            Long id = (Long) r[0];
            if (r[3] != null) idByMgtNo.put((String) r[3], id);
            else unlinked.add(id);
            idByNameAddr.put(RestaurantImportService.key((String) r[1], (String) r[2]), id);
        }

        LocalDate to = LocalDate.now(KST);
        LocalDate from = to.minusDays(daysBack);
        int fetched = 0, added = 0;
        for (String localCode : localCodes) {
            List<LocalDataClient.Row> rows = client.fetchChangedSince(localCode.trim(), from, to);
            fetched += rows.size();

            // 1) 폐업: 관리번호가 같은 가게를 지운다. 관리번호가 없는 가게만 상호+주소로 맞춘다 —
            //    같은 자리에 같은 이름으로 새로 연 가게(관리번호가 다르다)를 옛 가게의 폐업으로 지우지 않게.
            Set<Long> remove = new HashSet<>();
            for (LocalDataClient.Row row : rows) {
                if (!row.isClosed()) continue;
                Long id = row.mgtNo() == null ? null : idByMgtNo.get(row.mgtNo());
                if (id == null) {
                    Long byName = idByNameAddr.get(RestaurantImportService.key(row));
                    if (byName != null && unlinked.contains(byName)) id = byName;
                }
                if (id != null) remove.add(id);
            }

            // 2) 새로 연 가게: 관리번호도, 상호+주소도 처음 보는 영업중 행만 넣는다.
            //    상호+주소가 같은 가게가 이번에 지워지는 것이면(같은 자리에 다시 연 가게) 새로 넣는다.
            List<Restaurant> add = new ArrayList<>();
            Set<String> adding = new HashSet<>();
            for (LocalDataClient.Row row : rows) {
                if (!row.isOpen()) continue;
                if (row.mgtNo() != null && idByMgtNo.containsKey(row.mgtNo())) continue;
                String key = RestaurantImportService.key(row);
                Long sameNameAddr = idByNameAddr.get(key);
                if (sameNameAddr != null && !remove.contains(sameNameAddr)) continue;
                if (!adding.add(key)) continue;
                Restaurant restaurant = RestaurantImportService.toRestaurant(row);
                if (restaurant != null) add.add(restaurant);
            }

            List<Long> ids = new ArrayList<>(remove);
            for (int i = 0; i < ids.size(); i += BATCH_SIZE) {
                repository.deleteAllByIdInBatch(ids.subList(i, Math.min(ids.size(), i + BATCH_SIZE)));
            }
            for (int i = 0; i < add.size(); i += BATCH_SIZE) {
                repository.saveAll(add.subList(i, Math.min(add.size(), i + BATCH_SIZE)));
            }
            removed += ids.size();
            added += add.size();
            log.info("LOCALDATA {} 변경분 {}건: 추가 {}곳, 삭제 {}곳", localCode, rows.size(), add.size(), ids.size());
        }
        if (added > 0) geocode.start(); // 새 가게 좌표를 네이버 기준으로 고친다
        return new Result(fetched, added, removed);
    }
}
