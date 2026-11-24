package com.intermap.backend.push;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// 아이폰 기기는 Apple로 보낸다 (안드로이드 기기는 FCM — 테스트에는 그 키가 없어 건너뛴다).
// Apple이 "그 기기는 이제 없다"고 하면 토큰을 지운다.
@SpringBootTest
class PushRoutingTest {

    @Autowired PushService push;
    @Autowired PushTokenRepository tokens;
    @Autowired AppUserRepository users;
    @MockitoBean ApnsSender apns;

    private AppUser user;

    @AfterEach
    void cleanUp() {
        if (user == null) return;
        tokens.findAllByUser(user).forEach(tokens::delete);
        users.delete(user);
    }

    @Test
    void iphoneTokensGoToApple() {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        user = users.save(new AppUser("apns" + suffix + "@test.local", null, "아이폰" + suffix, null));
        String iphone = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        String gone = UUID.randomUUID().toString().replace("-", "") + UUID.randomUUID().toString().replace("-", "");
        String android = "fcm-" + UUID.randomUUID();
        tokens.save(new PushToken(user, iphone, "ios"));
        tokens.save(new PushToken(user, gone, "ios"));
        tokens.save(new PushToken(user, android, "android"));

        when(apns.isConfigured()).thenReturn(true);
        when(apns.send(eq(iphone), any(), any(), any())).thenReturn(new ApnsSender.Result(ApnsSender.Outcome.SENT, ""));
        when(apns.send(eq(gone), any(), any(), any())).thenReturn(new ApnsSender.Result(ApnsSender.Outcome.GONE, "Unregistered"));

        push.send(user, "태원이님이 댓글을 남겼어요", "맛있겠다", Map.of("type", "COMMENT", "reviewId", "42"));

        verify(apns, timeout(5000)).send(iphone, "태원이님이 댓글을 남겼어요", "맛있겠다", Map.of("type", "COMMENT", "reviewId", "42"));
        verify(apns, timeout(5000)).send(eq(gone), any(), any(), any());
        verify(apns, never()).send(eq(android), any(), any(), any());
        // 없는 기기의 토큰은 지워지고 나머지는 남는다 (발송은 뒤에서 하니 잠깐 기다린다)
        long until = System.currentTimeMillis() + 5000;
        while (tokens.findByToken(gone).isPresent() && System.currentTimeMillis() < until) {
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        assertTrue(tokens.findByToken(gone).isEmpty());
        assertTrue(tokens.findByToken(iphone).isPresent());
        assertTrue(tokens.findByToken(android).isPresent());
    }
}
