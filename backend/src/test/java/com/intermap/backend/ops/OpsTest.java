package com.intermap.backend.ops;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.MailService;
import com.intermap.backend.moderation.ModerationController;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 관측 화면: 운영 관리자(ADMIN_EMAILS)만 보고, 요청·오류·바깥 서비스 상태가 실제로 모인다
@SpringBootTest(properties = "admin.emails=ops-admin@test.local, Second-Admin@test.local")
@Transactional
class OpsTest {

    @Autowired OpsController ops;
    @Autowired AuthController auth;
    @Autowired ModerationController moderation;
    @Autowired AppUserRepository users;
    @Autowired ExternalCalls external;
    @Autowired ErrorLog errorLog;
    @MockitoBean MailService mail;

    private AuthController.AuthResponse signIn(String email) {
        AppUser user = users.findByEmail(email).orElseGet(() ->
                users.save(new AppUser(email, null, "ops" + UUID.randomUUID().toString().substring(0, 8), null)));
        return auth.signIn(user);
    }

    @Test
    void onlyAdminsSeeIt() {
        assertEquals(HttpStatus.UNAUTHORIZED, ops.ops(null).getStatusCode());

        AuthController.AuthResponse member = signIn("member-" + UUID.randomUUID() + "@test.local");
        assertFalse(member.admin());
        assertEquals(HttpStatus.FORBIDDEN, ops.ops("Bearer " + member.token()).getStatusCode());
        assertEquals(HttpStatus.FORBIDDEN, moderation.adminReports("Bearer " + member.token(), "OPEN").getStatusCode());

        // 환경변수에 적은 이메일은 대소문자·공백과 상관없이 관리자
        for (String email : List.of("ops-admin@test.local", "second-admin@test.local")) {
            AuthController.AuthResponse admin = signIn(email);
            assertTrue(admin.admin(), email);
            assertEquals(HttpStatus.OK, ops.ops("Bearer " + admin.token()).getStatusCode());
            assertEquals(HttpStatus.OK, moderation.adminReports("Bearer " + admin.token(), "OPEN").getStatusCode());
        }
    }

    @Test
    void reportsWhatHappened() {
        external.ok(ExternalCalls.MAIL);
        external.fail(ExternalCalls.MAIL, new IllegalStateException("401 Unauthorized: unrecognised IP for someone@example.com"));
        LoggerFactory.getLogger("com.intermap.backend.Probe").error("인증번호 발송 실패 {}", "tester@example.com",
                new IllegalStateException("boom"));

        AuthController.AuthResponse admin = signIn("ops-admin@test.local");
        OpsController.Ops body = (OpsController.Ops) ops.ops("Bearer " + admin.token()).getBody();
        assertNotNull(body);

        ExternalCalls.Stat mailStat = body.external().stream().filter(s -> s.name().equals("mail")).findFirst().orElseThrow();
        assertEquals(1, mailStat.ok());
        assertEquals(1, mailStat.fail());
        assertTrue(mailStat.lastError().contains("unrecognised IP"));
        assertFalse(mailStat.lastError().contains("someone@"), "이메일은 가려서 보여 준다");

        ErrorLog.Entry logged = body.logs().recent().stream()
                .filter(e -> e.message().startsWith("인증번호 발송 실패")).findFirst().orElseThrow();
        assertEquals("ERROR", logged.level());
        assertEquals("Probe", logged.logger());
        assertEquals("인증번호 발송 실패 te***@example.com", logged.message());
        assertEquals("IllegalStateException: boom", logged.error());

        assertTrue(body.data().users() >= 1);
        assertEquals(RequestMetrics.HOURS, body.traffic().hours().size());
        assertTrue(body.server().heapMaxMb() > 0);
    }

    @Test
    void requestStatsByRouteAndHour() {
        RequestMetrics metrics = new RequestMetrics();
        Instant now = Instant.parse("2026-11-13T08:30:00Z");
        for (int i = 0; i < 19; i++) metrics.record("GET /api/reviews", 200, 100, now);
        metrics.record("GET /api/reviews", 500, 2100, now);
        metrics.record("GET /api/users/{id}", 404, 5, now.minusSeconds(3600));
        // 하루도 더 지난 요청은 시간대별 통계에서 빠진다
        metrics.record("GET /api/users/{id}", 200, 5, now.minusSeconds(30 * 3600));

        RequestMetrics.RouteStat reviews = metrics.routes(10).get(0);
        assertEquals("GET /api/reviews", reviews.route(), "시간을 많이 쓴 경로가 먼저");
        assertEquals(20, reviews.count());
        assertEquals(1, reviews.errors(), "500 이상만 오류");
        assertEquals(200, reviews.avgMs());
        assertEquals(100, reviews.p95Ms());
        assertEquals(2100, reviews.maxMs());

        List<RequestMetrics.Hour> hours = metrics.hours(now);
        assertEquals(RequestMetrics.HOURS, hours.size());
        RequestMetrics.Hour current = hours.get(hours.size() - 1);
        assertEquals(20, current.count());
        assertEquals(1, current.errors());
        assertEquals(1, hours.get(hours.size() - 2).count());
        assertEquals(0, hours.get(hours.size() - 2).errors(), "404는 오류가 아니다");
        assertEquals(21, hours.stream().mapToInt(RequestMetrics.Hour::count).sum());

        assertEquals(1, metrics.slow().size());
        assertEquals(2100, metrics.slow().get(0).ms());
    }
}
