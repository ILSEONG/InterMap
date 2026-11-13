package com.intermap.backend.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.intermap.backend.account.AccountController;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Apple로 로그인 — Apple 서버와의 통신(AppleLogin.exchange/revoke)만 가짜로 두고 나머지 흐름을 끝까지 돈다
@SpringBootTest
@Transactional
class AppleLoginTest {

    @Autowired OAuthController oauth;
    @Autowired AuthController auth;
    @Autowired AccountController account;
    @Autowired AppUserRepository users;
    @MockitoBean AppleLogin apple;

    private static final String VERIFIER = "v".repeat(40);

    private static String param(ResponseEntity<Void> redirect, String name) {
        return UriComponentsBuilder.fromUri(redirect.getHeaders().getLocation()).build().getQueryParams().getFirst(name);
    }

    // 로그인 시작 → Apple 콜백 → 결과 받기
    private OAuthController.OAuthResult login(String code, String userJson) {
        ResponseEntity<Void> start = oauth.authorize("apple", "1", VERIFIER);
        assertEquals("form_post", param(start, "response_mode"), "이름·이메일을 받으려면 form_post여야 한다");
        String state = param(start, "state");
        ResponseEntity<Void> back = oauth.appleCallback(code, state, null, userJson);
        assertTrue(back.getHeaders().getLocation().toString().startsWith("intermap://auth"), "앱에서 시작했으면 앱으로 돌아온다");
        String resultCode = param(back, "oauth");
        assertNotNull(resultCode, "로그인 결과 코드가 와야 한다");
        return (OAuthController.OAuthResult) oauth.result(new OAuthController.ResultRequest(resultCode, VERIFIER)).getBody();
    }

    @Test
    void signupThenLoginThenDeleteRevokesAtApple() {
        String sub = "apple-" + UUID.randomUUID();
        String nickname = "ap" + UUID.randomUUID().toString().substring(0, 8);
        when(apple.configured()).thenReturn(true);
        when(apple.clientId()).thenReturn("com.intermap.app.login");
        when(apple.exchange(eq("code-1"), anyString())).thenReturn(new AppleLogin.AppleUser(sub, null, "refresh-1"));
        when(apple.exchange(eq("code-2"), anyString())).thenReturn(new AppleLogin.AppleUser(sub, null, "refresh-2"));
        assertTrue(oauth.configuredProviders().contains("apple"));

        // 처음: 가입 화면으로. 이름은 성+이름 순으로 닉네임 칸에 제안된다
        OAuthController.OAuthResult first = login("code-1", "{\"name\":{\"firstName\":\"길동\",\"lastName\":\"홍\"}}");
        assertEquals("signup", first.type());
        assertEquals("apple", first.provider());
        assertEquals("홍길동", first.nickname());
        assertEquals(HttpStatus.OK, auth.signupSocial(
                new AuthController.SocialSignupRequest(first.ticket(), nickname, true, false)).getStatusCode());
        AppUser user = users.findByProviderAndProviderId("apple", sub).orElseThrow();
        assertEquals("refresh-1", user.getAppleRefreshToken());

        // 다시: 바로 로그인되고 토큰은 새것으로 바뀐다 (이때는 Apple이 이름을 주지 않는다)
        OAuthController.OAuthResult second = login("code-2", null);
        assertEquals("session", second.type());
        assertEquals("refresh-2", users.findByProviderAndProviderId("apple", sub).orElseThrow().getAppleRefreshToken());

        // 탈퇴: Apple 쪽 연결도 끊는다
        assertEquals(HttpStatus.NO_CONTENT, account.deleteMe("Bearer " + second.session().token()).getStatusCode());
        verify(apple).revoke("refresh-2");
        assertTrue(users.findByProviderAndProviderId("apple", sub).isEmpty());
    }

    @Test
    void hiddenUntilConfigured() {
        when(apple.configured()).thenReturn(false);
        assertFalse(oauth.configuredProviders().contains("apple"));
        ResponseEntity<Void> start = oauth.authorize("apple", null, VERIFIER);
        assertEquals("unavailable", param(start, "authError"));
        assertEquals("unavailable", param(oauth.appleCallback("code", "state", null, null), "authError"));
    }

    // Apple이 받는 client_secret 모양: 팀이 발급하고 Services ID가 주체인 ES256 JWT, 서명은 그 키로 검증된다
    @Test
    void clientSecretIsAnEs256JwtSignedWithTheKey() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(new ECGenParameterSpec("secp256r1"));
        KeyPair pair = generator.generateKeyPair();
        // 환경변수에 줄바꿈이 "\n" 글자로 들어온 경우까지 읽는지 본다
        String pem = "-----BEGIN PRIVATE KEY-----\\n"
                + Base64.getEncoder().encodeToString(pair.getPrivate().getEncoded())
                + "\\n-----END PRIVATE KEY-----";
        AppleLogin real = new AppleLogin("com.intermap.app.login", "TEAM123456", "KEY1234567", pem);
        assertTrue(real.configured());
        assertFalse(new AppleLogin("com.intermap.app.login", "TEAM123456", "KEY1234567", "").configured());
        assertFalse(new AppleLogin("com.intermap.app.login", "TEAM123456", "KEY1234567", "not a key").configured());

        String[] parts = real.clientSecret().split("\\.");
        assertEquals(3, parts.length);
        ObjectMapper mapper = new ObjectMapper();
        Base64.Decoder url = Base64.getUrlDecoder();
        JsonNode header = mapper.readTree(url.decode(parts[0]));
        JsonNode claims = mapper.readTree(url.decode(parts[1]));
        assertEquals("ES256", header.path("alg").asText());
        assertEquals("KEY1234567", header.path("kid").asText());
        assertEquals("TEAM123456", claims.path("iss").asText());
        assertEquals("com.intermap.app.login", claims.path("sub").asText());
        assertEquals("https://appleid.apple.com", claims.path("aud").asText());
        assertTrue(claims.path("exp").asLong() > claims.path("iat").asLong());

        byte[] signature = url.decode(parts[2]);
        assertEquals(64, signature.length, "ES256 서명은 R||S 64바이트");
        Signature verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
        verifier.initVerify(pair.getPublic());
        verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.UTF_8));
        assertTrue(verifier.verify(signature));
    }
}
