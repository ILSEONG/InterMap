package com.intermap.backend.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

// 구글/네이버/카카오 소셜 로그인 — Spring Security 없이 인가 코드 플로우를 직접 구현한다
// (기존 인증이 세션이 아니라 커스텀 토큰 기반이라, 필터체인을 새로 설계하지 않는 쪽이 더 단순하다).
//
// 로그인을 시작한 기기에만 결과가 돌아가게 묶는다:
//   프론트가 난수 verifier를 만들어 저장하고 /api/auth/oauth/{provider}?verifier= 로 시작 →
//   콜백은 결과를 서버에 맡기고 일회용 코드만 ?oauth=<code> 로 돌려보낸다 →
//   프론트가 POST /api/auth/oauth/result {code, verifier} 로 결과(세션 또는 연결·가입 티켓)를 받는다.
// 남이 만든 콜백 링크나 가로챈 intermap:// 딥링크는 verifier가 없어 쓸모가 없다.
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "capacitor://intermap.app:8443", "https://*.vercel.app"})
public class OAuthController {

    private record ProviderConfig(String authorizeUri, String tokenUri, String userInfoUri, String scope,
                                   String clientId, String clientSecret) {
        boolean configured() {
            return !clientId.isBlank() && !clientSecret.isBlank();
        }
    }

    private record Profile(String providerId, String email, String nickname) {
    }

    private record PendingState(Instant issuedAt, String verifier) {
    }

    // type: "session"(연결된 회원 — session 채움) | "link"(같은 이메일 계정과 연결) | "signup"(닉네임+약관 가입)
    public record OAuthResult(String type, AuthController.AuthResponse session, String ticket, String provider,
                              String email, String nickname) {
    }

    // userId가 있으면 세션 결과 — 토큰은 교환 시점에 발급해 메모리에 남기지 않는다
    private record Outcome(Instant issuedAt, String verifier, Long userId, OAuthResult ticketResult) {
    }

    public record ResultRequest(String code, String verifier) {
    }

    private static final long STATE_TTL_SECONDS = 600;
    // 콜백 뒤 앱/웹이 결과를 찾아가기까지
    private static final long RESULT_TTL_SECONDS = 300;
    // 쌓인 요청이 이만큼이면 새 로그인 시작을 막는다 — 시작 요청을 마구 보내 메모리를 채우는 걸 방지
    private static final int MAX_PENDING = 10_000;
    private static final Pattern VERIFIER = Pattern.compile("^[A-Za-z0-9_-]{32,128}$");
    // 앱에서 시작한 로그인의 state 꼬리표. 콜백을 앱 딥링크로 돌려보내는 기준.
    private static final String APP_STATE_SUFFIX = "-app";
    // Android 매니페스트 intent-filter·iOS CFBundleURLSchemes(scheme=intermap, host=auth)와 맞춘 딥링크 주소
    private static final String APP_DEEP_LINK = "intermap://auth";

    private final RestClient restClient = RestClient.create();
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, PendingState> pendingStates = new ConcurrentHashMap<>();
    private final Map<String, Outcome> outcomes = new ConcurrentHashMap<>();

    private final Map<String, ProviderConfig> providers;
    private final AppUserRepository repository;
    private final PendingSocialLinks pendingLinks;
    private final AuthController auth;
    private final String backendBaseUrl;
    private final String frontendBaseUrl;

    public OAuthController(
        AppUserRepository repository,
        PendingSocialLinks pendingLinks,
        AuthController auth,
        @Value("${backend.base-url}") String backendBaseUrl,
        @Value("${frontend.base-url}") String frontendBaseUrl,
        @Value("${oauth.google.client-id}") String googleId, @Value("${oauth.google.client-secret}") String googleSecret,
        @Value("${oauth.naver.client-id}") String naverId, @Value("${oauth.naver.client-secret}") String naverSecret,
        @Value("${oauth.kakao.client-id}") String kakaoId, @Value("${oauth.kakao.client-secret}") String kakaoSecret
    ) {
        this.repository = repository;
        this.pendingLinks = pendingLinks;
        this.auth = auth;
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
    public ResponseEntity<Void> authorize(@PathVariable String provider, @RequestParam(required = false) String app,
                                          @RequestParam(required = false) String verifier) {
        boolean fromApp = app != null;
        ProviderConfig config = providers.get(provider);
        if (config == null) return ResponseEntity.notFound().build();
        if (!config.configured()) return redirectWithError("unavailable", fromApp);
        if (verifier == null || !VERIFIER.matcher(verifier).matches()) return redirectWithError("failed", fromApp);

        Instant now = Instant.now();
        pendingStates.values().removeIf(p -> p.issuedAt().plusSeconds(STATE_TTL_SECONDS).isBefore(now));
        if (pendingStates.size() >= MAX_PENDING) return redirectWithError("failed", fromApp);

        String state = Base64.getUrlEncoder().withoutPadding().encodeToString(UUID.randomUUID().toString().getBytes())
            + (fromApp ? APP_STATE_SUFFIX : "");
        pendingStates.put(state, new PendingState(now, verifier));

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
        if (config == null || !config.configured()) return redirectWithError("unavailable", fromApp);
        PendingState pending = state == null ? null : pendingStates.remove(state);
        if (error != null || code == null) return redirectWithError("cancelled", fromApp);
        if (pending == null || pending.issuedAt().plusSeconds(STATE_TTL_SECONDS).isBefore(Instant.now())) {
            return redirectWithError("expired", fromApp);
        }

        try {
            String accessToken = exchangeToken(provider, config, code, state);
            Profile profile = fetchProfile(provider, config, accessToken);
            if (profile.providerId() == null || profile.providerId().isBlank()) {
                return redirectWithError("failed", fromApp);
            }
            String email = profile.email() == null ? "" : profile.email().trim().toLowerCase();

            // 이 소셜 계정이 연결된 회원이 있으면 로그인.
            // 없는데 같은 이메일 계정이 있으면 "계정 연결" 화면(link) — 인증번호로 이메일 소유를 증명해야 연결된다
            // (이메일만 같다고 자동 연결하지 않는다 — 계정 탈취 방지).
            // 둘 다 없으면 닉네임+약관만 받는 가입 화면(signup)으로 보낸다.
            AppUser user = repository.findByProviderAndProviderId(provider, profile.providerId()).orElse(null);
            Outcome outcome;
            if (user == null) {
                String ticket = pendingLinks.put(provider, profile.providerId(), email);
                boolean emailTaken = !email.isBlank() && repository.findByEmail(email).isPresent();
                outcome = new Outcome(Instant.now(), pending.verifier(), null, new OAuthResult(
                    emailTaken ? "link" : "signup", null, ticket, provider,
                    email.isBlank() ? null : email,
                    profile.nickname() == null || profile.nickname().isBlank() ? null : profile.nickname()));
            } else {
                outcome = new Outcome(Instant.now(), pending.verifier(), user.getId(), null);
            }
            return redirect(fromApp, "oauth", putOutcome(outcome));
        } catch (Exception e) {
            return redirectWithError("failed", fromApp);
        }
    }

    // 콜백이 맡긴 결과를 로그인을 시작한 쪽(verifier를 가진 쪽)에만 한 번 내준다
    @PostMapping("/api/auth/oauth/result")
    public ResponseEntity<?> result(@RequestBody ResultRequest request) {
        Outcome outcome = request.code() == null ? null : outcomes.remove(request.code());
        if (outcome == null || outcome.issuedAt().plusSeconds(RESULT_TTL_SECONDS).isBefore(Instant.now())
                || request.verifier() == null
                || !MessageDigest.isEqual(outcome.verifier().getBytes(StandardCharsets.UTF_8),
                        request.verifier().getBytes(StandardCharsets.UTF_8))) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(new AuthController.ErrorResponse("로그인 정보가 만료됐어요. 다시 시도해주세요."));
        }
        if (outcome.userId() == null) return ResponseEntity.ok(outcome.ticketResult());
        AppUser user = repository.findById(outcome.userId()).orElse(null);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(new AuthController.ErrorResponse("로그인 정보가 만료됐어요. 다시 시도해주세요."));
        }
        return ResponseEntity.ok(new OAuthResult("session", auth.signIn(user), null, null, null, null));
    }

    private String putOutcome(Outcome outcome) {
        Instant now = Instant.now();
        outcomes.values().removeIf(o -> o.issuedAt().plusSeconds(RESULT_TTL_SECONDS).isBefore(now));
        String code = UUID.randomUUID().toString();
        outcomes.put(code, outcome);
        return code;
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

    // 이메일은 provider가 검증했다고 밝힌 것만 쓴다 — 검증 안 된 남의 이메일로 가입해 그 주소를 선점하지 못하게.
    // 네이버는 검증 플래그가 없지만 네이버 계정 이메일이라 그대로 쓴다.
    private Profile fetchProfile(String provider, ProviderConfig config, String accessToken) {
        String body = restClient.get()
            .uri(config.userInfoUri())
            .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
            .retrieve()
            .body(String.class);
        JsonNode root = readTree(body);
        return switch (provider) {
            case "google" -> new Profile(root.path("sub").asText(null),
                root.path("email_verified").asBoolean(false) ? root.path("email").asText(null) : null,
                root.path("name").asText(null));
            case "naver" -> {
                JsonNode r = root.path("response");
                yield new Profile(r.path("id").asText(null), r.path("email").asText(null), r.path("nickname").asText(null));
            }
            case "kakao" -> {
                JsonNode account = root.path("kakao_account");
                boolean verified = account.path("is_email_verified").asBoolean(false) && account.path("is_email_valid").asBoolean(false);
                yield new Profile(root.path("id").asText(null), verified ? account.path("email").asText(null) : null,
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

    // 에러는 정해진 코드로만 보낸다 — 프론트가 코드별 문구를 보여준다 (임의 문구를 띄우는 링크 방지)
    private ResponseEntity<Void> redirectWithError(String errorCode, boolean fromApp) {
        return redirect(fromApp, "authError", errorCode);
    }

    private ResponseEntity<Void> redirect(boolean fromApp, String param, String value) {
        URI target = UriComponentsBuilder.fromUriString(fromApp ? APP_DEEP_LINK : frontendBaseUrl)
            .queryParam(param, value)
            .encode().build().toUri();
        return ResponseEntity.status(302).location(target).build();
    }
}
