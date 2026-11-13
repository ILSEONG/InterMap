package com.intermap.backend.auth;

import com.intermap.backend.state.ServerState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

// 가입/로그인 흐름:
//   이메일 입력 → lookup → 기존 회원이면 비밀번호 로그인(잊었으면 이메일 인증번호로 로그인)
//                        → 신규면 이메일 인증번호 → 약관 동의 → 닉네임+비밀번호 → 가입
//   소셜 로그인 → 연결된 회원이면 로그인 → 같은 이메일 계정이 있으면 인증번호로 연결 → 없으면 닉네임+약관으로 가입
@RestController
// https://intermap.app:8443 은 모바일 앱(Capacitor WebView)의 origin, *.vercel.app 은 웹 배포본
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "httpsapp://intermap.app:8443", "https://*.vercel.app"})
public class AuthController {

    public record EmailRequest(String email) {
    }

    // newPassword: 인증번호 로그인 때만, 비밀번호를 새로 정하려면 (선택)
    public record CodeRequest(String email, String emailCode, String newPassword) {
    }

    public record SignupRequest(String email, String emailCode, String nickname, String password,
                                boolean termsAgreed, boolean marketingAgreed) {
    }

    // 소셜 최초 인증 뒤 가입. 이메일은 provider가 준 것을 티켓에서 꺼내 쓴다.
    public record SocialSignupRequest(String ticket, String nickname, boolean termsAgreed, boolean marketingAgreed) {
    }

    public record NicknameRequest(String nickname) {
    }

    public record LoginRequest(String email, String password) {
    }

    // 소셜 로그인 뒤 같은 이메일의 기존 계정과 연결할 때. 계정 소유 증명으로 이메일 인증번호를 받는다.
    public record LinkRequest(String linkTicket, String emailCode) {
    }

    // avatar: 프로필 사진 URL(API 경로, ?v= 포함) 또는 null
    // admin: 운영 관리자(Admins)인지 — 프론트가 마이페이지에 신고 관리·서버 상태를 낼지 정한다
    public record AuthResponse(Long id, String token, String email, String nickname, String avatar, boolean admin) {
    }

    public record ErrorResponse(String message) {
    }

    public record AvailableResponse(boolean available) {
    }

    // provider: 소셜로만 가입한 계정(비밀번호 없음)이면 어떤 SNS인지 — 그 버튼으로 로그인하라고 안내한다
    public record LookupResponse(boolean exists, boolean hasPassword, String provider) {
    }

    public record OkResponse(String message) {
    }

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    // RFC 5321 상한. 정규식 역추적과 메모리 키 크기를 이 길이로 묶는다.
    private static final int MAX_EMAIL_LENGTH = 254;
    private static final int MAX_NICKNAME_LENGTH = 20;
    // 눈에 안 보이는 문자(제로폭 공백 등)로 같은 닉네임 흉내 내기 방지
    private static final Pattern INVISIBLE = Pattern.compile("[\\p{Cf}\\p{Cc}]");
    // 운영자 배지와 헷갈리는 이름
    private static final Set<String> RESERVED_NICKNAMES = Set.of("주인장", "운영자", "관리자", "admin");
    private static final int MIN_PASSWORD_LENGTH = 8;
    private static final long CODE_TTL_SECONDS = 300;
    // 인증번호를 맞힌 뒤 약관·닉네임을 채우는 시간
    private static final long VERIFIED_TTL_SECONDS = 30 * 60;
    private static final long RESEND_COOLDOWN_SECONDS = 60;
    private static final int MAX_VERIFY_ATTEMPTS = 5;
    private static final long TOKEN_TTL_DAYS = 30;
    // 비밀번호 무차별 대입 방지: 계정마다 15분 안에 5번 틀리면 15분 막는다
    private static final int MAX_LOGIN_FAILURES = 5;
    private static final long LOGIN_LOCK_SECONDS = 15 * 60;

    // 인증번호 발송 일일 상한. 뚫려도 하루 손실이 Brevo 무료 한도(300) 안에서 멈춘다.
    private static final int DAILY_PER_TARGET = 5;      // 같은 이메일
    private static final int DAILY_PER_IP = 10;         // 같은 IP
    private static final int DAILY_GLOBAL_EMAIL = 250;

    // 발급된 인증번호 (ServerState에 JSON으로 — 서버가 다시 켜져도, 서버가 여러 대여도 이어진다). 시각은 epoch 밀리초.
    // verifiedAt: 확인 버튼으로 이미 맞춘 시각 (아직이면 0). 약관·닉네임을 채우는 동안은 짧은 TTL 대신 VERIFIED_TTL을 쓴다.
    record Verification(String code, long issuedAt, long verifiedAt) {
    }

    private static final String CODE_KIND = "email-code";
    // 인증번호를 틀린 횟수 (인증번호와 같이 만료)
    private static final String CODE_TRIES_KIND = "email-code-tries";
    // 비밀번호를 틀린 횟수 — 첫 실패부터 LOGIN_LOCK_SECONDS 동안 센다
    private static final String LOGIN_FAIL_KIND = "login-fail";

    private final SecureRandom random = new SecureRandom();

    // Render 앞단(Cloudflare)이 넣는 CF-Connecting-IP를 먼저 본다 — 클라이언트가 보낸 값을 덮어써서 위조가 안 된다.
    // 없으면 X-Forwarded-For 첫 번째 값 (Render가 덧붙이기만 해서 클라이언트가 위조할 수 있다).
    // 카운터 키로 쓰므로 길이를 자른다 (IPv6 최대 45자)
    private static String clientIp(HttpServletRequest request) {
        String cf = request.getHeader("CF-Connecting-IP");
        String forwarded = request.getHeader("X-Forwarded-For");
        String ip = cf != null && !cf.isBlank() ? cf.trim()
                : forwarded == null || forwarded.isBlank() ? request.getRemoteAddr() : forwarded.split(",")[0].trim();
        return ip.length() > 45 ? ip.substring(0, 45) : ip;
    }

    private final AppUserRepository repository;
    private final MailService mailService;
    private final PendingSocialLinks pendingLinks;
    private final UserAvatarRepository avatars;
    private final DailyLimits limits;
    private final Admins admins;
    private final ServerState state;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public AuthController(AppUserRepository repository, MailService mailService, PendingSocialLinks pendingLinks,
                          UserAvatarRepository avatars, DailyLimits limits, Admins admins,
                          ServerState state) {
        this.state = state;
        this.admins = admins;
        this.repository = repository;
        this.mailService = mailService;
        this.pendingLinks = pendingLinks;
        this.avatars = avatars;
        this.limits = limits;
    }

    // DB엔 토큰 해시만 있으므로 원문 토큰은 호출부가 넘긴다
    private AuthResponse authResponse(AppUser user, String token) {
        return new AuthResponse(user.getId(), token, user.getEmail(), user.getNickname(), avatars.urlOf(user.getId()),
                admins.isAdmin(user));
    }

    private static String normalizeEmail(String raw) {
        return raw == null ? "" : raw.trim().toLowerCase();
    }

    private static boolean validEmail(String email) {
        return email.length() <= MAX_EMAIL_LENGTH && EMAIL.matcher(email).matches();
    }

    private ResponseEntity<?> issueCode(String email, String ip) {
        Verification existing = state.get(CODE_KIND, email, Verification.class).orElse(null);
        // 어떤 규칙에 걸렸는지 구분해서 알려주지 않는다 — 규칙을 알면 그만큼 우회하기 쉽다
        if ((existing != null && Instant.ofEpochMilli(existing.issuedAt()).plusSeconds(RESEND_COOLDOWN_SECONDS).isAfter(Instant.now()))
                || limits.exceeded("code-target:" + email, DAILY_PER_TARGET)
                || limits.exceeded("code-ip:" + ip, DAILY_PER_IP)
                || limits.exceeded("code-global", DAILY_GLOBAL_EMAIL)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(new ErrorResponse("잠시 후 다시 요청해주세요."));
        }
        String code = String.format("%06d", random.nextInt(1_000_000));
        // 발송이 실패하면 저장하지 않는다 — 안 그러면 실패한 요청이 쿨다운만 걸어버린다
        try {
            mailService.sendVerificationCode(email, code);
        } catch (RuntimeException e) {
            log.error("인증번호 발송 실패 {}", email, e);
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(new ErrorResponse("인증번호 발송에 실패했어요. 잠시 후 다시 시도해주세요."));
        }
        state.put(CODE_KIND, email, new Verification(code, Instant.now().toEpochMilli(), 0), Duration.ofSeconds(CODE_TTL_SECONDS));
        state.remove(CODE_TRIES_KIND, email);
        return ResponseEntity.ok(new OkResponse("인증번호를 보냈어요. 5분 안에 입력해주세요."));
    }

    // null이면 통과, 아니면 그대로 응답할 에러. 통과해도 지우지 않는다 — 가입/로그인 완료 시점에 지운다.
    // 확인 버튼으로 이미 맞춘 뒤에도 매번 같은 번호를 요구한다 — "인증됨" 상태만으로 남이 통과하지 못하게.
    private ErrorResponse verifyCode(String email, String input) {
        Verification verification = state.get(CODE_KIND, email, Verification.class).orElse(null);
        if (verification == null) {
            return new ErrorResponse("인증번호를 다시 받아주세요.");
        }
        if (state.counter(CODE_TRIES_KIND, email) >= MAX_VERIFY_ATTEMPTS) {
            forgetCode(email);
            return new ErrorResponse("시도 횟수를 넘었어요. 인증번호를 다시 받아주세요.");
        }
        if (input == null || !verification.code().equals(input.trim())) {
            // 틀린 횟수는 DB에서 한 번에 올린다 — 동시에 여러 번 찔러도 횟수가 덜 세지지 않는다
            state.increment(CODE_TRIES_KIND, email, Instant.now().plusSeconds(VERIFIED_TTL_SECONDS));
            return new ErrorResponse("인증번호가 맞지 않아요.");
        }
        if (verification.verifiedAt() == 0) {
            state.put(CODE_KIND, email, new Verification(verification.code(), verification.issuedAt(), Instant.now().toEpochMilli()),
                    Duration.ofSeconds(VERIFIED_TTL_SECONDS));
        }
        return null;
    }

    private void forgetCode(String email) {
        state.remove(CODE_KIND, email);
        state.remove(CODE_TRIES_KIND, email);
    }

    // 닉네임 규칙 위반이면 에러, 아니면 null
    private ErrorResponse checkNicknameRule(String nickname) {
        if (nickname.isEmpty() || nickname.length() > MAX_NICKNAME_LENGTH) {
            return new ErrorResponse("닉네임은 1~" + MAX_NICKNAME_LENGTH + "자로 해주세요.");
        }
        if (INVISIBLE.matcher(nickname).find()) {
            return new ErrorResponse("닉네임에 쓸 수 없는 문자가 있어요.");
        }
        if (RESERVED_NICKNAMES.contains(nickname.replaceAll("\\s+", "").toLowerCase())) {
            return new ErrorResponse("쓸 수 없는 닉네임이에요.");
        }
        if (repository.findByNickname(nickname).isPresent()) {
            return new ErrorResponse("이미 사용 중인 닉네임이에요.");
        }
        return null;
    }

    // 새 토큰을 발급해 로그인시킨다. 소셜 로그인(OAuthController)도 이걸 쓴다.
    public AuthResponse signIn(AppUser user) {
        String token = UUID.randomUUID().toString();
        user.issueToken(token);
        repository.save(user);
        return authResponse(user, token);
    }

    // 이메일 하나로 로그인/가입을 가른다. 계정 존재 여부가 드러나지만 요즘 흔한 흐름이라 감수한다.
    @PostMapping("/api/auth/lookup")
    public ResponseEntity<?> lookup(@RequestBody EmailRequest request) {
        String email = normalizeEmail(request.email());
        AppUser user = repository.findByEmail(email).orElse(null);
        if (user == null && !validEmail(email)) {
            return ResponseEntity.badRequest().body(new ErrorResponse("이메일 형식을 확인해주세요."));
        }
        return ResponseEntity.ok(new LookupResponse(user != null, user != null && user.getPasswordHash() != null,
                user == null ? null : user.getProvider()));
    }

    // 신규 가입·인증번호 로그인·소셜 계정 연결 모두 이걸로 보낸다
    @PostMapping("/api/auth/email-code")
    public ResponseEntity<?> sendEmailCode(@RequestBody EmailRequest request, HttpServletRequest http) {
        String email = normalizeEmail(request.email());
        if (!validEmail(email)) {
            return ResponseEntity.badRequest().body(new ErrorResponse("이메일 형식을 확인해주세요."));
        }
        return issueCode(email, clientIp(http));
    }

    @PostMapping("/api/auth/verify-email-code")
    public ResponseEntity<?> verifyEmailCode(@RequestBody CodeRequest request) {
        ErrorResponse error = verifyCode(normalizeEmail(request.email()), request.emailCode());
        return error != null
                ? ResponseEntity.badRequest().body(error)
                : ResponseEntity.ok(new OkResponse("인증됐어요."));
    }

    @GetMapping("/api/auth/check-nickname")
    public AvailableResponse checkNickname(@RequestParam String value) {
        return new AvailableResponse(checkNicknameRule(value == null ? "" : value.trim()) == null);
    }

    @PostMapping("/api/auth/signup")
    public ResponseEntity<?> signup(@RequestBody SignupRequest request) {
        String email = normalizeEmail(request.email());
        String nickname = request.nickname() == null ? "" : request.nickname().trim();
        if (!validEmail(email)) {
            return ResponseEntity.badRequest().body(new ErrorResponse("이메일 형식을 확인해주세요."));
        }
        if (!request.termsAgreed()) {
            return ResponseEntity.badRequest().body(new ErrorResponse("필수 약관에 동의해주세요."));
        }
        if (request.password() == null || request.password().length() < MIN_PASSWORD_LENGTH) {
            return ResponseEntity.badRequest().body(new ErrorResponse("비밀번호는 " + MIN_PASSWORD_LENGTH + "자 이상이어야 해요."));
        }
        ErrorResponse nicknameError = checkNicknameRule(nickname);
        if (nicknameError != null) {
            return ResponseEntity.badRequest().body(nicknameError);
        }
        if (repository.findByEmail(email).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse("이미 가입된 이메일이에요."));
        }
        ErrorResponse emailError = verifyCode(email, request.emailCode());
        if (emailError != null) {
            return ResponseEntity.badRequest().body(emailError);
        }
        AppUser user = new AppUser(email, encoder.encode(request.password()), nickname, null);
        user.agree(request.marketingAgreed());
        AuthResponse session = signIn(user);
        forgetCode(email);
        return ResponseEntity.ok(session);
    }

    // 소셜 최초 인증 뒤 닉네임+약관만 받고 바로 가입
    @PostMapping("/api/auth/signup-social")
    public ResponseEntity<?> signupSocial(@RequestBody SocialSignupRequest request) {
        PendingSocialLinks.Pending pending = pendingLinks.get(request.ticket());
        if (pending == null) {
            return ResponseEntity.badRequest().body(new ErrorResponse("소셜 로그인 정보가 만료됐어요. 다시 시도해주세요."));
        }
        String nickname = request.nickname() == null ? "" : request.nickname().trim();
        if (!request.termsAgreed()) {
            return ResponseEntity.badRequest().body(new ErrorResponse("필수 약관에 동의해주세요."));
        }
        ErrorResponse nicknameError = checkNicknameRule(nickname);
        if (nicknameError != null) {
            return ResponseEntity.badRequest().body(nicknameError);
        }
        String email = pending.email() == null || pending.email().isBlank() ? null : pending.email();
        if (email != null && repository.findByEmail(email).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse("이미 가입된 이메일이에요. 다시 로그인해주세요."));
        }
        if (repository.findByProviderAndProviderId(pending.provider(), pending.providerId()).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse("이미 연결된 SNS 계정이에요. 다시 로그인해주세요."));
        }
        AppUser user = new AppUser(email, null, nickname, null);
        user.linkProvider(pending.provider(), pending.providerId());
        user.rememberAppleRefreshToken(pending.appleRefreshToken());
        user.agree(request.marketingAgreed());
        AuthResponse session = signIn(user);
        pendingLinks.remove(request.ticket());
        return ResponseEntity.ok(session);
    }

    // 소셜 로그인 이메일과 같은 기존 계정. 인증번호로 이메일 소유를 증명하면 연결하고 로그인시킨다
    // (이메일만 같다고 자동 연결하지 않는다 — provider가 이메일을 검증했다고 믿을 수 없어서).
    @PostMapping("/api/auth/link-social")
    public ResponseEntity<?> linkSocial(@RequestBody LinkRequest request) {
        PendingSocialLinks.Pending pending = pendingLinks.get(request.linkTicket());
        if (pending == null) {
            return ResponseEntity.badRequest().body(new ErrorResponse("소셜 로그인 정보가 만료됐어요. 다시 시도해주세요."));
        }
        String email = normalizeEmail(pending.email());
        AppUser user = repository.findByEmail(email).orElse(null);
        if (user == null) {
            return ResponseEntity.badRequest().body(new ErrorResponse("연결할 계정을 찾지 못했어요. 다시 로그인해주세요."));
        }
        if (user.getProviderId() != null && !pending.providerId().equals(user.getProviderId())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse("이 계정에는 이미 다른 SNS 계정이 연결돼 있어요."));
        }
        ErrorResponse emailError = verifyCode(email, request.emailCode());
        if (emailError != null) {
            return ResponseEntity.badRequest().body(emailError);
        }
        user.linkProvider(pending.provider(), pending.providerId());
        user.rememberAppleRefreshToken(pending.appleRefreshToken());
        AuthResponse session = signIn(user);
        forgetCode(email);
        pendingLinks.remove(request.linkTicket());
        return ResponseEntity.ok(session);
    }

    // "Authorization: Bearer <token>" 헤더로 현재 사용자를 찾는다. 없거나 만료면 null.
    // 다른 컨트롤러(후기 작성 등)도 이걸로 로그인 사용자를 확인하면 된다.
    public AppUser currentUser(String authorization) {
        String token = bearer(authorization);
        if (token == null) return null;
        AppUser user = repository.findByToken(AppUser.hashToken(token)).orElse(null);
        if (user == null || user.getTokenIssuedAt() == null
                || user.getTokenIssuedAt().plus(TOKEN_TTL_DAYS, ChronoUnit.DAYS).isBefore(Instant.now())) {
            return null;
        }
        return user;
    }

    private static String bearer(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) return null;
        String token = authorization.substring(7).trim();
        return token.isEmpty() ? null : token;
    }

    // 앱 시작 시 저장된 세션이 아직 유효한지 확인
    @GetMapping("/api/auth/me")
    public ResponseEntity<?> me(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser user = currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ErrorResponse("다시 로그인해주세요."));
        }
        return ResponseEntity.ok(authResponse(user, bearer(authorization)));
    }

    // 닉네임 변경. 가입 때와 같은 규칙(1~20자, 중복 불가). 같은 이름이면 그대로 200.
    @PutMapping("/api/auth/nickname")
    public ResponseEntity<?> changeNickname(@RequestHeader(value = "Authorization", required = false) String authorization,
                                            @RequestBody NicknameRequest request) {
        AppUser user = currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ErrorResponse("다시 로그인해주세요."));
        }
        String nickname = request.nickname() == null ? "" : request.nickname().trim();
        if (!nickname.equals(user.getNickname())) {
            ErrorResponse error = checkNicknameRule(nickname);
            if (error != null) return ResponseEntity.badRequest().body(error);
            user.rename(nickname);
            repository.save(user);
        }
        return ResponseEntity.ok(authResponse(user, bearer(authorization)));
    }

    // 서버 쪽 토큰을 지워 다른 기기에 남은 사본도 무효화한다
    @PostMapping("/api/auth/logout")
    public ResponseEntity<Void> logout(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser user = currentUser(authorization);
        if (user != null) {
            user.issueToken(null);
            repository.save(user);
        }
        return ResponseEntity.noContent().build();
    }

    // 이메일 가입 계정과 관리자(admin). 소셜로만 가입한 계정은 passwordHash가 null이라 여기로 못 들어온다.
    @PostMapping("/api/auth/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        AppUser user = repository.findByEmail(normalizeEmail(request.email())).orElse(null);
        if (user != null && lockedOut(user.getId())) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(new ErrorResponse("비밀번호를 여러 번 틀렸어요. 15분 뒤에 다시 하거나 인증번호로 로그인해주세요."));
        }
        if (user == null || user.getPasswordHash() == null
                || request.password() == null || !encoder.matches(request.password(), user.getPasswordHash())) {
            if (user != null) recordLoginFailure(user.getId());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ErrorResponse("비밀번호가 맞지 않아요."));
        }
        state.remove(LOGIN_FAIL_KIND, String.valueOf(user.getId()));
        return ResponseEntity.ok(signIn(user));
    }

    private boolean lockedOut(Long userId) {
        return state.counter(LOGIN_FAIL_KIND, String.valueOf(userId)) >= MAX_LOGIN_FAILURES;
    }

    // 첫 실패부터 15분 창 안에서 센다. 창이 지나면(행이 만료되면) 새로 센다.
    private void recordLoginFailure(Long userId) {
        state.increment(LOGIN_FAIL_KIND, String.valueOf(userId), Instant.now().plusSeconds(LOGIN_LOCK_SECONDS));
    }

    // 비밀번호를 잊었을 때 이메일 인증번호로 로그인 (비밀번호 찾기 대용). newPassword가 오면 비밀번호도 바꾼다 —
    // 비밀번호가 새어도 주인이 바꿀 수 있게. 토큰이 새로 발급돼 다른 기기 세션은 끊긴다.
    @PostMapping("/api/auth/login-code")
    public ResponseEntity<?> loginWithCode(@RequestBody CodeRequest request) {
        String email = normalizeEmail(request.email());
        AppUser user = repository.findByEmail(email).orElse(null);
        if (user == null) {
            return ResponseEntity.badRequest().body(new ErrorResponse("가입되지 않은 이메일이에요."));
        }
        String newPassword = request.newPassword() == null || request.newPassword().isEmpty() ? null : request.newPassword();
        if (newPassword != null && newPassword.length() < MIN_PASSWORD_LENGTH) {
            return ResponseEntity.badRequest().body(new ErrorResponse("비밀번호는 " + MIN_PASSWORD_LENGTH + "자 이상이어야 해요."));
        }
        ErrorResponse error = verifyCode(email, request.emailCode());
        if (error != null) {
            return ResponseEntity.badRequest().body(error);
        }
        if (newPassword != null) {
            user.changePassword(encoder.encode(newPassword));
            state.remove(LOGIN_FAIL_KIND, String.valueOf(user.getId()));
        }
        AuthResponse session = signIn(user);
        forgetCode(email);
        return ResponseEntity.ok(session);
    }
}
