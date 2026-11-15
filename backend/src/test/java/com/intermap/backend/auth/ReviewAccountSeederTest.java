package com.intermap.backend.auth;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 심사용 계정 — 환경변수로 비밀번호를 정했을 때만 생기고, 그 비밀번호로 로그인된다
@SpringBootTest
@Transactional
class ReviewAccountSeederTest {

    private static final String EMAIL = "store-review@test.local";

    @Autowired AppUserRepository users;
    @Autowired Sessions sessions;
    @Autowired AuthController auth;
    @Autowired Admins admins;

    private void seed(String password) {
        new ReviewAccountSeeder(users, sessions, EMAIL, password).run(null);
    }

    @Test
    void nothingHappensWithoutAPassword() {
        seed("");
        seed(null);
        seed("short");
        assertTrue(users.findByEmail(EMAIL).isEmpty());
    }

    @Test
    void createsAnOrdinaryAccountThatCanLogIn() {
        seed("review-pass-1234");
        AppUser account = users.findByEmail(EMAIL).orElseThrow();
        assertTrue(account.getNickname().startsWith("심사용"));
        assertFalse(admins.isAdmin(account), "심사용 계정은 평범한 회원이다");

        var ok = auth.login(new AuthController.LoginRequest(EMAIL, "review-pass-1234"));
        assertEquals(HttpStatus.OK, ok.getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, auth.login(new AuthController.LoginRequest(EMAIL, "wrong-password")).getStatusCode());

        // 다시 시작해도 하나뿐이고, 비밀번호를 바꾸면 예전 로그인은 끊긴다
        String token = ((AuthController.AuthResponse) ok.getBody()).token();
        seed("review-pass-1234");
        assertEquals(account.getId(), auth.currentUser("Bearer " + token).getId());
        seed("another-pass-5678");
        assertNull(auth.currentUser("Bearer " + token));
        assertEquals(HttpStatus.OK, auth.login(new AuthController.LoginRequest(EMAIL, "another-pass-5678")).getStatusCode());
    }
}
