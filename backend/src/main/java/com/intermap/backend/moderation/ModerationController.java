package com.intermap.backend.moderation;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.DailyLimits;
import com.intermap.backend.auth.UserAvatarRepository;
import com.intermap.backend.review.Review;
import com.intermap.backend.review.ReviewCleanup;
import com.intermap.backend.review.ReviewComment;
import com.intermap.backend.review.ReviewCommentRepository;
import com.intermap.backend.review.ReviewRepository;
import com.intermap.backend.social.FollowRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// 신고와 차단 (스토어 사용자 생성 콘텐츠 정책), 운영자(주인장)용 신고 처리.
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class ModerationController {

    static final int MAX_DETAIL_LENGTH = 500;
    // 하루 신고 수 — 운영자 큐 도배 방지
    static final int DAILY_REPORTS = 50;

    public record ReportRequest(String targetType, Long targetId, String reason, String detail) {
    }

    public record MessageResponse(String message) {
    }

    public record BlockedPerson(Long id, String nickname, String avatar, Instant blockedAt) {
    }

    public record ResolveRequest(String action) {
    }

    // 운영자 화면 한 줄. openCount = 같은 대상에 걸린 처리 전 신고 수, targetExists = 대상이 아직 남아 있는지
    public record AdminReport(Long id, String targetType, Long targetId, Long targetAuthorId, String targetAuthorName,
                              String content, String reason, String detail, String reporterName, String status,
                              Instant createdAt, long openCount, boolean targetExists) {
    }

    private final ReportRepository reports;
    private final UserBlockRepository blocks;
    private final AppUserRepository users;
    private final ReviewRepository reviews;
    private final ReviewCommentRepository comments;
    private final FollowRepository follows;
    private final ReviewCleanup cleanup;
    private final AuthController auth;
    private final UserAvatarRepository avatars;
    private final DailyLimits limits;

    public ModerationController(ReportRepository reports, UserBlockRepository blocks, AppUserRepository users,
                                ReviewRepository reviews, ReviewCommentRepository comments, FollowRepository follows,
                                ReviewCleanup cleanup, AuthController auth, UserAvatarRepository avatars, DailyLimits limits) {
        this.limits = limits;
        this.reports = reports;
        this.blocks = blocks;
        this.users = users;
        this.reviews = reviews;
        this.comments = comments;
        this.follows = follows;
        this.cleanup = cleanup;
        this.auth = auth;
        this.avatars = avatars;
    }

    private static ResponseEntity<?> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(new AuthController.ErrorResponse(message));
    }

    private static boolean isAdmin(AppUser user) {
        return user != null && AdminSeeder.ADMIN_EMAIL.equals(user.getEmail());
    }

    // ---- 신고 ----

    @PostMapping("/api/reports")
    @Transactional
    public ResponseEntity<?> report(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @RequestBody ReportRequest request) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return error(HttpStatus.UNAUTHORIZED, "로그인 후 신고할 수 있어요.");
        Report.TargetType type = parse(Report.TargetType.class, request.targetType());
        Report.Reason reason = parse(Report.Reason.class, request.reason());
        if (type == null || reason == null || request.targetId() == null) {
            return error(HttpStatus.BAD_REQUEST, "신고 사유를 골라주세요.");
        }
        String detail = request.detail() == null ? null : request.detail().trim();
        if (detail != null && detail.isEmpty()) detail = null;
        if (detail != null && detail.length() > MAX_DETAIL_LENGTH) {
            return error(HttpStatus.BAD_REQUEST, "자세한 내용은 " + MAX_DETAIL_LENGTH + "자까지 적을 수 있어요.");
        }

        AppUser author;
        String snapshot;
        if (type == Report.TargetType.REVIEW) {
            Review review = reviews.findById(request.targetId()).orElse(null);
            if (review == null) return error(HttpStatus.NOT_FOUND, "이미 지워진 후기예요.");
            author = review.getAuthor();
            snapshot = "[" + review.getRestaurantName() + "] " + review.getText()
                    + (review.getMenu() == null ? "" : "\n추천 메뉴: " + review.getMenu());
        } else {
            ReviewComment comment = comments.findById(request.targetId()).orElse(null);
            if (comment == null) return error(HttpStatus.NOT_FOUND, "이미 지워진 댓글이에요.");
            author = comment.getAuthor();
            snapshot = comment.getText();
        }
        if (author.getId().equals(me.getId())) {
            return error(HttpStatus.BAD_REQUEST, "내가 쓴 글은 신고할 수 없어요.");
        }
        // 같은 대상을 두 번 신고하면 그대로 접수된 것으로 본다
        if (reports.findByReporterAndTargetTypeAndTargetId(me, type, request.targetId()).isEmpty()) {
            if (limits.exceeded("report:" + me.getId(), DAILY_REPORTS)) {
                return error(HttpStatus.TOO_MANY_REQUESTS, "오늘은 더 신고할 수 없어요. 내일 다시 해주세요.");
            }
            reports.save(new Report(me, type, request.targetId(), author, snapshot, reason, detail));
        }
        return ResponseEntity.ok(new MessageResponse("신고했어요. 운영자가 확인 후 조치할게요."));
    }

    private static <E extends Enum<E>> E parse(Class<E> type, String value) {
        if (value == null) return null;
        try {
            return Enum.valueOf(type, value.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    // ---- 차단 ----

    private List<BlockedPerson> blockListOf(AppUser me) {
        Map<Long, String> avatarUrls = avatars.urlsByUserId();
        return blocks.findByBlockerOrderByCreatedAtDesc(me).stream()
                .map(b -> new BlockedPerson(b.getBlocked().getId(), b.getBlocked().getNickname(),
                        avatarUrls.get(b.getBlocked().getId()), b.getCreatedAt()))
                .toList();
    }

    @GetMapping("/api/me/blocks")
    public ResponseEntity<?> myBlocks(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return error(HttpStatus.UNAUTHORIZED, "다시 로그인해주세요.");
        return ResponseEntity.ok(blockListOf(me));
    }

    // 차단하면 서로의 팔로우를 끊는다. 상대에게 알리지 않는다.
    @PostMapping("/api/me/blocks/{userId}")
    @Transactional
    public ResponseEntity<?> block(@RequestHeader(value = "Authorization", required = false) String authorization,
                                   @PathVariable Long userId) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return error(HttpStatus.UNAUTHORIZED, "다시 로그인해주세요.");
        if (me.getId().equals(userId)) return error(HttpStatus.BAD_REQUEST, "나 자신은 차단할 수 없어요.");
        AppUser target = users.findById(userId).orElse(null);
        if (target == null) return error(HttpStatus.NOT_FOUND, "없는 사용자예요.");
        if (isAdmin(target)) return error(HttpStatus.BAD_REQUEST, "운영자 계정은 차단할 수 없어요.");
        if (blocks.findByBlockerAndBlocked(me, target).isEmpty()) {
            blocks.save(new UserBlock(me, target));
        }
        follows.deleteBetween(me, target);
        return ResponseEntity.ok(blockListOf(me));
    }

    @DeleteMapping("/api/me/blocks/{userId}")
    @Transactional
    public ResponseEntity<?> unblock(@RequestHeader(value = "Authorization", required = false) String authorization,
                                     @PathVariable Long userId) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return error(HttpStatus.UNAUTHORIZED, "다시 로그인해주세요.");
        users.findById(userId).flatMap(t -> blocks.findByBlockerAndBlocked(me, t)).ifPresent(blocks::delete);
        return ResponseEntity.ok(blockListOf(me));
    }

    // ---- 운영자: 신고 처리 ----

    @GetMapping("/api/admin/reports")
    public ResponseEntity<?> adminReports(@RequestHeader(value = "Authorization", required = false) String authorization,
                                          @RequestParam(defaultValue = "OPEN") String status) {
        AppUser me = auth.currentUser(authorization);
        if (!isAdmin(me)) return error(HttpStatus.FORBIDDEN, "운영자만 볼 수 있어요.");
        Report.Status st = parse(Report.Status.class, status);
        if (st == null) return error(HttpStatus.BAD_REQUEST, "알 수 없는 상태예요.");
        List<Report> list = reports.findByStatusOrderByCreatedAtDesc(st);
        Map<String, Long> openCounts = new HashMap<>();
        for (Report r : reports.findByStatusOrderByCreatedAtDesc(Report.Status.OPEN)) {
            openCounts.merge(r.getTargetType() + ":" + r.getTargetId(), 1L, Long::sum);
        }
        return ResponseEntity.ok(list.stream().map(r -> new AdminReport(
                r.getId(), r.getTargetType().name(), r.getTargetId(), r.getTargetAuthorId(), r.getTargetAuthorName(),
                r.getContentSnapshot(), r.getReason().name(), r.getDetail(), r.getReporter().getNickname(),
                r.getStatus().name(), r.getCreatedAt(),
                openCounts.getOrDefault(r.getTargetType() + ":" + r.getTargetId(), 0L),
                targetExists(r))).toList());
    }

    private boolean targetExists(Report r) {
        return r.getTargetType() == Report.TargetType.REVIEW
                ? reviews.existsById(r.getTargetId())
                : comments.existsById(r.getTargetId());
    }

    // action: REMOVE = 대상 삭제(같은 대상의 신고 모두 REMOVED), DISMISS = 문제 없음(같은 대상의 신고 모두 DISMISSED)
    @PostMapping("/api/admin/reports/{id}/resolve")
    @Transactional
    public ResponseEntity<?> resolve(@RequestHeader(value = "Authorization", required = false) String authorization,
                                     @PathVariable Long id, @RequestBody ResolveRequest request) {
        AppUser me = auth.currentUser(authorization);
        if (!isAdmin(me)) return error(HttpStatus.FORBIDDEN, "운영자만 처리할 수 있어요.");
        Report report = reports.findById(id).orElse(null);
        if (report == null) return error(HttpStatus.NOT_FOUND, "없는 신고예요.");
        String action = request.action() == null ? "" : request.action().trim().toUpperCase();
        List<Report> sameTarget = reports.findByTargetTypeAndTargetIdInAndStatus(
                report.getTargetType(), List.of(report.getTargetId()), Report.Status.OPEN);
        switch (action) {
            case "REMOVE" -> {
                boolean removed = false;
                if (report.getTargetType() == Report.TargetType.REVIEW) {
                    Review review = reviews.findById(report.getTargetId()).orElse(null);
                    if (review != null) {
                        cleanup.deleteReview(review, Report.Status.REMOVED);
                        removed = true;
                    }
                } else {
                    ReviewComment comment = comments.findById(report.getTargetId()).orElse(null);
                    if (comment != null) {
                        cleanup.deleteComment(comment, Report.Status.REMOVED);
                        removed = true;
                    }
                }
                // 이미 지워진 대상이면 남은 신고만 닫는다
                if (!removed) sameTarget.forEach(r -> r.resolve(Report.Status.GONE));
            }
            case "DISMISS" -> sameTarget.forEach(r -> r.resolve(Report.Status.DISMISSED));
            default -> {
                return error(HttpStatus.BAD_REQUEST, "처리 방법을 골라주세요.");
            }
        }
        return ResponseEntity.ok(new MessageResponse("처리했어요."));
    }
}
