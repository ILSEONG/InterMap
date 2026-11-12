package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.push.PushController;
import com.intermap.backend.push.PushService;
import com.intermap.backend.push.PushTokenRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 푸시 기기 토큰: 등록, 같은 폰에서 계정을 바꿨을 때 옮겨 가기, 로그아웃 해제.
// 테스트에는 FCM 키가 없다 — 발송은 조용히 건너뛰고 팔로우·댓글은 그대로 동작해야 한다.
@SpringBootTest
@Transactional
class PushTokenTest {

    @Autowired
    PushController controller;
    @Autowired
    PushTokenRepository tokens;
    @Autowired
    PushService push;
    @Autowired
    AppUserRepository users;
    @Autowired
    SocialController social;

    private AppUser user(String name) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        return users.save(new AppUser(name + suffix + "@test.local", null, name + suffix, null));
    }

    private String bearer(AppUser u) {
        String token = UUID.randomUUID().toString();
        u.issueToken(token);
        users.save(u);
        return "Bearer " + token;
    }

    @Test
    void registersMovesAndRemovesDeviceToken() {
        AppUser a = user("a");
        AppUser b = user("b");
        String device = "device-" + UUID.randomUUID();

        assertEquals(HttpStatus.UNAUTHORIZED, controller.register(null, new PushController.TokenRequest(device, "android")).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, controller.register(bearer(a), new PushController.TokenRequest(" ", "android")).getStatusCode());

        assertEquals(HttpStatus.OK, controller.register(bearer(a), new PushController.TokenRequest(device, "android")).getStatusCode());
        // 다시 켤 때마다 등록해도 한 줄
        controller.register(bearer(a), new PushController.TokenRequest(device, null));
        assertEquals(List.of(device), tokens.tokensOf(a));

        // 같은 폰에서 b로 로그인 — 토큰이 b에게 옮겨 간다
        controller.register(bearer(b), new PushController.TokenRequest(device, "android"));
        tokens.flush();
        assertTrue(tokens.tokensOf(a).isEmpty());
        assertEquals(List.of(device), tokens.tokensOf(b));

        // 로그아웃 — 세션 없이도 그 기기만 해제된다
        assertEquals(HttpStatus.OK, controller.unregister(new PushController.TokenRequest(device, null)).getStatusCode());
        assertTrue(tokens.tokensOf(b).isEmpty());
    }

    @Test
    void followStillWorksWithoutFcmKey() {
        assertFalse(push.isConfigured());
        AppUser me = user("me");
        AppUser target = user("target");
        controller.register(bearer(target), new PushController.TokenRequest("device-" + UUID.randomUUID(), "android"));

        assertEquals(HttpStatus.OK, social.follow(bearer(me), target.getId()).getStatusCode());
        // 키가 없으면 보내지 않고 조용히 지나간다
        push.send(target, "인터맵", "테스트", Map.of("type", "FOLLOW"));
    }
}
