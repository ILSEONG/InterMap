package com.intermap.backend.ops;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// API 요청 통계 — 관측 화면(OpsController)이 읽는다.
// 경로별 호출 수·오류 수·응답 시간, 최근 24시간의 시간대별 요청, 느렸던 요청 몇 건을 서버 메모리에 든다.
// 메모리에만 있으므로 서버가 다시 켜지면 0부터 다시 센다 (화면에 "서버 시작 이후"라고 밝힌다).
// 경로는 실제 주소가 아니라 컨트롤러 패턴(/api/users/{id})으로 묶는다 — 주소마다 따로 세면 종류가 끝없이 늘어난다.
@Component
public class RequestMetrics {

    public record RouteStat(String route, long count, long errors, long avgMs, long p95Ms, long maxMs) {
    }

    public record Hour(Instant at, int count, int errors, long avgMs) {
    }

    public record Slow(Instant at, String route, long ms, int status) {
    }

    static final int HOURS = 24;
    private static final int SAMPLE = 200;
    private static final long SLOW_MS = 1000;
    private static final int SLOW_KEEP = 20;
    private static final int MAX_ROUTES = 300;
    private static final String UNMATCHED = "(없는 주소)";

    private static final class Route {
        long count;
        long errors;
        long totalMs;
        long maxMs;
        final long[] recent = new long[SAMPLE];
        int filled;
        int next;
    }

    private final Instant startedAt = Instant.now();
    private final Map<String, Route> routes = new ConcurrentHashMap<>();
    private final long[] hourKey = new long[HOURS];
    private final int[] hourCount = new int[HOURS];
    private final int[] hourErrors = new int[HOURS];
    private final long[] hourMs = new long[HOURS];
    private final Deque<Slow> slow = new ArrayDeque<>();

    public Instant startedAt() {
        return startedAt;
    }

    // status 500 이상만 "오류"로 센다 — 4xx는 잘못된 입력·로그인 만료 같은 정상적인 거절이다
    public void record(String route, int status, long ms) {
        record(route, status, ms, Instant.now());
    }

    void record(String route, int status, long ms, Instant at) {
        boolean error = status >= 500;
        if (routes.size() < MAX_ROUTES || routes.containsKey(route)) {
            Route r = routes.computeIfAbsent(route, k -> new Route());
            synchronized (r) {
                r.count++;
                if (error) r.errors++;
                r.totalMs += ms;
                r.maxMs = Math.max(r.maxMs, ms);
                r.recent[r.next] = ms;
                r.next = (r.next + 1) % SAMPLE;
                r.filled = Math.min(SAMPLE, r.filled + 1);
            }
        }
        synchronized (this) {
            long key = at.getEpochSecond() / 3600;
            int i = (int) (key % HOURS);
            if (hourKey[i] != key) {
                hourKey[i] = key;
                hourCount[i] = 0;
                hourErrors[i] = 0;
                hourMs[i] = 0;
            }
            hourCount[i]++;
            if (error) hourErrors[i]++;
            hourMs[i] += ms;
            if (ms >= SLOW_MS) {
                slow.addFirst(new Slow(at, route, ms, status));
                while (slow.size() > SLOW_KEEP) slow.removeLast();
            }
        }
    }

    // 시간을 많이 쓴 순(호출 수 × 평균)으로 — 느린 데다 자주 불리는 것이 먼저 손볼 곳이다
    public List<RouteStat> routes(int limit) {
        List<RouteStat> stats = new ArrayList<>();
        List<long[]> weights = new ArrayList<>();
        for (Map.Entry<String, Route> e : routes.entrySet()) {
            Route r = e.getValue();
            synchronized (r) {
                long[] sorted = Arrays.copyOf(r.recent, r.filled);
                Arrays.sort(sorted);
                long p95 = sorted.length == 0 ? 0 : sorted[Math.min(sorted.length - 1, (int) Math.ceil(sorted.length * 0.95) - 1)];
                stats.add(new RouteStat(e.getKey(), r.count, r.errors, r.count == 0 ? 0 : r.totalMs / r.count, p95, r.maxMs));
                weights.add(new long[]{r.totalMs});
            }
        }
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < stats.size(); i++) order.add(i);
        order.sort(Comparator.comparingLong((Integer i) -> weights.get(i)[0]).reversed());
        return order.stream().limit(limit).map(stats::get).toList();
    }

    // 지금 시각이 든 시간까지 24칸, 오래된 것부터
    public synchronized List<Hour> hours() {
        return hours(Instant.now());
    }

    synchronized List<Hour> hours(Instant now) {
        long current = now.getEpochSecond() / 3600;
        List<Hour> out = new ArrayList<>();
        for (long key = current - HOURS + 1; key <= current; key++) {
            int i = (int) (key % HOURS);
            boolean live = hourKey[i] == key;
            int count = live ? hourCount[i] : 0;
            out.add(new Hour(Instant.ofEpochSecond(key * 3600), count, live ? hourErrors[i] : 0,
                    count == 0 ? 0 : hourMs[i] / count));
        }
        return out;
    }

    public synchronized List<Slow> slow() {
        return List.copyOf(slow);
    }

    @Bean
    FilterRegistrationBean<OncePerRequestFilter> requestMetricsFilter() {
        RequestMetrics metrics = this;
        FilterRegistrationBean<OncePerRequestFilter> bean = new FilterRegistrationBean<>(new OncePerRequestFilter() {
            @Override
            protected boolean shouldNotFilter(HttpServletRequest request) {
                // 사전 요청(OPTIONS)과 관측 화면 자신의 조회는 세지 않는다
                return "OPTIONS".equals(request.getMethod()) || request.getRequestURI().endsWith("/api/admin/ops");
            }

            @Override
            protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                    throws ServletException, IOException {
                long started = System.nanoTime();
                boolean failed = true;
                try {
                    chain.doFilter(request, response);
                    failed = false;
                } finally {
                    Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
                    String route = pattern == null ? UNMATCHED : request.getMethod() + " " + pattern;
                    metrics.record(route, failed ? 500 : response.getStatus(), (System.nanoTime() - started) / 1_000_000);
                }
            }
        });
        bean.addUrlPatterns("/api/*");
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return bean;
    }
}
