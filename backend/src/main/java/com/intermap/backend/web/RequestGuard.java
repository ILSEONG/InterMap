package com.intermap.backend.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

// 마구잡이 요청을 문 앞에서 막는다.
//   1) IP별 분당 요청 수 제한 — 스크립트로 긁어 가거나 서버를 지치게 하는 요청. 로그인·가입 쪽은 더 빡빡하게
//      (계정별 잠금·인증번호 횟수 제한은 AuthController가 따로 한다 — 이건 IP를 바꿔 가며 여러 계정을 두드리는 걸 늦춘다)
//   2) 지나치게 큰 JSON 본문 거절
//   3) 모든 응답에 보안 헤더
// 서버 한 대 기준으로 메모리에서 센다 (여러 대가 되면 대수만큼 느슨해질 뿐 뚫리는 건 아니다).
// 제한은 인터셉터에서 건다 — @CrossOrigin 처리 뒤라서 429 응답에도 CORS 헤더가 붙어 앱이 안내 문구를 읽을 수 있다.
@Component
public class RequestGuard implements HandlerInterceptor, WebMvcConfigurer {

    private static final Logger log = LoggerFactory.getLogger(RequestGuard.class);

    // JSON 본문 상한 — 후기 글(2000자)·투표 후보 묶음이 가장 큰 요청이다. 사진은 multipart라 따로(설정의 2MB/21MB)
    static final long MAX_JSON_BYTES = 256 * 1024;
    // 이보다 많은 IP를 한꺼번에 기억하지 않는다 (메모리 고갈 방지) — 넘치면 지난 분 기록부터 비운다
    private static final int MAX_TRACKED = 100_000;

    private static final class Window {
        final long minute;
        final AtomicInteger all = new AtomicInteger();
        final AtomicInteger auth = new AtomicInteger();

        Window(long minute) {
            this.minute = minute;
        }
    }

    private final ConcurrentHashMap<String, Window> windows = new ConcurrentHashMap<>();
    private final int perMinute;
    private final int authPerMinute;

    // 기본값: 한 IP에서 분당 600건(초당 10건) — 지도 넘기기·사진 불러오기를 넉넉히 덮고, 같은 공유기 여러 명도 걸리지 않는다.
    // 로그인·가입·인증번호는 분당 30건
    @Autowired
    public RequestGuard(@Value("${guard.per-minute:600}") int perMinute, @Value("${guard.auth-per-minute:30}") int authPerMinute) {
        this.perMinute = perMinute;
        this.authPerMinute = authPerMinute;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(this);
    }

    // Render 앞단(Cloudflare)이 넣는 CF-Connecting-IP를 먼저 본다 — 클라이언트가 보낸 값을 덮어써서 위조가 안 된다
    static String clientIp(HttpServletRequest request) {
        String cf = request.getHeader("CF-Connecting-IP");
        String forwarded = request.getHeader("X-Forwarded-For");
        String ip = cf != null && !cf.isBlank() ? cf.trim()
                : forwarded == null || forwarded.isBlank() ? request.getRemoteAddr() : forwarded.split(",")[0].trim();
        if (ip == null) return "unknown";
        return ip.length() > 45 ? ip.substring(0, 45) : ip;
    }

    // 로그에는 끝자리를 가린다
    private static String masked(String ip) {
        int cut = Math.max(ip.lastIndexOf('.'), ip.lastIndexOf(':'));
        return cut > 0 ? ip.substring(0, cut + 1) + "*" : ip;
    }

    private static boolean isAuthWrite(HttpServletRequest request) {
        String method = request.getMethod();
        return request.getRequestURI().startsWith("/api/auth/") && ("POST".equals(method) || "PUT".equals(method));
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws IOException {
        // 사전 요청(OPTIONS)은 세지 않는다 — 본 요청이 세어진다
        if ("OPTIONS".equals(request.getMethod())) return true;

        String type = request.getContentType();
        if (type != null && type.toLowerCase().startsWith(MediaType.APPLICATION_JSON_VALUE)
                && request.getContentLengthLong() > MAX_JSON_BYTES) {
            return reject(response, HttpStatus.PAYLOAD_TOO_LARGE, "보낸 내용이 너무 커요.");
        }

        long minute = System.currentTimeMillis() / 60_000;
        String ip = clientIp(request);
        if (windows.size() > MAX_TRACKED) sweep(minute);
        Window window = windows.compute(ip, (k, w) -> w == null || w.minute != minute ? new Window(minute) : w);
        int all = window.all.incrementAndGet();
        int auth = isAuthWrite(request) ? window.auth.incrementAndGet() : 0;
        if (all > perMinute || auth > authPerMinute) {
            // 넘는 순간 한 번만 적는다 (서버 상태 화면의 최근 경고에 보인다)
            if (all == perMinute + 1 || auth == authPerMinute + 1) {
                log.warn("요청 제한에 걸림: {} ({} {}, 이번 분 {}건)", masked(ip), request.getMethod(), request.getRequestURI(), all);
            }
            response.setHeader("Retry-After", "60");
            return reject(response, HttpStatus.TOO_MANY_REQUESTS, "요청이 너무 많아요. 잠시 후 다시 시도해주세요.");
        }
        return true;
    }

    private static boolean reject(HttpServletResponse response, HttpStatus status, String message) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.getWriter().write("{\"message\":\"" + message + "\"}");
        return false;
    }

    private void sweep(long minute) {
        windows.values().removeIf(w -> w.minute != minute);
    }

    @Scheduled(fixedDelay = 60_000)
    public void sweepOld() {
        sweep(System.currentTimeMillis() / 60_000);
    }

    // 보안 헤더 — 모든 응답에. 내용 형식 추측 금지, 다른 사이트의 틀(iframe) 안에 못 넣게, 주소를 밖으로 흘리지 않게,
    // HTTPS로만 접속(운영). API 응답(JSON·사진)은 그 자체로 아무것도 실행·불러오지 못하게 CSP를 닫아 둔다
    @Bean
    FilterRegistrationBean<OncePerRequestFilter> securityHeadersFilter() {
        OncePerRequestFilter filter = new OncePerRequestFilter() {
            @Override
            protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                    throws ServletException, IOException {
                response.setHeader("X-Content-Type-Options", "nosniff");
                response.setHeader("X-Frame-Options", "DENY");
                response.setHeader("Referrer-Policy", "no-referrer");
                if (request.isSecure() || "https".equalsIgnoreCase(request.getHeader("X-Forwarded-Proto"))) {
                    response.setHeader("Strict-Transport-Security", "max-age=31536000");
                }
                if (request.getRequestURI().startsWith("/api/")) {
                    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
                }
                chain.doFilter(request, response);
            }
        };
        FilterRegistrationBean<OncePerRequestFilter> bean = new FilterRegistrationBean<>(filter);
        bean.setOrder(Ordered.HIGHEST_PRECEDENCE + 5);
        return bean;
    }
}
