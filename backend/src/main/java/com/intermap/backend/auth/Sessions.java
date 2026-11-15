package com.intermap.backend.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// 로그인 토큰 발급·확인. 방식은 서버가 기억하는 임의 토큰이다 (JWT·쿠키가 아니다):
// 로그인하면 임의 문자열을 앱에 주고 서버는 그 해시만 기기별 줄(AuthSession)에 적어 둔다.
// 앱은 그걸 저장해 두었다가 요청마다 "Authorization: Bearer <토큰>"으로 보낸다.
// 서버가 줄을 지우면 그 즉시 무효가 되므로 기기별 로그아웃·전체 로그아웃이 된다.
@Component
public class Sessions {

    private static final Logger log = LoggerFactory.getLogger(Sessions.class);

    // 마지막으로 쓴 뒤 이만큼 지나면 만료 — 쓰는 동안은 계속 늘어나서 같은 기기에서는 로그인이 풀리지 않는다
    static final Duration IDLE_TTL = Duration.ofDays(90);
    // 요청마다 DB를 쓰지 않게, 마지막으로 쓴 때는 이 간격으로만 고쳐 적는다
    static final Duration TOUCH_EVERY = Duration.ofHours(12);
    // 기기별 줄이 생기기 전에 발급된 토큰(AppUser.token)은 발급 후 이만큼만 받는다 (그때의 규칙 그대로)
    static final Duration LEGACY_TTL = Duration.ofDays(30);
    // 로그인한 적 있는 기기로 기억하는 기간 — 이보다 오래 안 쓰던 기기는 다시 "처음 보는 기기"가 된다
    static final Duration REMEMBER_DEVICE = Duration.ofDays(365);

    static final String DEVICE_HEADER = "X-Device-Id";
    private static final Pattern DEVICE_ID = Pattern.compile("[A-Za-z0-9_-]{16,64}");
    private static final Pattern ANDROID_MODEL = Pattern.compile("Android [\\d.]+; ([^;)]+?)(?: Build/[^;)]*)?[;)]");

    // 토큰으로 찾은 로그인. session이 null이면 예전 방식 토큰(AppUser.token)으로 들어온 것
    public record Current(AppUser user, AuthSession session) {
        public Instant signedInAt() {
            return session != null ? session.getSignedInAt() : user.getTokenIssuedAt();
        }
    }

    // 새로 연 로그인. newDevice = 다른 기기를 쓰던 계정에 처음 보는 기기가 나타났다 (알려야 한다)
    public record Opened(String token, AuthSession session, boolean newDevice) {
    }

    private final AuthSessionRepository sessions;
    private final AppUserRepository users;

    public Sessions(AuthSessionRepository sessions, AppUserRepository users) {
        this.sessions = sessions;
        this.users = users;
    }

    // 지금 요청을 보낸 기기 — 웹 요청 밖(테스트·시작 작업)이면 null
    private static HttpServletRequest request() {
        return RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attrs ? attrs.getRequest() : null;
    }

    static String deviceIdOf(HttpServletRequest request) {
        String raw = request == null ? null : request.getHeader(DEVICE_HEADER);
        return raw != null && DEVICE_ID.matcher(raw).matches() ? raw : null;
    }

    // User-Agent에서 사람이 알아볼 기기 이름을 만든다. 정확할 필요는 없다 — "내 폰인지 아닌지" 알아볼 정도면 된다
    static String deviceLabelOf(String userAgent) {
        if (userAgent == null || userAgent.isBlank()) return "알 수 없는 기기";
        String ua = userAgent;
        String browser = ua.contains("Edg/") || ua.contains("EdgA/") || ua.contains("EdgiOS/") ? "Edge"
                : ua.contains("SamsungBrowser/") ? "삼성 인터넷"
                : ua.contains("Whale/") ? "웨일"
                : ua.contains("Firefox/") || ua.contains("FxiOS/") ? "Firefox"
                : ua.contains("Chrome/") || ua.contains("CriOS/") ? "Chrome"
                : ua.contains("Safari/") ? "Safari"
                : null;
        if (ua.contains("Android")) {
            boolean app = ua.contains("; wv)");
            Matcher m = ANDROID_MODEL.matcher(ua);
            String model = m.find() ? m.group(1).trim() : "";
            // 요즘 크롬은 모델 자리에 "K"만 보낸다
            String suffix = model.length() > 1 && !model.equals("wv") ? " (" + model + ")" : "";
            return clip(app ? "Android 앱" + suffix : "Android" + suffix + (browser == null ? "" : " · " + browser));
        }
        boolean iphone = ua.contains("iPhone");
        if (iphone || ua.contains("iPad")) {
            String device = iphone ? "iPhone" : "iPad";
            // 앱 안 웹뷰는 Safari 표시가 없다
            return browser == null ? device + " 앱" : device + " · " + browser;
        }
        String os = ua.contains("Windows") ? "Windows PC" : ua.contains("Macintosh") || ua.contains("Mac OS X") ? "Mac"
                : ua.contains("CrOS") ? "크롬북" : ua.contains("Linux") ? "Linux PC" : null;
        if (os == null) return browser == null ? "알 수 없는 기기" : browser;
        return browser == null ? os : os + " · " + browser;
    }

    private static String clip(String label) {
        String clean = label.replaceAll("\\p{Cntrl}", "");
        return clean.length() > 80 ? clean.substring(0, 80) : clean;
    }

    // 로그인 — 지금 요청을 보낸 기기에 새 토큰을 준다. 다른 기기의 로그인은 건드리지 않는다
    public Opened open(AppUser user) {
        HttpServletRequest request = request();
        String deviceId = deviceIdOf(request);
        String label = deviceLabelOf(request == null ? null : request.getHeader("User-Agent"));
        String token = UUID.randomUUID().toString();
        String hash = AppUser.hashToken(token);

        if (deviceId != null) {
            AuthSession known = sessions.findByUserAndDeviceId(user, deviceId).orElse(null);
            if (known != null) {
                known.signInAgain(hash, label);
                return new Opened(token, sessions.save(known), false);
            }
        }
        // 처음 보는 기기. 이 계정이 이미 다른 기기에서 로그인해 있었으면 알린다 (가입 직후 첫 기기는 알릴 곳이 없다).
        // 식별값을 안 보내는 예전 앱은 매번 새 기기로 보이므로 알리지 않는다
        boolean newDevice = deviceId != null
                && (sessions.existsByUserAndDeviceIdIsNotNull(user) || hasLiveLegacyToken(user));
        try {
            return new Opened(token, sessions.save(new AuthSession(user, hash, deviceId, label, newDevice)), newDevice);
        } catch (DataIntegrityViolationException e) {
            // 같은 기기에서 로그인 요청이 겹쳤다 — 먼저 생긴 줄에 토큰만 바꿔 적는다
            AuthSession known = sessions.findByUserAndDeviceId(user, deviceId).orElseThrow(() -> e);
            known.signInAgain(hash, label);
            return new Opened(token, sessions.save(known), false);
        }
    }

    private static boolean hasLiveLegacyToken(AppUser user) {
        return user.getTokenIssuedAt() != null && user.getTokenIssuedAt().plus(LEGACY_TTL).isAfter(Instant.now());
    }

    // 토큰의 주인. 없거나 만료면 null
    public Current find(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) return null;
        String hash = AppUser.hashToken(rawToken);
        Instant now = Instant.now();
        AuthSession session = sessions.findByTokenHash(hash).orElse(null);
        if (session != null) {
            if (session.getLastUsedAt().plus(IDLE_TTL).isBefore(now)) return null;
            if (session.getLastUsedAt().plus(TOUCH_EVERY).isBefore(now)) {
                session.touch();
                session = sessions.save(session);
            }
            return new Current(session.getUser(), session);
        }
        AppUser user = users.findByToken(hash).orElse(null);
        if (user == null || !hasLiveLegacyToken(user)) return null;
        // 예전 방식 토큰으로 들어온 기기 — 새 앱(식별값을 보낸다)이면 기기별 줄로 옮겨 적는다.
        // 그래야 이 기기가 "아는 기기"가 되고, 쓰는 동안 로그인이 풀리지 않는다
        String deviceId = deviceIdOf(request());
        if (deviceId == null) return new Current(user, null);
        try {
            HttpServletRequest request = request();
            AuthSession moved = sessions.findByUserAndDeviceId(user, deviceId).orElse(null);
            String label = deviceLabelOf(request == null ? null : request.getHeader("User-Agent"));
            if (moved == null) moved = new AuthSession(user, hash, deviceId, label, false);
            else moved.signInAgain(hash, label);
            moved = sessions.save(moved);
            user.issueToken(null);
            users.save(user);
            return new Current(user, moved);
        } catch (DataIntegrityViolationException e) {
            // 같은 기기의 요청 둘이 동시에 옮기려 했다 — 먼저 옮겨진 줄을 쓴다
            AuthSession moved = sessions.findByTokenHash(hash).orElse(null);
            return new Current(user, moved);
        }
    }

    // 이 기기만 로그아웃
    public void close(Current current) {
        if (current.session() != null) {
            current.session().end();
            sessions.save(current.session());
        } else {
            current.user().issueToken(null);
            users.save(current.user());
        }
    }

    // 이 기기만 남기고 전부 로그아웃. 끊은 기기 수를 돌려준다
    public int closeOthers(Current current) {
        AppUser user = current.user();
        int ended;
        if (current.session() != null) {
            ended = sessions.endOthers(user, current.session().getId());
            // 아직 기기별 줄로 옮겨지지 않은 예전 방식 토큰도 다른 기기의 것이다
            if (user.getTokenIssuedAt() != null) {
                user.issueToken(null);
                users.save(user);
                ended++;
            }
        } else {
            ended = sessions.endAll(user);
        }
        return ended;
    }

    // 계정의 로그인을 전부 끊는다
    public void closeAll(AppUser user) {
        sessions.endAll(user);
        user.issueToken(null);
    }

    // 최근에 이 계정에 새로 나타난 기기들 (알림 목록용)
    public List<AuthSession> newDevicesSince(AppUser user, Instant since) {
        return sessions.findByUserAndAnnouncedTrueAndCreatedAtAfter(user, since);
    }

    // 매일 새벽, 오래 안 쓴 줄을 지운다
    @Scheduled(cron = "0 40 4 * * *", zone = "Asia/Seoul")
    public void purgeUnused() {
        int removed = sessions.deleteUnusedSince(Instant.now().minus(REMEMBER_DEVICE));
        if (removed > 0) log.info("오래 안 쓴 로그인 기록 {}건 정리", removed);
    }
}
