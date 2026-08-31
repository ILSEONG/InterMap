package com.intermap.backend.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
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
import java.util.function.BiConsumer;
import java.util.regex.Pattern;

@RestController
// https://intermap.app:8443 은 모바일 앱(Capacitor WebView)의 origin, *.vercel.app 은 웹 배포본
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class AuthController {

    public record SignupRequest(String email, String emailCode, String phone, String phoneCode,
                                String password, String nickname) {
    }

    public record LoginRequest(String email, String password) {
    }

    // 소셜 로그인 뒤 우리 계정과 연결할 때. 계정 소유 증명으로 이메일+비밀번호를 한 번 받는다.
    public record LinkRequest(String linkTicket, String email, String password) {
    }

    public record CodeRequest(String email, String phone) {
    }

    public record AuthResponse(String token, String email, String nickname) {
    }

    public record ErrorResponse(String message) {
    }

    public record AvailableResponse(boolean available) {
    }

    public record OkResponse(String message) {
    }

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final Pattern PHONE = Pattern.compile("^010\\d{7,8}$");
    private static final int MIN_PASSWORD_LENGTH = 8;
    private static final long CODE_TTL_SECONDS = 300;
    private static final long RESEND_COOLDOWN_SECONDS = 60;
    private static final int MAX_VERIFY_ATTEMPTS = 5;
    private static final long TOKEN_TTL_DAYS = 30;

    // 인증번호 발송 일일 상한 (SMS pumping 방어). 뚫려도 하루 손실이 문자 300건 ≈ 5,400원에서 멈춘다.
    private static final int DAILY_PER_TARGET = 5;      // 같은 이메일/번호
    private static final int DAILY_PER_IP = 10;         // 같은 IP, 이메일+문자 합산
    private static final int DAILY_GLOBAL_SMS = 300;
    private static final int DAILY_GLOBAL_EMAIL = 250;  // Brevo 무료 한도 300 아래
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    // 발급된 인증번호. 단일 인스턴스 전제라 메모리로 충분 (재시작하면 재발송하면 됨).
    private static final class Verification {
        final String code;
        final Instant issuedAt = Instant.now();
        int attempts = 0;
        // 확인 버튼으로 이미 맞춘 상태. 가입 폼 마저 채우는 동안 만료되지 않게 TTL을 면제한다.
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
    private final SmsService smsService;
    private final PendingSocialLinks pendingLinks;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public AuthController(AppUserRepository repository, MailService mailService, SmsService smsService,
                          PendingSocialLinks pendingLinks) {
        this.repository = repository;
        this.mailService = mailService;
        this.smsService = smsService;
        this.pendingLinks = pendingLinks;
    }

    private static String normalizePhone(String raw) {
        return raw == null ? "" : raw.replaceAll("[^0-9]", "");
    }

    private ResponseEntity<?> issueCode(String key, String target, String ip, BiConsumer<String, String> deliver) {
        Verification existing = codes.get(key);
        boolean sms = key.startsWith("phone:");
        // 어떤 규칙에 걸렸는지 구분해서 알려주지 않는다 — 규칙을 알면 그만큼 우회하기 쉽다
        if ((existing != null && existing.issuedAt.plusSeconds(RESEND_COOLDOWN_SECONDS).isAfter(Instant.now()))
                || overDailyLimit("target:" + key, DAILY_PER_TARGET)
                || overDailyLimit("ip:" + ip, DAILY_PER_IP)
                || overDailyLimit(sms ? "global:sms" : "global:email", sms ? DAILY_GLOBAL_SMS : DAILY_GLOBAL_EMAIL)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(new ErrorResponse("잠시 후 다시 요청해주세요."));
        }
        String code = String.format("%06d", random.nextInt(1_000_000));
        // 발송이 실패하면 저장하지 않는다 — 안 그러면 실패한 요청이 쿨다운만 걸어버린다
        try {
            deliver.accept(target, code);
        } catch (RuntimeException e) {
            log.error("인증번호 발송 실패 {}", key, e);
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                    .body(new ErrorResponse("인증번호 발송에 실패했어요. 잠시 후 다시 시도해주세요."));
        }
        codes.put(key, new Verification(code));
        return ResponseEntity.ok(new OkResponse("인증번호를 보냈어요. 5분 안에 입력해주세요."));
    }

    // null이면 통과, 아니면 그대로 응답할 에러. 통과해도 지우지 않는다 — 가입 완료 시점에 지운다.
    private ErrorResponse verifyCode(String key, String input) {
        Verification verification = codes.get(key);
        if (verification == null || verification.expired()) {
            codes.remove(key);
            return new ErrorResponse("인증번호를 다시 받아주세요.");
        }
        if (verification.verified) {
            return null;
        }
        if (verification.attempts >= MAX_VERIFY_ATTEMPTS) {
            codes.remove(key);
            return new ErrorResponse("시도 횟수를 넘었어요. 인증번호를 다시 받아주세요.");
        }
        verification.attempts += 1;
        if (input == null || !verification.code.equals(input.trim())) {
            return new ErrorResponse("인증번호가 맞지 않아요.");
        }
        verification.verified = true;
        return null;
    }

    private ResponseEntity<?> verifyResponse(String key, String input) {
        ErrorResponse error = verifyCode(key, input);
        return error != null
                ? ResponseEntity.badRequest().body(error)
                : ResponseEntity.ok(new OkResponse("인증됐어요."));
    }

    @PostMapping("/api/auth/verify-email-code")
    public ResponseEntity<?> verifyEmailCode(@RequestBody SignupRequest request) {
        String email = request.email() == null ? "" : request.email().trim().toLowerCase();
        return verifyResponse("email:" + email, request.emailCode());
    }

    @PostMapping("/api/auth/verify-phone-code")
    public ResponseEntity<?> verifyPhoneCode(@RequestBody SignupRequest request) {
        return verifyResponse("phone:" + normalizePhone(request.phone()), request.phoneCode());
    }

    @GetMapping("/api/auth/check-nickname")
    public AvailableResponse checkNickname(@RequestParam String value) {
        String nickname = value == null ? "" : value.trim();
        boolean valid = !nickname.isEmpty() && nickname.length() <= 20;
        return new AvailableResponse(valid && repository.findByNickname(nickname).isEmpty());
    }

    @PostMapping("/api/auth/email-code")
    public ResponseEntity<?> sendEmailCode(@RequestBody CodeRequest request, HttpServletRequest http) {
        String email = request.email() == null ? "" : request.email().trim().toLowerCase();
        if (!EMAIL.matcher(email).matches()) {
            return ResponseEntity.badRequest().body(new ErrorResponse("이메일 형식을 확인해주세요."));
        }
        if (repository.findByEmail(email).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse("이미 가입된 이메일이에요."));
        }
        return issueCode("email:" + email, email, clientIp(http), mailService::sendVerificationCode);
    }

    @PostMapping("/api/auth/phone-code")
    public ResponseEntity<?> sendPhoneCode(@RequestBody CodeRequest request, HttpServletRequest http) {
        String phone = normalizePhone(request.phone());
        if (!PHONE.matcher(phone).matches()) {
            return ResponseEntity.badRequest().body(new ErrorResponse("휴대폰 번호를 확인해주세요."));
        }
        if (repository.findByPhone(phone).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse("이미 가입된 번호예요."));
        }
        return issueCode("phone:" + phone, phone, clientIp(http), smsService::sendVerificationCode);
    }

    @PostMapping("/api/auth/signup")
    public ResponseEntity<?> signup(@RequestBody SignupRequest request) {
        String email = request.email() == null ? "" : request.email().trim().toLowerCase();
        String nickname = request.nickname() == null ? "" : request.nickname().trim();
        String phone = normalizePhone(request.phone());
        if (!EMAIL.matcher(email).matches()) {
            return ResponseEntity.badRequest().body(new ErrorResponse("이메일 형식을 확인해주세요."));
        }
        if (!PHONE.matcher(phone).matches()) {
            return ResponseEntity.badRequest().body(new ErrorResponse("휴대폰 번호를 확인해주세요."));
        }
        if (request.password() == null || request.password().length() < MIN_PASSWORD_LENGTH) {
            return ResponseEntity.badRequest().body(new ErrorResponse("비밀번호는 " + MIN_PASSWORD_LENGTH + "자 이상이어야 해요."));
        }
        if (nickname.isEmpty() || nickname.length() > 20) {
            return ResponseEntity.badRequest().body(new ErrorResponse("닉네임은 1~20자로 해주세요."));
        }
        if (repository.findByNickname(nickname).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse("이미 사용 중인 닉네임이에요."));
        }
        if (repository.findByEmail(email).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse("이미 가입된 이메일이에요."));
        }
        if (repository.findByPhone(phone).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse("이미 가입된 번호예요."));
        }
        ErrorResponse emailError = verifyCode("email:" + email, request.emailCode());
        if (emailError != null) {
            return ResponseEntity.badRequest().body(new ErrorResponse("이메일 " + emailError.message()));
        }
        ErrorResponse phoneError = verifyCode("phone:" + phone, request.phoneCode());
        if (phoneError != null) {
            return ResponseEntity.badRequest().body(new ErrorResponse("휴대폰 " + phoneError.message()));
        }
        AppUser user = new AppUser(email, encoder.encode(request.password()), nickname, phone);
        user.issueToken(UUID.randomUUID().toString());
        repository.save(user);
        codes.remove("email:" + email);
        codes.remove("phone:" + phone);
        return ResponseEntity.ok(new AuthResponse(user.getToken(), user.getEmail(), user.getNickname()));
    }

    // 이메일+비밀번호가 맞으면 그 계정에 소셜 계정을 연결하고 로그인시킨다
    @PostMapping("/api/auth/link-social")
    public ResponseEntity<?> linkSocial(@RequestBody LinkRequest request) {
        PendingSocialLinks.Pending pending = pendingLinks.get(request.linkTicket());
        if (pending == null) {
            return ResponseEntity.badRequest().body(new ErrorResponse("소셜 로그인 정보가 만료됐어요. 다시 시도해주세요."));
        }
        AppUser user = authenticate(request.email(), request.password());
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ErrorResponse("이메일 또는 비밀번호가 맞지 않아요."));
        }
        if (user.getProviderId() != null && !pending.providerId().equals(user.getProviderId())) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse("이 계정에는 이미 다른 SNS 계정이 연결돼 있어요."));
        }
        user.linkProvider(pending.provider(), pending.providerId());
        user.issueToken(UUID.randomUUID().toString());
        repository.save(user);
        pendingLinks.remove(request.linkTicket());
        return ResponseEntity.ok(new AuthResponse(user.getToken(), user.getEmail(), user.getNickname()));
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
        return ResponseEntity.ok(new AuthResponse(user.getToken(), user.getEmail(), user.getNickname()));
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

    // 이메일 존재 여부를 구분해서 알려주지 않는다 (계정 존재 탐지 방지). 실패하면 null
    private AppUser authenticate(String rawEmail, String password) {
        String email = rawEmail == null ? "" : rawEmail.trim().toLowerCase();
        AppUser user = repository.findByEmail(email).orElse(null);
        if (user == null || user.getPasswordHash() == null
                || password == null || !encoder.matches(password, user.getPasswordHash())) {
            return null;
        }
        return user;
    }

    @PostMapping("/api/auth/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        AppUser user = authenticate(request.email(), request.password());
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ErrorResponse("이메일 또는 비밀번호가 맞지 않아요."));
        }
        user.issueToken(UUID.randomUUID().toString());
        repository.save(user);
        return ResponseEntity.ok(new AuthResponse(user.getToken(), user.getEmail(), user.getNickname()));
    }
}
