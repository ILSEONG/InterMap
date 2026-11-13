package com.intermap.backend.review;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.DailyLimits;
import com.intermap.backend.auth.UserAvatarRepository;
import com.intermap.backend.moderation.Blocks;
import com.intermap.backend.moderation.Report;
import com.intermap.backend.moderation.ReportRepository;
import com.intermap.backend.push.PushService;
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
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "capacitor://intermap.app:8443", "https://*.vercel.app"})
public class ReviewCommentController {

    public record CreateRequest(Long reviewId, String text, Long parentId) {
    }

    public record Item(Long id, Long reviewId, Long parentId, ReviewController.Author author, String text,
                       Instant createdAt) {
        static Item from(ReviewComment c, String avatar) {
            AppUser a = c.getAuthor();
            return new Item(c.getId(), c.getReview().getId(), c.getParentId(),
                    new ReviewController.Author(a.getId(), a.getNickname(), AdminSeeder.ADMIN_EMAIL.equals(a.getEmail()), avatar),
                    c.getText(), c.getCreatedAt());
        }
    }

    // 계정 하나가 하루에 달 수 있는 댓글 수 — 도배 방지
    static final int DAILY_COMMENTS = 100;

    private final ReviewCommentRepository repository;
    private final ReviewRepository reviews;
    private final AuthController auth;
    private final UserAvatarRepository avatars;
    private final ReviewCleanup cleanup;
    private final Blocks blocks;
    private final ReportRepository reports;
    private final DailyLimits limits;
    private final ReviewAudience audience;
    private final PushService push;

    public ReviewCommentController(ReviewCommentRepository repository, ReviewRepository reviews, AuthController auth,
                                   UserAvatarRepository avatars, ReviewCleanup cleanup, Blocks blocks,
                                   ReportRepository reports, DailyLimits limits, ReviewAudience audience,
                                   PushService push) {
        this.limits = limits;
        this.push = push;
        this.audience = audience;
        this.repository = repository;
        this.reviews = reviews;
        this.auth = auth;
        this.avatars = avatars;
        this.cleanup = cleanup;
        this.blocks = blocks;
        this.reports = reports;
    }

    // 볼 수 있는 후기(ReviewAudience)에 달린 댓글을 전부 내려준다 — 프론트가 후기별로 나눈다.
    // 로그인했으면 차단 관계인 사람의 댓글과 내가 신고한 댓글은 뺀다.
    // ponytail: 댓글이 수천 건 넘으면 reviewId 파라미터로 잘라 받도록 바꿀 것
    @GetMapping("/api/comments")
    public List<Item> list(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser viewer = auth.currentUser(authorization);
        Predicate<AppUser> visible = audience.visibleAuthors(viewer);
        Set<Long> hiddenAuthors = blocks.hiddenFor(viewer);
        Set<Long> reported = viewer == null ? Set.of()
                : Set.copyOf(reports.targetIdsReportedBy(viewer, Report.TargetType.COMMENT));
        Map<Long, String> avatarUrls = avatars.urlsByUserId();
        return repository.findAllByOrderByCreatedAtAsc().stream()
                .filter(c -> visible.test(c.getReview().getAuthor()))
                .filter(c -> !hiddenAuthors.contains(c.getAuthor().getId()) && !reported.contains(c.getId()))
                .map(c -> Item.from(c, avatarUrls.get(c.getAuthor().getId())))
                .toList();
    }

    @PostMapping("/api/comments")
    @Transactional
    public ResponseEntity<?> create(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @RequestBody CreateRequest request) {
        AppUser user = auth.currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("로그인 후 댓글을 남길 수 있어요."));
        }
        String text = request.text() == null ? "" : request.text().trim();
        if (text.isEmpty() || text.length() > 500) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("댓글은 1~500자로 남겨주세요."));
        }
        Review review = request.reviewId() == null ? null : reviews.findById(request.reviewId()).orElse(null);
        // 볼 수 없는 후기(팔로우하지 않은 사람 것)에는 댓글도 못 단다 — 있는지조차 알려주지 않는다
        if (review == null || !audience.visibleAuthors(user).test(review.getAuthor())) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("댓글을 달 후기를 찾지 못했어요."));
        }
        // 후기 작성자와 차단 관계면 댓글을 달 수 없다
        if (blocks.between(user, review.getAuthor())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("이 후기에는 댓글을 달 수 없어요."));
        }
        // 대댓글이면 부모가 같은 후기의 원댓글이어야 한다 (대댓글에 또 답글은 없다)
        ReviewComment parent = null;
        if (request.parentId() != null) {
            parent = repository.findById(request.parentId()).orElse(null);
            if (parent == null || !parent.getReview().getId().equals(review.getId()) || parent.getParentId() != null) {
                return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("답글을 달 댓글을 찾지 못했어요."));
            }
            // 원댓글 작성자와 차단 관계여도 답글을 달 수 없다
            if (blocks.between(user, parent.getAuthor())) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("이 댓글에는 답글을 달 수 없어요."));
            }
        }
        if (limits.exceeded("comment:" + user.getId(), DAILY_COMMENTS)) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(new AuthController.ErrorResponse("오늘은 댓글을 더 달 수 없어요. 내일 다시 해주세요."));
        }
        ReviewComment saved = repository.save(new ReviewComment(review, user, request.parentId(), text));
        // 푸시 알림 — 답글이면 원댓글 쓴 사람에게, 그 밖엔 후기 쓴 사람에게 (같은 사람이면 답글로 한 번만, 내가 나에게는 안 보낸다)
        AppUser parentAuthor = parent == null ? null : parent.getAuthor();
        AppUser reviewAuthor = review.getAuthor();
        Map<String, String> data = Map.of("type", parent == null ? "COMMENT" : "REPLY", "reviewId", String.valueOf(review.getId()));
        if (parentAuthor != null && !parentAuthor.getId().equals(user.getId())) {
            push.send(parentAuthor, user.getNickname() + "님이 내 댓글에 답글을 남겼어요", text, data);
        }
        if (!reviewAuthor.getId().equals(user.getId())
                && (parentAuthor == null || !parentAuthor.getId().equals(reviewAuthor.getId()))) {
            push.send(reviewAuthor, user.getNickname() + "님이 " + review.getRestaurantName() + " 후기에 댓글을 남겼어요", text, data);
        }
        return ResponseEntity.ok(Item.from(saved, avatars.urlOf(user.getId())));
    }

    // 본인 댓글만. 원댓글을 지우면 대댓글도 같이 지운다.
    @DeleteMapping("/api/comments/{id}")
    @Transactional
    public ResponseEntity<?> delete(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @PathVariable Long id) {
        AppUser user = auth.currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
        }
        ReviewComment comment = repository.findById(id).orElse(null);
        if (comment == null || !comment.getAuthor().getId().equals(user.getId())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("내가 쓴 댓글만 지울 수 있어요."));
        }
        cleanup.deleteComment(comment, Report.Status.GONE);
        return ResponseEntity.noContent().build();
    }
}
