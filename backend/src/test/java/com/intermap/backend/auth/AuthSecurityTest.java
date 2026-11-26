package com.intermap.backend.auth;

import com.intermap.backend.localdata.SyncController;
import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import com.intermap.backend.review.Review;
import com.intermap.backend.review.ReviewController;
import com.intermap.backend.review.ReviewRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

// 보안 점검에서 고친 것들 — 다시 열리면 여기서 깨진다
@SpringBootTest
@Transactional
class AuthSecurityTest {

    @Autowired AuthController auth;
    @Autowired OAuthController oauth;
    @Autowired SyncController sync;
    @Autowired ReviewController reviewController;
    @Autowired AppUserRepository users;
    @Autowired RestaurantRepository restaurants;
    @Autowired com.intermap.backend.restaurant.RestaurantController restaurantController;
    @Autowired ReviewRepository reviews;
    @MockitoBean MailService mail;

    private static String uniqueEmail() {
        return "sec" + UUID.randomUUID().toString().substring(0, 8) + "@test.local";
    }

    private AppUser user(String email, String password) {
        String nickname = "sec" + UUID.randomUUID().toString().substring(0, 8);
        return users.save(new AppUser(email, password == null ? null : new BCryptPasswordEncoder().encode(password), nickname, null));
    }

    private String sentCode(String email) {
        auth.sendEmailCode(new AuthController.EmailRequest(email), new MockHttpServletRequest());
        ArgumentCaptor<String> code = ArgumentCaptor.forClass(String.class);
        verify(mail).sendVerificationCode(eq(email), code.capture());
        return code.getValue();
    }

    @Test
    void changingPasswordByCodeSignsOutOtherDevices() {
        String email = uniqueEmail();
        AppUser u = user(email, "old-password-1");
        String stolen = "Bearer " + auth.signIn(u).token();
        String legacy = UUID.randomUUID().toString();
        u.issueToken(legacy);
        users.save(u);
        assertEquals(u.getId(), auth.currentUser(stolen).getId());
        assertEquals(u.getId(), auth.currentUser("Bearer " + legacy).getId());

        // 비밀번호를 안 바꾸는 인증번호 로그인은 다른 기기를 건드리지 않는다
        String code = sentCode(email);
        var plain = (AuthController.AuthResponse) auth.loginWithCode(new AuthController.CodeRequest(email, code, null)).getBody();
        assertEquals(u.getId(), auth.currentUser(stolen).getId());

        // 비밀번호를 바꾸면 그전의 로그인은 전부 끊기고, 지금 받은 토큰만 남는다
        org.mockito.Mockito.clearInvocations(mail);
        String again = sentCode(email);
        var changed = (AuthController.AuthResponse) auth.loginWithCode(
                new AuthController.CodeRequest(email, again, "new-password-1")).getBody();
        assertNull(auth.currentUser(stolen), "예전 비밀번호로 들어와 있던 기기는 끊긴다");
        assertNull(auth.currentUser("Bearer " + plain.token()));
        assertNull(auth.currentUser("Bearer " + legacy), "예전 방식 토큰도 끊긴다");
        assertEquals(u.getId(), auth.currentUser("Bearer " + changed.token()).getId());
        assertEquals(HttpStatus.OK, auth.login(new AuthController.LoginRequest(email, "new-password-1")).getStatusCode());
    }

    @Test
    void mapBoundsMustBeNumbers() {
        double nan = Double.NaN;
        assertEquals(HttpStatus.BAD_REQUEST, restaurantController.list(nan, 37.6, 126.9, 127.0, null, null, null).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST,
                restaurantController.list(37.5, Double.POSITIVE_INFINITY, 126.9, 127.0, null, null, null).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST,
                restaurantController.summary(37.5, 37.6, nan, 127.0, 12, null, null, null).getStatusCode());
        assertEquals(HttpStatus.OK, restaurantController.list(37.50, 37.55, 126.95, 127.0, null, null, null).getStatusCode());
        assertEquals(HttpStatus.OK, restaurantController.summary(37.5, 37.6, 126.9, 127.0, 12, null, null, null).getStatusCode());
    }

    @Test
    void verifiedCodeStillNeedsTheSameCode() {
        String email = uniqueEmail();
        user(email, null);
        String code = sentCode(email);
        String wrong = code.equals("000000") ? "111111" : "000000";

        assertEquals(HttpStatus.OK, auth.verifyEmailCode(new AuthController.CodeRequest(email, code, null)).getStatusCode());
        // 확인 버튼으로 맞춘 뒤에도 남이 아무 번호로 로그인하지 못한다
        assertEquals(HttpStatus.BAD_REQUEST,
                auth.loginWithCode(new AuthController.CodeRequest(email, wrong, null)).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST,
                auth.verifyEmailCode(new AuthController.CodeRequest(email, wrong, null)).getStatusCode());
        assertEquals(HttpStatus.OK,
                auth.loginWithCode(new AuthController.CodeRequest(email, code, "new-password-1")).getStatusCode());
        assertEquals(HttpStatus.OK,
                auth.login(new AuthController.LoginRequest(email, "new-password-1")).getStatusCode(), "인증번호 로그인으로 비밀번호를 바꾼다");
    }

    @Test
    void codeIsThrownAwayAfterFiveWrongTries() {
        String email = uniqueEmail();
        user(email, null);
        String code = sentCode(email);
        String wrong = code.equals("000000") ? "111111" : "000000";
        for (int i = 0; i < 5; i++) {
            assertEquals(HttpStatus.BAD_REQUEST,
                    auth.verifyEmailCode(new AuthController.CodeRequest(email, wrong, null)).getStatusCode());
        }
        // 다섯 번 틀리면 맞는 번호도 더는 받지 않는다 — 새로 받아야 한다
        assertEquals(HttpStatus.BAD_REQUEST,
                auth.verifyEmailCode(new AuthController.CodeRequest(email, code, null)).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST,
                auth.loginWithCode(new AuthController.CodeRequest(email, code, null)).getStatusCode());
    }

    @Test
    void passwordLoginLocksAfterFiveFailures() {
        String email = uniqueEmail();
        user(email, "right-password");
        for (int i = 0; i < 5; i++) {
            assertEquals(HttpStatus.UNAUTHORIZED, auth.login(new AuthController.LoginRequest(email, "wrong")).getStatusCode());
        }
        assertEquals(HttpStatus.TOO_MANY_REQUESTS,
                auth.login(new AuthController.LoginRequest(email, "right-password")).getStatusCode());
    }

    @Test
    void tokenIsStoredHashed() {
        String email = uniqueEmail();
        AppUser u = user(email, "right-password");
        var session = (AuthController.AuthResponse) auth.login(new AuthController.LoginRequest(email, "right-password")).getBody();
        assertTrue(users.findByToken(session.token()).isEmpty(), "DB에 원문 토큰이 없다");
        assertEquals(u.getId(), auth.currentUser("Bearer " + session.token()).getId());
    }

    @Test
    void reservedAndInvisibleNicknamesRejected() {
        assertEquals(false, auth.checkNickname("주인장").available());
        assertEquals(false, auth.checkNickname("주​인장").available());
    }

    @Test
    void adminEndpointsNeedAdmin() {
        String token = UUID.randomUUID().toString();
        AppUser someone = user(uniqueEmail(), null);
        someone.issueToken(token);
        assertEquals(HttpStatus.FORBIDDEN, sync.sync(null, 8).getStatusCode());
        assertEquals(HttpStatus.FORBIDDEN, sync.sync("Bearer " + token, 8).getStatusCode());
        assertEquals(HttpStatus.FORBIDDEN, sync.importRestaurants("Bearer " + token, "3000000").getStatusCode());
    }

    @Test
    void duplicateRestaurantsDoNotBreakReviewList() {
        String name = "중복가게" + UUID.randomUUID();
        restaurants.save(new Restaurant(name, "한식", "서울 중구 1", "서울 중구 1-1", 37.5, 127.0));
        restaurants.save(new Restaurant(name, "한식", "서울 중구 1", "서울 중구 1-1", 37.5, 127.0));
        reviews.save(new Review(user(uniqueEmail(), null), name, "한식", "서울 중구 1", 4, "맛있어요", null));
        reviewController.list(null);
    }

    @Test
    void oauthResultNeedsTheStartingVerifier() {
        assertEquals(HttpStatus.BAD_REQUEST,
                oauth.result(new OAuthController.ResultRequest("no-such-code", "x".repeat(40))).getStatusCode());
    }

    @Test
    void uploadsAreCheckedByBytes() {
        assertEquals("image/jpeg", AvatarController.imageType(new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0}));
        assertEquals("image/png", AvatarController.imageType(new byte[]{(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'}));
        assertEquals("image/webp", AvatarController.imageType("RIFF0000WEBPVP8 ".getBytes()));
        assertNull(AvatarController.imageType("<html><script>".getBytes()));
        assertNotEquals("image/png", AvatarController.imageType("PNG fake".getBytes()));
    }
}
