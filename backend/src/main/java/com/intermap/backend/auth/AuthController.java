package com.intermap.backend.auth;

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
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

// 가입/로그인 흐름:
//   이메일 입력 → lookup → 기존 회원이면 비밀번호 로그인(잊었으면 이메일 인증번호로 로그인)
//                        → 신규면 이메일 인증번호 → 약관 동의 → 닉네임+비밀번호 → 가입
//   소셜 로그인 → 연결된 회원이면 로그인 → 같은 이메일 계정이 있으면 인증번호로 연결 → 없으면 닉네임+약관으로 가입
@RestController
// https://intermap.app:8443 은 모바일 앱(Capacitor WebView)의 origin, *.vercel.app 은 웹 배포본
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class AuthController {

    public record EmailRequest(String email) {
    }

    public record CodeRequest(String email, String emailCode) {
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

    public record AuthResponse(Long id, String token, String email, String nickname) {
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
    private static final int MAX_NICKNAME_LENGTH = 20;
    private static final int MIN_PASSWORD_LENGTH = 8;
    private static final long CODE_TTL_SECONDS = 300;
    private static final long RESEND_COOLDOWN_SECONDS = 60;
    private static final int MAX_VERIFY_ATTEMPTS = 5;
    private static final long TOKEN_TTL_DAYS = 30;

    // 인증번호 발송 일일 상한. 뚫려도 하루 손실이 Brevo 무료 한도(300) 안에서 멈춘다.
    private static final int DAILY_PER_TARGET = 5;      // 같은 이메일
    private static final int DAILY_PER_IP = 10;         // 같은 IP
    private static final int DAILY_GLOBAL_EMAIL = 250;
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    // 발급된 인증번호. 단일 인스턴스 전제라 메모리로 충분 (재시작하면 재발송하면 됨).
    private static final class Verification {
        final String code;
        final Instant issuedAt = Instant.now();
        int attempts = 0;
        // 확인 버튼으로 이미 맞춘 상태. 약관·닉네임을 채우는 동안 만료되지 않게 TTL을 면제한다.
        boolean verified = false;

        Verification(String code) {
            this.code = code;
        }

        boolean expired() {
            return !verified && issuedAt.plusSeconds(CODE_TTL_SECONDS).isBefore(Instant.now());
        }
    }

    private final Map<String, Verification> codes = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    // 일일 발송 카운터. 날짜가 바뀌면 통째로 비운다. 메모리라 재시작 시 초기화 — 인증번호 저장소와 같은 전제.
    private final Map<String, Integer> dailyCounts = new ConcurrentHashMap<>();
    private volatile LocalDate countsDay = LocalDate.now(KST);

    private boolean overDailyLimit(String key, int limit) {
        LocalDate today = LocalDate.now(KST);
        if (!today.equals(countsDay)) {
            dailyCounts.clear();
            countsDay = today;
        }
        return dailyCounts.merge(key, 1, Integer::sum) > limit;
    }

    // Render 프록시 뒤라 실제 클라이언트 IP는 X-Forwarded-For 첫 번째 값
    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        return forwarded == null || forwarded.isBlank() ? request.getRemoteAddr() : forwarded.split(",")[0].trim();
    }

    private final AppUserRepository repository;
    private final MailService mailService;
    private final PendingSocialLinks pendingLinks;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public AuthController(AppUserRepository repository, MailService mailService, PendingSocialLinks pendingLinks) {
        this.repository = repository;
        this.mailService = mailService;
        this.pendingLinks = pendingLinks;
    }

    private static String normalizeEmail(String raw) {
        return raw == null ? "" : raw.trim().toLowerCase();
    }

    private ResponseEntity<?> issueCode(String email, String ip) {
        Verification existing = codes.get(email);
        // 어떤 규칙에 걸렸는지 구분해서 알려주지 않는다 — 규칙을 알면 그만큼 우회하기 쉽다
        if ((existing != null && existing.issuedAt.plusSeconds(RESEND_COOLDOWN_SECONDS).isAfter(Instant.now()))
                || overDailyLimit("target:" + email, DAILY_PER_TARGET)
                || overDailyLimit("ip:" + ip, DAILY_PER_IP)
                || overDailyLimit("global:email", DAILY_GLOBAL_EMAIL)) {
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
        codes.put(email, new Verification(code));
        return ResponseEntity.ok(new OkResponse("인증번호를 보냈어요. 5분 안에 입력해주세요."));
    }

    // null이면 통과, 아니면 그대로 응답할 에러. 통과해도 지우지 않는다 — 가입/로그인 완료 시점에 지운다.
    private ErrorResponse verifyCode(String email, String input) {
        Verification verification = codes.get(email);
        if (verification == null || verification.expired()) {
            codes.remove(email);
            return new ErrorResponse("인증번호를 다시 받아주세요.");
        }
        if (verification.verified) {
            return null;
        }
        if (verification.attempts >= MAX_VERIFY_ATTEMPTS) {
            codes.remove(email);
            return new ErrorResponse("시도 횟수를 넘었어요. 인증번호를 다시 받아주세요.");
        }
        verification.attempts += 1;
        if (input == null || !verification.code.equals(input.trim())) {
            return new ErrorResponse("인증번호가 맞지 않아요.");
        }
        verification.verified = true;
        return null;
    }

    // 닉네임 규칙 위반이면 에러, 아니면 null
    private ErrorResponse checkNicknameRule(String nickname) {
        if (nickname.isEmpty() || nickname.length() > MAX_NICKNAME_LENGTH) {
            return new ErrorResponse("닉네임은 1~" + MAX_NICKNAME_LENGTH + "자로 해주세요.");
        }
        if (repository.findByNickname(nickname).isPresent()) {
            return new ErrorResponse("이미 사용 중인 닉네임이에요.");
        }
        return null;
    }

    private AuthResponse signIn(AppUser user) {
        user.issueToken(UUID.randomUUID().toString());
        repository.save(user);
        return new AuthResponse(user.getId(), user.getToken(), user.getEmail(), user.getNickname());
    }

    // 이메일 하나로 로그인/가입을 가른다. 계정 존재 여부가 드러나지만 요즘 흔한 흐름이라 감수한다.
    @PostMapping("/api/auth/lookup")
    public ResponseEntity<?> lookup(@RequestBody EmailRequest request) {
        String email = normalizeEmail(request.email());
        AppUser user = repository.findByEmail(email).orElse(null);
        if (user == null && !EMAIL.matcher(email).matches()) {
            return ResponseEntity.badRequest().body(new ErrorResponse("이메일 형식을 확인해주세요."));
        }
        return ResponseEntity.ok(new LookupResponse(user != null, user != null && user.getPasswordHash() != null,
                user == null ? null : user.getProvider()));
    }

    // 신규 가입·인증번호 로그인·소셜 계정 연결 모두 이걸로 보낸다
    @PostMapping("/api/auth/email-code")
    public ResponseEntity<?> sendEmailCode(@RequestBody EmailRequest request, HttpServletRequest http) {
        String email = normalizeEmail(request.email());
        if (!EMAIL.matcher(email).matches()) {
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
        if (!EMAIL.matcher(email).matches()) {
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
        codes.remove(email);
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
        AuthResponse session = signIn(user);
        codes.remove(email);
        pendingLinks.remove(request.linkTicket());
        return ResponseEntity.ok(session);
    }

    // "Authorization: Bearer <token>" 헤더로 현재 사용자를 찾는다. 없거나 만료면 null.
    // 다른 컨트롤러(후기 작성 등)도 이걸로 로그인 사용자를 확인하면 된다.
    public AppUser currentUser(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) return null;
        AppUser user = repository.findByToken(authorization.substring(7).trim()).orElse(null);
        if (user == null || user.getTokenIssuedAt() == null
                || user.getTokenIssuedAt().plus(TOKEN_TTL_DAYS, ChronoUnit.DAYS).isBefore(Instant.now())) {
            return null;
        }
        return user;
    }

    // 앱 시작 시 저장된 세션이 아직 유효한지 확인
    @GetMapping("/api/auth/me")
    public ResponseEntity<?> me(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser user = currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ErrorResponse("다시 로그인해주세요."));
        }
        return ResponseEntity.ok(new AuthResponse(user.getId(), user.getToken(), user.getEmail(), user.getNickname()));
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
        return ResponseEntity.ok(new AuthResponse(user.getId(), user.getToken(), user.getEmail(), user.getNickname()));
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
        if (user == null || user.getPasswordHash() == null
                || request.password() == null || !encoder.matches(request.password(), user.getPasswordHash())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ErrorResponse("비밀번호가 맞지 않아요."));
        }
        return ResponseEntity.ok(signIn(user));
    }

    // 비밀번호를 잊었을 때 이메일 인증번호로 로그인 (비밀번호 찾기 대용).
    @PostMapping("/api/auth/login-code")
    public ResponseEntity<?> loginWithCode(@RequestBody CodeRequest request) {
        String email = normalizeEmail(request.email());
        AppUser user = repository.findByEmail(email).orElse(null);
        if (user == null) {
            return ResponseEntity.badRequest().body(new ErrorResponse("가입되지 않은 이메일이에요."));
        }
        ErrorResponse error = verifyCode(email, request.emailCode());
        if (error != null) {
            return ResponseEntity.badRequest().body(error);
        }
        AuthResponse session = signIn(user);
        codes.remove(email);
        return ResponseEntity.ok(session);
    }
}
