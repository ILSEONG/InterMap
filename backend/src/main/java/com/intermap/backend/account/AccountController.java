package com.intermap.backend.account;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.UserAvatarRepository;
import com.intermap.backend.favorite.FavoriteRepository;
import com.intermap.backend.moderation.Report;
import com.intermap.backend.moderation.ReportRepository;
import com.intermap.backend.moderation.UserBlockRepository;
import com.intermap.backend.review.Review;
import com.intermap.backend.review.ReviewCleanup;
import com.intermap.backend.review.ReviewComment;
import com.intermap.backend.review.ReviewCommentRepository;
import com.intermap.backend.review.ReviewRepository;
import com.intermap.backend.social.FollowRepository;
import com.intermap.backend.social.UserAliasRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.Comparator;

// 회원 탈퇴 — 계정과 그 사람이 남긴 것을 즉시, 되돌릴 수 없게 지운다 (Google Play 계정 삭제 정책).
// 남이 그 사람 글을 신고한 기록은 사본과 함께 남겨 운영 기록으로 쓴다 (작성자 id·닉네임 사본만 남는다).
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class AccountController {

    private static final Logger log = LoggerFactory.getLogger(AccountController.class);

    private final AppUserRepository users;
    private final AuthController auth;
    private final ReviewRepository reviews;
    private final ReviewCommentRepository comments;
    private final ReviewCleanup cleanup;
    private final FollowRepository follows;
    private final UserAliasRepository aliases;
    private final FavoriteRepository favorites;
    private final UserAvatarRepository avatars;
    private final UserBlockRepository blocks;
    private final ReportRepository reports;

    public AccountController(AppUserRepository users, AuthController auth, ReviewRepository reviews,
                             ReviewCommentRepository comments, ReviewCleanup cleanup, FollowRepository follows,
                             UserAliasRepository aliases, FavoriteRepository favorites, UserAvatarRepository avatars,
                             UserBlockRepository blocks, ReportRepository reports) {
        this.users = users;
        this.auth = auth;
        this.reviews = reviews;
        this.comments = comments;
        this.cleanup = cleanup;
        this.follows = follows;
        this.aliases = aliases;
        this.favorites = favorites;
        this.avatars = avatars;
        this.blocks = blocks;
        this.reports = reports;
    }

    @DeleteMapping("/api/me")
    @Transactional
    public ResponseEntity<?> deleteMe(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
        }
        if (AdminSeeder.ADMIN_EMAIL.equals(me.getEmail())) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("운영자 계정은 탈퇴할 수 없어요."));
        }
        Long id = me.getId();

        // 내 후기 (사진·댓글 포함)
        for (Review review : reviews.findAllByAuthor(me)) {
            cleanup.deleteReview(review, Report.Status.GONE);
        }
        // 남의 후기에 단 내 댓글. 원댓글을 먼저 지우면 그 아래 답글도 같이 지워지므로, 답글 → 원댓글 순서로 본다.
        for (ReviewComment comment : comments.findAllByAuthor(me).stream()
                .sorted(Comparator.comparing((ReviewComment c) -> c.getParentId() == null))
                .toList()) {
            if (comments.existsById(comment.getId())) {
                cleanup.deleteComment(comment, Report.Status.GONE);
            }
        }
        follows.deleteAllInvolving(me);
        aliases.deleteAllInvolving(me);
        favorites.deleteAllByUser(me);
        blocks.deleteAllInvolving(me);
        reports.deleteAllByReporter(me);
        if (avatars.existsById(id)) avatars.deleteById(id);
        users.delete(me);
        log.info("회원 탈퇴: user {}", id);
        return ResponseEntity.noContent().build();
    }
}
