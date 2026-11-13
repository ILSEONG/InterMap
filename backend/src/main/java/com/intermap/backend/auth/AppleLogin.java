package com.intermap.backend.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import com.intermap.backend.web.Http;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

// Apple로 로그인 (Sign in with Apple) — 다른 소셜 로그인과 같은 인가 코드 플로우지만 Apple만 다른 점이 셋 있다:
//   1) client_secret이 고정 문자열이 아니라, Apple 개발자 계정에서 받은 키(.p8)로 그때그때 서명한 JWT다 (ES256)
//   2) 이름·이메일을 요청하면 콜백이 GET이 아니라 POST(form_post)로 온다 (OAuthController.appleCallback)
//   3) 프로필 조회 API가 없고, 토큰 응답에 든 id_token(JWT)에 사용자 식별자·이메일이 들어 있다
// 또 탈퇴할 때 Apple 쪽 연결도 끊어 줘야 한다 (App Store 심사 지침) — 그래서 refresh_token을 계정에 남겨 둔다.
//
// 필요한 환경변수 (Apple 개발자 계정 → Certificates, Identifiers & Profiles):
//   APPLE_CLIENT_ID   : Services ID (예: com.intermap.app.login) — 반환 URL에 {backend}/api/auth/oauth/apple/callback 등록
//   APPLE_TEAM_ID     : 팀 ID (10자)
//   APPLE_KEY_ID      : Sign in with Apple 키의 Key ID (10자)
//   APPLE_PRIVATE_KEY : 그 키 파일(.p8)의 내용 전체
// 넷 중 하나라도 없으면 Apple 로그인은 꺼져 있다 (버튼도 안 보인다).
@Component
public class AppleLogin {

    public record AppleUser(String sub, String email, String refreshToken) {
    }

    private static final Logger log = LoggerFactory.getLogger(AppleLogin.class);
    private static final String ISSUER = "https://appleid.apple.com";
    static final String AUTHORIZE_URI = ISSUER + "/auth/authorize";
    private static final String TOKEN_URI = ISSUER + "/auth/token";
    private static final String REVOKE_URI = ISSUER + "/auth/revoke";

    private final RestClient restClient = Http.client();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String clientId;
    private final String teamId;
    private final String keyId;
    private final PrivateKey privateKey;

    public AppleLogin(
        @Value("${oauth.apple.client-id}") String clientId,
        @Value("${oauth.apple.team-id}") String teamId,
        @Value("${oauth.apple.key-id}") String keyId,
        @Value("${oauth.apple.private-key}") String privateKeyPem
    ) {
        this.clientId = clientId.trim();
        this.teamId = teamId.trim();
        this.keyId = keyId.trim();
        this.privateKey = parseKey(privateKeyPem);
    }

    // 환경변수에 줄바꿈이 "\n" 글자로 들어와도 읽는다
    private static PrivateKey parseKey(String pem) {
        if (pem == null || pem.isBlank()) return null;
        try {
            String body = pem.replace("\\n", "\n")
                    .replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "")
                    .replaceAll("\\s", "");
            return KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(body)));
        } catch (Exception e) {
            // 키 내용은 로그에 남기지 않는다
            log.warn("APPLE_PRIVATE_KEY를 읽지 못했습니다 — Apple 로그인을 끕니다. ({})", e.getClass().getSimpleName());
            return null;
        }
    }

    public boolean configured() {
        return !clientId.isEmpty() && !teamId.isEmpty() && !keyId.isEmpty() && privateKey != null;
    }

    public String clientId() {
        return clientId;
    }

    // 인가 코드를 토큰으로 바꾸고 id_token에서 사용자를 읽는다.
    // id_token은 Apple 토큰 서버에서 TLS로 직접 받은 것이라 서명 검증 없이 내용을 믿는다 (발급자·대상만 확인).
    public AppleUser exchange(String code, String redirectUri) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "authorization_code");
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret());
        form.add("redirect_uri", redirectUri);
        form.add("code", code);
        JsonNode token = readTree(restClient.post()
            .uri(TOKEN_URI)
            .header(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(HttpHeaders.ACCEPT, "application/json")
            .body(form)
            .retrieve()
            .body(String.class));

        JsonNode claims = idTokenClaims(token.path("id_token").asText(""));
        if (!ISSUER.equals(claims.path("iss").asText()) || !clientId.equals(claims.path("aud").asText())) {
            throw new IllegalStateException("id_token 발급자·대상이 맞지 않음");
        }
        // email_verified는 true 또는 "true"로 온다. 검증된 이메일만 쓴다 (나머지 소셜 로그인과 같은 기준)
        boolean verified = "true".equals(claims.path("email_verified").asText());
        String refreshToken = token.path("refresh_token").asText("");
        return new AppleUser(claims.path("sub").asText(null),
            verified ? claims.path("email").asText(null) : null,
            refreshToken.isBlank() ? null : refreshToken);
    }

    // 탈퇴 — Apple 쪽에서도 이 앱과의 연결을 끊는다. 실패해도 탈퇴는 그대로 진행한다 (호출부가 무시)
    public void revoke(String refreshToken) {
        if (!configured() || refreshToken == null || refreshToken.isBlank()) return;
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("client_id", clientId);
        form.add("client_secret", clientSecret());
        form.add("token", refreshToken);
        form.add("token_type_hint", "refresh_token");
        restClient.post()
            .uri(REVOKE_URI)
            .header(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(form)
            .retrieve()
            .toBodilessEntity();
    }

    // Apple이 요구하는 client_secret: 팀 ID가 발급하고 Services ID가 주체인 5분짜리 ES256 JWT
    String clientSecret() {
        try {
            Instant now = Instant.now();
            Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();
            Map<String, Object> header = new LinkedHashMap<>();
            header.put("alg", "ES256");
            header.put("kid", keyId);
            Map<String, Object> claims = new LinkedHashMap<>();
            claims.put("iss", teamId);
            claims.put("iat", now.getEpochSecond());
            claims.put("exp", now.getEpochSecond() + 300);
            claims.put("aud", ISSUER);
            claims.put("sub", clientId);
            String unsigned = b64.encodeToString(mapper.writeValueAsBytes(header))
                    + "." + b64.encodeToString(mapper.writeValueAsBytes(claims));
            // JWT의 ES256 서명은 DER이 아니라 R||S 64바이트 형식이다
            Signature signer = Signature.getInstance("SHA256withECDSAinP1363Format");
            signer.initSign(privateKey);
            signer.update(unsigned.getBytes(StandardCharsets.UTF_8));
            return unsigned + "." + b64.encodeToString(signer.sign());
        } catch (Exception e) {
            throw new IllegalStateException("Apple client_secret 서명 실패", e);
        }
    }

    // JWT 가운데 토막(payload)만 읽는다
    private JsonNode idTokenClaims(String idToken) {
        String[] parts = idToken.split("\\.");
        if (parts.length != 3) throw new IllegalStateException("id_token 형식이 아님");
        return readTree(new String(Base64.getUrlDecoder().decode(parts[1]), StandardCharsets.UTF_8));
    }

    private JsonNode readTree(String body) {
        try {
            return mapper.readTree(body);
        } catch (Exception e) {
            throw new IllegalStateException("응답 파싱 실패", e);
        }
    }
}
