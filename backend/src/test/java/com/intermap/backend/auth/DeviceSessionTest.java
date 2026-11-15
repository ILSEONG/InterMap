package com.intermap.backend.auth;

import com.intermap.backend.push.PushService;
import com.intermap.backend.social.NotificationController;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

// 기기별 로그인 — 다른 기기에서 로그인해도 먼저 쓰던 기기가 풀리지 않고, 처음 보는 기기는 알린다
@SpringBootTest
@Transactional
class DeviceSessionTest {

    private static final String PHONE = "phone-device-0000000001";
    private static final String PC = "pc-device-000000000002";
    private static final String PHONE_UA = "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36";
    private static final String PC_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

    @Autowired AuthController auth;
    @Autowired NotificationController notifications;
    @Autowired AppUserRepository users;
    @Autowired AuthSessionRepository sessions;
    @MockitoBean PushService push;

    @AfterEach
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    // 이 기기에서 온 요청인 것처럼
    private static void from(String deviceId, String userAgent) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        if (deviceId != null) request.addHeader("X-Device-Id", deviceId);
        if (userAgent != null) request.addHeader("User-Agent", userAgent);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }

    private AppUser user() {
        String id = UUID.randomUUID().toString().substring(0, 8);
        return users.save(new AppUser("dev" + id + "@test.local", new BCryptPasswordEncoder().encode("pw-" + id), "dev" + id, null));
    }

    private static String bearer(AuthController.AuthResponse session) {
        return "Bearer " + session.token();
    }

    @Test
    void secondDeviceDoesNotSignOutTheFirst() {
        AppUser u = user();
        from(PHONE, PHONE_UA);
        var phone = auth.signIn(u);
        from(PC, PC_UA);
        var pc = auth.signIn(u);

        assertEquals(u.getId(), auth.currentUser(bearer(phone)).getId(), "먼저 로그인한 기기는 그대로");
        assertEquals(u.getId(), auth.currentUser(bearer(pc)).getId());

        // 로그아웃은 그 기기만
        auth.logout(bearer(pc));
        assertNull(auth.currentUser(bearer(pc)));
        assertNotNull(auth.currentUser(bearer(phone)));
    }

    @Test
    void firstSeenDeviceIsAnnouncedOnce() {
        AppUser u = user();
        from(PHONE, PHONE_UA);
        var phone = auth.signIn(u);
        // 가입 직후 첫 기기는 알릴 곳이 없다
        verify(push, never()).send(any(), anyString(), anyString(), any());

        from(PC, PC_UA);
        var pc = auth.signIn(u);
        verify(push, times(1)).send(eq(u), anyString(), anyString(), any());

        // 같은 기기에서 다시 로그인하면 알리지 않는다 (예전 토큰은 못 쓴다)
        auth.logout(bearer(pc));
        var pcAgain = auth.signIn(u);
        verify(push, times(1)).send(eq(u), anyString(), anyString(), any());
        assertNull(auth.currentUser(bearer(pc)));
        assertNotNull(auth.currentUser(bearer(pcAgain)));

        // 알림 목록: 폰에는 "새 기기"가 보이고, 그 기기 자신(PC)에는 안 보인다
        from(PHONE, PHONE_UA);
        var onPhone = (NotificationController.Response) notifications.list(bearer(phone)).getBody();
        var newDevice = onPhone.items().stream().filter(i -> i.type().equals("NEW_DEVICE")).toList();
        assertEquals(1, newDevice.size());
        assertEquals("Windows PC · Chrome", newDevice.get(0).text());
        from(PC, PC_UA);
        var onPc = (NotificationController.Response) notifications.list(bearer(pcAgain)).getBody();
        assertTrue(onPc.items().stream().noneMatch(i -> i.type().equals("NEW_DEVICE")));
    }

    @Test
    void logoutOthersKeepsOnlyThisDevice() {
        AppUser u = user();
        from(PHONE, PHONE_UA);
        var phone = auth.signIn(u);
        from(PC, PC_UA);
        var pc = auth.signIn(u);

        from(PHONE, PHONE_UA);
        var response = auth.logoutOthers(bearer(phone));
        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertEquals(1, ((AuthController.EndedResponse) response.getBody()).ended());
        assertNotNull(auth.currentUser(bearer(phone)));
        assertNull(auth.currentUser(bearer(pc)));
        assertEquals(HttpStatus.UNAUTHORIZED, auth.logoutOthers(bearer(pc)).getStatusCode());
    }

    @Test
    void oldStyleTokenKeepsWorkingAndMovesToItsDevice() {
        // 기기별 로그인 전에 발급된 토큰 (AppUser.token)
        AppUser u = user();
        String token = UUID.randomUUID().toString();
        u.issueToken(token);
        users.save(u);

        // 예전 앱(기기 식별값 없음)은 그대로 통한다
        assertEquals(u.getId(), auth.currentUser("Bearer " + token).getId());
        assertTrue(sessions.findByUserAndDeviceId(u, PHONE).isEmpty());

        // 새 앱으로 올리면 같은 토큰이 그 기기의 로그인으로 옮겨진다
        from(PHONE, PHONE_UA);
        assertEquals(u.getId(), auth.currentUser("Bearer " + token).getId());
        AuthSession moved = sessions.findByUserAndDeviceId(u, PHONE).orElseThrow();
        assertEquals("Android 앱 (SM-S918N)", moved.getDeviceLabel());
        assertEquals(u.getId(), auth.currentUser("Bearer " + token).getId());

        // 그 뒤 다른 기기에서 로그인하면 알린다 — 그리고 폰은 풀리지 않는다
        from(PC, PC_UA);
        auth.signIn(u);
        verify(push, times(1)).send(eq(u), anyString(), anyString(), any());
        from(PHONE, PHONE_UA);
        assertNotNull(auth.currentUser("Bearer " + token));
    }

    @Test
    void deviceLabels() {
        assertEquals("Android 앱 (SM-S918N)", Sessions.deviceLabelOf(PHONE_UA));
        assertEquals("Windows PC · Chrome", Sessions.deviceLabelOf(PC_UA));
        assertEquals("Android · Chrome", Sessions.deviceLabelOf(
                "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"));
        assertEquals("iPhone 앱", Sessions.deviceLabelOf(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"));
        assertEquals("iPhone · Safari", Sessions.deviceLabelOf(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"));
        assertEquals("Mac · Safari", Sessions.deviceLabelOf(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"));
        assertEquals("알 수 없는 기기", Sessions.deviceLabelOf(null));
    }
}
