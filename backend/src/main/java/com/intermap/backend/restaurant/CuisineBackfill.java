package com.intermap.backend.restaurant;

import com.intermap.backend.state.ServerState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Types;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 가게마다 필터용 업종을 채운다 — 상가(상권)정보에서 짝을 찾아 소분류를 적고(SbizPlaces), 규칙대로 업종을 정한다(Cuisine).
 *
 * 도는 때:
 *   - 서버가 켜질 때, 규칙 파일이나 상가 파일이 지난번과 달라졌으면 (배포로 새 규칙·새 분기 데이터가 들어왔을 때)
 *   - 매주 금요일 새벽 — 목요일 밤 최신화(RestaurantRefresh)로 들어온 새 가게에 상가 소분류를 덧입힌다
 * 가게를 id 순으로 조금씩 읽어 값이 달라진 행만 고친다. 달라진 게 없으면 읽기만 하고 끝난다.
 */
@Component
public class CuisineBackfill implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(CuisineBackfill.class);
    private static final int PAGE = 2000;
    // 마지막으로 채웠을 때의 규칙·상가 파일 표시를 적어 둔다 (ServerState는 만료가 있어야 해서 넉넉히)
    private static final Duration REMEMBER = Duration.ofDays(3650);

    public record Result(int seen, int matched, int changed) {
    }

    private final RestaurantRepository repository;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final ServerState state;
    private final boolean onStart;
    private final AtomicBoolean running = new AtomicBoolean();

    public CuisineBackfill(RestaurantRepository repository, JdbcTemplate jdbc, TransactionTemplate tx, ServerState state,
                           @Value("${cuisine.backfill.on-start:true}") boolean onStart) {
        this.repository = repository;
        this.jdbc = jdbc;
        this.tx = tx;
        this.state = state;
        this.onStart = onStart;
    }

    // 서버 시작을 막지 않게 뒤에서 돈다
    @Override
    public void run(ApplicationArguments args) {
        if (!onStart) return;
        Thread worker = new Thread(() -> run(true), "cuisine-backfill");
        worker.setDaemon(true);
        worker.start();
    }

    /** 매주 금요일 03:10 (한국시간) */
    @Scheduled(cron = "0 10 3 * * FRI", zone = "Asia/Seoul")
    public void weekly() {
        run(false);
    }

    /**
     * 서버에 실린 상가 파일로 채운다. 실패해도 예외를 밖으로 내지 않는다 (다음에 켜질 때나 금요일에 다시 한다).
     * @param onlyIfStale 규칙·상가 파일이 지난번 채웠을 때와 같으면 건너뛴다
     * @return 실제로 채웠는지
     */
    boolean run(boolean onlyIfStale) {
        try {
            SbizPlaces places = SbizPlaces.load();
            String mark = Cuisine.version() + ":" + places.version();
            if (onlyIfStale && state.get("cuisine", "applied").filter(mark::equals).isPresent()) return false;
            Result result = fill(places);
            if (result == null) return false;
            state.put("cuisine", "applied", mark, REMEMBER);
            log.info("가게 업종 채움: {}곳 중 상가(상권)정보와 짝지은 곳 {}곳, 고친 곳 {}곳", result.seen(), result.matched(), result.changed());
            return true;
        } catch (RuntimeException e) {
            log.warn("가게 업종을 채우지 못했어요 — 다음에 켜질 때나 금요일에 다시 해요: {}", e.toString());
            return false;
        }
    }

    /** 가게 전체를 훑어 상가 소분류와 업종을 맞춘다. 이미 돌고 있으면 null */
    Result fill(SbizPlaces places) {
        if (!running.compareAndSet(false, true)) return null;
        try {
            int seen = 0, matched = 0, changed = 0;
            long after = 0;
            while (true) {
                List<Object[]> rows = repository.findCuisineRows(after, PageRequest.of(0, PAGE));
                if (rows.isEmpty()) break;
                List<Object[]> updates = new ArrayList<>();
                for (Object[] r : rows) {
                    long id = (Long) r[0];
                    after = id;
                    String name = (String) r[1], category = (String) r[2];
                    String oldSbiz = (String) r[5], oldCuisine = (String) r[6];
                    // 상가 파일이 없으면(실리지 않은 빌드) 전에 짝지은 소분류를 지우지 않고 그대로 쓴다
                    String sbiz = places.isEmpty() ? oldSbiz : places.categoryOf(name, (String) r[3], (String) r[4]);
                    String cuisine = Cuisine.of(name, sbiz, category);
                    seen++;
                    if (sbiz != null) matched++;
                    if (!Objects.equals(sbiz, oldSbiz) || !Objects.equals(cuisine, oldCuisine)) {
                        updates.add(new Object[]{sbiz, cuisine, id});
                    }
                }
                if (!updates.isEmpty()) {
                    tx.executeWithoutResult(s -> jdbc.batchUpdate(
                            "update restaurant set sbiz_category = ?, cuisine = ? where id = ?",
                            updates, new int[]{Types.VARCHAR, Types.VARCHAR, Types.BIGINT}));
                    changed += updates.size();
                }
            }
            return new Result(seen, matched, changed);
        } finally {
            running.set(false);
        }
    }
}
