package com.intermap.backend.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

// 구글/네이버/카카오 소셜 로그인 — Spring Security 없이 인가 코드 플로우를 직접 구현한다
// (기존 인증이 세션이 아니라 커스텀 토큰 기반이라, 필터체인을 새로 설계하지 않는 쪽이 더 단순하다).
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class OAuthController {

    private record ProviderConfig(String authorizeUri, String tokenUri, String userInfoUri, String scope,
                                   String clientId, String clientSecret) {
        boolean configured() {
            return !clientId.isBlank() && !clientSecret.isBlank();
        }
    }

    private record Profile(String providerId, String email, String nickname) {
    }

    private static final long STATE_TTL_SECONDS = 600;
    // 앱에서 시작한 로그인의 state 꼬리표. 콜백을 앱 딥링크로 돌려보내는 기준.
    private static final String APP_STATE_SUFFIX = "-app";
    // Android 매니페스트 intent-filter(scheme=intermap, host=auth)와 맞춘 딥링크 주소
    private static final String APP_DEEP_LINK = "intermap://auth";

    private final RestClient restClient = RestClient.create();
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, Instant> pendingStates = new ConcurrentHashMap<>();

    private final Map<String, ProviderConfig> providers;
    private final AppUserRepository repository;
    private final PendingSocialLinks pendingLinks;
    private final String backendBaseUrl;
    private final String frontendBaseUrl;

    public OAuthController(
        AppUserRepository repository,
        PendingSocialLinks pendingLinks,
        @Value("${backend.base-url}") String backendBaseUrl,
        @Value("${frontend.base-url}") String frontendBaseUrl,
        @Value("${oauth.google.client-id}") String googleId, @Value("${oauth.google.client-secret}") String googleSecret,
        @Value("${oauth.naver.client-id}") String naverId, @Value("${oauth.naver.client-secret}") String naverSecret,
        @Value("${oauth.kakao.client-id}") String kakaoId, @Value("${oauth.kakao.client-secret}") String kakaoSecret
    ) {
        this.repository = repository;
        this.pendingLinks = pendingLinks;
        this.backendBaseUrl = backendBaseUrl;
        this.frontendBaseUrl = frontendBaseUrl;
        this.providers = Map.of(
            "google", new ProviderConfig(
                "https://accounts.google.com/o/oauth2/v2/auth",
                "https://oauth2.googleapis.com/token",
                "https://www.googleapis.com/oauth2/v3/userinfo",
                "openid email profile", googleId, googleSecret),
            "naver", new ProviderConfig(
                "https://nid.naver.com/oauth2.0/authorize",
                "https://nid.naver.com/oauth2.0/token",
                "https://openapi.naver.com/v1/nid/me",
                "", naverId, naverSecret),
            "kakao", new ProviderConfig(
                "https://kauth.kakao.com/oauth/authorize",
                "https://kauth.kakao.com/oauth/token",
                "https://kapi.kakao.com/v2/user/me",
                // account_email은 카카오 비즈니스 채널 심사 전엔 앱에 권한 자체가 없어 요청하면 인가가 실패한다.
                // 심사 통과하면 "account_email profile_nickname"으로 바꾸면 된다.
                "profile_nickname", kakaoId, kakaoSecret)
        );
    }

    private String redirectUri(String provider) {
        return backendBaseUrl + "/api/auth/oauth/" + provider + "/callback";
    }

    // 앱(WebView)에서 시작한 로그인은 ?app=1 — state에 표시를 실어 콜백에서 커스텀 스킴으로 돌려보낸다
    @GetMapping("/api/auth/oauth/{provider}")
    public ResponseEntity<Void> authorize(@PathVariable String provider, @RequestParam(required = false) String app) {
        boolean fromApp = app != null;
        ProviderConfig config = providers.get(provider);
        if (config == null) return ResponseEntity.notFound().build();
        if (!config.configured()) {
            return redirectWithError("해당 간편 로그인은 아직 연결되지 않았어요.", fromApp);
        }

        String state = Base64.getUrlEncoder().withoutPadding().encodeToString(UUID.randomUUID().toString().getBytes())
            + (fromApp ? APP_STATE_SUFFIX : "");
        pendingStates.put(state, Instant.now());

        URI target = UriComponentsBuilder.fromUriString(config.authorizeUri())
            .queryParam("client_id", config.clientId())
            .queryParam("redirect_uri", redirectUri(provider))
            .queryParam("response_type", "code")
            .queryParam("state", state)
            .queryParamIfPresent("scope", config.scope().isBlank() ? Optional.empty() : Optional.of(config.scope()))
            .encode().build().toUri();
        return ResponseEntity.status(302).location(target).build();
    }

    @GetMapping("/api/auth/oauth/{provider}/callback")
    public ResponseEntity<Void> callback(
        @PathVariable String provider,
        @RequestParam(required = false) String code,
        @RequestParam(required = false) String state,
        @RequestParam(required = false) String error
    ) {
        boolean fromApp = state != null && state.endsWith(APP_STATE_SUFFIX);
        ProviderConfig config = providers.get(provider);
        if (config == null || !config.configured()) return redirectWithError("연결되지 않은 로그인이에요.", fromApp);
        if (error != null || code == null) return redirectWithError("로그인이 취소됐어요.", fromApp);
        if (state == null || pendingStates.remove(state) == null) return redirectWithError("로그인 요청이 만료됐어요. 다시 시도해주세요.", fromApp);

        try {
            String accessToken = exchangeToken(provider, config, code, state);
            Profile profile = fetchProfile(provider, config, accessToken);
            if (profile.providerId() == null || profile.providerId().isBlank()) {
                return redirectWithError("로그인 정보를 가져오지 못했어요.", fromApp);
            }
            String email = profile.email() == null ? "" : profile.email().trim().toLowerCase();

            // 이 소셜 계정이 연결된 회원이 있으면 로그인.
            // 없는데 같은 이메일 계정이 있으면 "계정 연결" 화면(linkTicket) — 인증번호로 이메일 소유를 증명해야 연결된다
            // (이메일만 같다고 자동 연결하지 않는다 — 계정 탈취 방지).
            // 둘 다 없으면 닉네임+약관만 받는 가입 화면(signupTicket)으로 보낸다.
            AppUser user = repository.findByProviderAndProviderId(provider, profile.providerId()).orElse(null);
            if (user == null) {
                String ticket = pendingLinks.put(provider, profile.providerId(), email);
                boolean emailTaken = !email.isBlank() && repository.findByEmail(email).isPresent();
                URI target = UriComponentsBuilder.fromUriString(redirectBase(fromApp))
                    .queryParam(emailTaken ? "linkTicket" : "signupTicket", ticket)
                    .queryParam("provider", provider)
                    .queryParamIfPresent("email", email.isBlank() ? Optional.empty() : Optional.of(email))
                    .queryParamIfPresent("nickname", Optional.ofNullable(profile.nickname()).filter(n -> !n.isBlank()))
                    .encode().build().toUri();
                return ResponseEntity.status(302).location(target).build();
            }
            user.issueToken(UUID.randomUUID().toString());
            repository.save(user);

            URI target = UriComponentsBuilder.fromUriString(redirectBase(fromApp))
                .queryParam("token", user.getToken())
                .queryParamIfPresent("email", Optional.ofNullable(user.getEmail()))
                .queryParam("nickname", user.getNickname())
                .encode().build().toUri();
            return ResponseEntity.status(302).location(target).build();
        } catch (Exception e) {
            return redirectWithError("로그인 중 문제가 생겼어요. 다시 시도해주세요.", fromApp);
        }
    }

    private String redirectBase(boolean fromApp) {
        return fromApp ? APP_DEEP_LINK : frontendBaseUrl;
    }

    private String exchangeToken(String provider, ProviderConfig config, String code, String state) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "authorization_code");
        form.add("client_id", config.clientId());
        form.add("client_secret", config.clientSecret());
        form.add("redirect_uri", redirectUri(provider));
        form.add("code", code);
        if ("naver".equals(provider)) form.add("state", state);

        String body = restClient.post()
            .uri(config.tokenUri())
            .header(HttpHeaders.CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(HttpHeaders.ACCEPT, "application/json")
            .body(form)
            .retrieve()
            .body(String.class);
        return readTree(body).path("access_token").asText();
    }

    private Profile fetchProfile(String provider, ProviderConfig config, String accessToken) {
        String body = restClient.get()
            .uri(config.userInfoUri())
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
            .retrieve()
            .body(String.class);
        JsonNode root = readTree(body);
        return switch (provider) {
            case "google" -> new Profile(root.path("sub").asText(null), root.path("email").asText(null),
                root.path("name").asText(null));
            case "naver" -> {
                JsonNode r = root.path("response");
                yield new Profile(r.path("id").asText(null), r.path("email").asText(null), r.path("nickname").asText(null));
            }
            case "kakao" -> {
                JsonNode account = root.path("kakao_account");
                yield new Profile(root.path("id").asText(null), account.path("email").asText(null),
                    account.path("profile").path("nickname").asText(null));
            }
            default -> throw new IllegalStateException("알 수 없는 provider: " + provider);
        };
    }

    private JsonNode readTree(String body) {
        try {
            return mapper.readTree(body);
        } catch (Exception e) {
            throw new IllegalStateException("응답 파싱 실패", e);
        }
    }

    private ResponseEntity<Void> redirectWithError(String message, boolean fromApp) {
        pendingStates.values().removeIf(issuedAt -> issuedAt.plusSeconds(STATE_TTL_SECONDS).isBefore(Instant.now()));
        URI target = UriComponentsBuilder.fromUriString(redirectBase(fromApp))
            .queryParam("authError", message)
            .encode().build().toUri();
        return ResponseEntity.status(302).location(target).build();
    }
}
