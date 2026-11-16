package com.intermap.backend.ops;

import com.intermap.backend.auth.Admins;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.moderation.Report;
import com.intermap.backend.review.Review;
import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import jakarta.persistence.EntityManager;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import javax.sql.DataSource;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

// 관측 화면(마이페이지 → 서버 상태) — 운영 관리자만 본다.
// 서버가 살아 있는지, 요청이 얼마나 오고 얼마나 느린지, 바깥 서비스가 되는지, 방금 어떤 오류가 났는지, 데이터가 얼마나 쌓였는지.
// 요청·오류 통계는 서버 메모리에 있어 서버가 다시 켜진 뒤부터의 값이다.
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "httpsapp://intermap.app:8443", "https://*.vercel.app"})
public class OpsController {

    public record Pool(int active, int idle, int waiting, int max) {
    }

    public record Server(Instant startedAt, Instant now, long heapUsedMb, long heapMaxMb, Pool dbPool) {
    }

    public record Traffic(long total, long errors, long avgMs, List<RequestMetrics.Hour> hours) {
    }

    // 최근에 가입한 회원. provider = 간편 로그인 종류(naver·kakao·google·apple), 이메일로 가입했으면 null.
    // 이메일 주소는 싣지 않는다 — 누가 들어왔는지는 닉네임으로 충분하다
    public record NewUser(Long id, String nickname, String provider, Instant joinedAt) {
    }

    // 최근에 올라온 후기
    public record NewReview(Long id, String restaurantName, String author, double rating, Instant createdAt) {
    }

    // dbBytes·photoBytes는 PostgreSQL에서만 (로컬 H2에선 null). newUsers·newReviews는 새것부터 RECENT개씩
    public record Data(long users, long usersToday, long usersWeek, long reviews, long reviewsToday, long comments,
                       long openReports, long pushDevices, Long dbBytes, Long photoBytes,
                       List<NewUser> newUsers, List<NewReview> newReviews) {
    }

    private static final int RECENT = 10;

    public record Logs(long errors, long warnings, List<ErrorLog.Entry> recent) {
    }

    public record Ops(Server server, Traffic traffic, List<RequestMetrics.RouteStat> routes, List<RequestMetrics.Slow> slow,
                      List<ExternalCalls.Stat> external, Logs logs, Data data) {
    }

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final AuthController auth;
    private final Admins admins;
    private final RequestMetrics metrics;
    private final ExternalCalls external;
    private final ErrorLog errorLog;
    private final EntityManager em;
    private final JdbcTemplate jdbc;
    private final DataSource dataSource;

    public OpsController(AuthController auth, Admins admins, RequestMetrics metrics, ExternalCalls external,
                         ErrorLog errorLog, EntityManager em, JdbcTemplate jdbc, DataSource dataSource) {
        this.auth = auth;
        this.admins = admins;
        this.metrics = metrics;
        this.external = external;
        this.errorLog = errorLog;
        this.em = em;
        this.jdbc = jdbc;
        this.dataSource = dataSource;
    }

    @GetMapping("/api/admin/ops")
    public ResponseEntity<?> ops(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
        }
        if (!admins.isAdmin(me)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("운영자만 볼 수 있어요."));
        }
        List<RequestMetrics.Hour> hours = metrics.hours();
        long total = hours.stream().mapToLong(RequestMetrics.Hour::count).sum();
        long errors = hours.stream().mapToLong(RequestMetrics.Hour::errors).sum();
        long weighted = hours.stream().mapToLong(h -> h.avgMs() * h.count()).sum();
        Runtime runtime = Runtime.getRuntime();
        return ResponseEntity.ok(new Ops(
                new Server(metrics.startedAt(), Instant.now(),
                        (runtime.totalMemory() - runtime.freeMemory()) >> 20, runtime.maxMemory() >> 20, pool()),
                new Traffic(total, errors, total == 0 ? 0 : weighted / total, hours),
                metrics.routes(12),
                metrics.slow(),
                external.stats(),
                new Logs(errorLog.errors(), errorLog.warnings(), errorLog.recent()),
                data()));
    }

    private Pool pool() {
        if (!(dataSource instanceof HikariDataSource hikari)) return null;
        HikariPoolMXBean bean = hikari.getHikariPoolMXBean();
        if (bean == null) return null;
        return new Pool(bean.getActiveConnections(), bean.getIdleConnections(), bean.getThreadsAwaitingConnection(),
                hikari.getMaximumPoolSize());
    }

    private Data data() {
        Instant today = LocalDate.now(KST).atStartOfDay(KST).toInstant();
        Instant week = today.minusSeconds(6 * 24 * 3600L);
        return new Data(
                count("select count(u) from AppUser u"),
                since("select count(u) from AppUser u where u.createdAt >= :from", today),
                since("select count(u) from AppUser u where u.createdAt >= :from", week),
                count("select count(r) from Review r"),
                since("select count(r) from Review r where r.createdAt >= :from", today),
                count("select count(c) from ReviewComment c"),
                em.createQuery("select count(r) from Report r where r.status = :status", Long.class)
                        .setParameter("status", Report.Status.OPEN).getSingleResult(),
                count("select count(distinct t.user) from PushToken t"),
                bytes("select pg_database_size(current_database())"),
                bytes("select pg_total_relation_size('review_photo') + pg_total_relation_size('user_avatar')"),
                em.createQuery("select u from AppUser u order by u.createdAt desc, u.id desc", AppUser.class)
                        .setMaxResults(RECENT).getResultList().stream()
                        .map(u -> new NewUser(u.getId(), u.getNickname(), u.getProvider(), u.getCreatedAt())).toList(),
                em.createQuery("select r from Review r join fetch r.author order by r.createdAt desc, r.id desc", Review.class)
                        .setMaxResults(RECENT).getResultList().stream()
                        .map(r -> new NewReview(r.getId(), r.getRestaurantName(), r.getAuthor().getNickname(),
                                r.getRating(), r.getCreatedAt())).toList());
    }

    private long count(String jpql) {
        return em.createQuery(jpql, Long.class).getSingleResult();
    }

    private long since(String jpql, Instant from) {
        return em.createQuery(jpql, Long.class).setParameter("from", from).getSingleResult();
    }

    // PostgreSQL 전용 함수라 다른 DB에선 조용히 비운다
    private Long bytes(String sql) {
        try {
            return jdbc.queryForObject(sql, Long.class);
        } catch (Exception e) {
            return null;
        }
    }
}
