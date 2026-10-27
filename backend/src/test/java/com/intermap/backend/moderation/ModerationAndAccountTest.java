package com.intermap.backend.moderation;

import com.intermap.backend.account.AccountController;
import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.favorite.Favorite;
import com.intermap.backend.favorite.FavoriteRepository;
import com.intermap.backend.review.Review;
import com.intermap.backend.review.ReviewComment;
import com.intermap.backend.review.ReviewCommentController;
import com.intermap.backend.review.ReviewCommentRepository;
import com.intermap.backend.review.ReviewController;
import com.intermap.backend.review.ReviewRepository;
import com.intermap.backend.social.Follow;
import com.intermap.backend.social.FollowRepository;
import com.intermap.backend.social.SocialController;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 신고·차단·회원 탈퇴 — 스토어 사용자 생성 콘텐츠 / 계정 삭제 정책에 맞춘 동작
@SpringBootTest
@Transactional
class ModerationAndAccountTest {

    @Autowired ModerationController moderation;
    @Autowired AccountController account;
    @Autowired ReviewController reviewController;
    @Autowired ReviewCommentController commentController;
    @Autowired SocialController social;
    @Autowired AppUserRepository users;
    @Autowired ReviewRepository reviews;
    @Autowired ReviewCommentRepository comments;
    @Autowired FollowRepository follows;
    @Autowired FavoriteRepository favorites;
    @Autowired ReportRepository reports;
    @Autowired UserBlockRepository blocks;

    private AppUser user(String name) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        AppUser u = new AppUser(name + suffix + "@test.local", null, name + suffix, null);
        u.issueToken(UUID.randomUUID().toString());
        return users.save(u);
    }

    private static String bearer(AppUser u) {
        return "Bearer " + u.getToken();
    }

    private Review review(AppUser author, String text) {
        return reviews.save(new Review(author, "테스트 칼국수" + UUID.randomUUID(), "한식", "서울 중구 을지로 1", 4.5, text, null));
    }

    private List<Long> visibleReviewIds(AppUser viewer) {
        return reviewController.list(viewer == null ? null : bearer(viewer)).stream().map(ReviewController.Item::id).toList();
    }

    private List<Long> visibleCommentIds(AppUser viewer) {
        return commentController.list(bearer(viewer)).stream().map(ReviewCommentController.Item::id).toList();
    }

    @Test
    void blockHidesContentBothWaysAndCutsFollows() {
        AppUser me = user("me");
        AppUser other = user("other");
        Review mine = review(me, "내 후기");
        Review theirs = review(other, "상대 후기");
        ReviewComment theirComment = comments.save(new ReviewComment(mine, other, null, "상대 댓글"));
        follows.save(new Follow(me, other));
        follows.save(new Follow(other, me));

        assertEquals(HttpStatus.OK, moderation.block(bearer(me), other.getId()).getStatusCode());

        assertFalse(visibleReviewIds(me).contains(theirs.getId()), "내가 차단한 사람 후기는 안 보인다");
        assertFalse(visibleReviewIds(other).contains(mine.getId()), "나를 차단한 사람 후기도 안 보인다");
        assertTrue(visibleReviewIds(null).contains(theirs.getId()), "로그인 안 한 목록엔 그대로");
        assertFalse(visibleCommentIds(me).contains(theirComment.getId()));
        assertTrue(follows.findByFollowerAndFollowee(me, other).isEmpty());
        assertTrue(follows.findByFollowerAndFollowee(other, me).isEmpty());

        assertEquals(HttpStatus.BAD_REQUEST, social.follow(bearer(other), me.getId()).getStatusCode());
        assertEquals(HttpStatus.FORBIDDEN, commentController.create(bearer(other),
                new ReviewCommentController.CreateRequest(mine.getId(), "또 댓글", null)).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND, social.profile(bearer(other), me.getId()).getStatusCode(),
                "나를 차단한 사람 프로필은 없는 사람처럼");
        var profile = (SocialController.Profile) social.profile(bearer(me), other.getId()).getBody();
        assertTrue(profile.blocked());

        moderation.unblock(bearer(me), other.getId());
        assertTrue(visibleReviewIds(me).contains(theirs.getId()));
    }

    @Test
    void reportHidesForReporterAndAdminCanRemove() {
        AppUser me = user("me");
        AppUser author = user("author");
        Review target = review(author, "광고 후기");

        var bad = moderation.report(bearer(me), new ModerationController.ReportRequest("REVIEW", target.getId(), "NOPE", null));
        assertEquals(HttpStatus.BAD_REQUEST, bad.getStatusCode());
        var own = moderation.report(bearer(author), new ModerationController.ReportRequest("REVIEW", target.getId(), "SPAM", null));
        assertEquals(HttpStatus.BAD_REQUEST, own.getStatusCode(), "내 글은 신고 못 한다");

        assertEquals(HttpStatus.OK, moderation.report(bearer(me),
                new ModerationController.ReportRequest("review", target.getId(), "spam", "광고예요")).getStatusCode());
        // 두 번 신고해도 한 건
        moderation.report(bearer(me), new ModerationController.ReportRequest("REVIEW", target.getId(), "SPAM", null));
        assertEquals(1, reports.targetIdsReportedBy(me, Report.TargetType.REVIEW).size());
        assertFalse(visibleReviewIds(me).contains(target.getId()), "신고한 사람에게선 바로 숨긴다");
        assertTrue(visibleReviewIds(author).contains(target.getId()));

        assertEquals(HttpStatus.FORBIDDEN, moderation.adminReports(bearer(me), "OPEN").getStatusCode());

        AppUser admin = users.findByEmail(AdminSeeder.ADMIN_EMAIL).orElseThrow();
        admin.issueToken(UUID.randomUUID().toString());
        @SuppressWarnings("unchecked")
        var open = (List<ModerationController.AdminReport>) moderation.adminReports(bearer(admin), "OPEN").getBody();
        var mineReport = open.stream().filter(r -> r.targetId().equals(target.getId())).findFirst().orElseThrow();
        assertTrue(mineReport.targetExists());

        assertEquals(HttpStatus.OK, moderation.resolve(bearer(admin), mineReport.id(),
                new ModerationController.ResolveRequest("REMOVE")).getStatusCode());
        assertTrue(reviews.findById(target.getId()).isEmpty());
        assertEquals(Report.Status.REMOVED, reports.findById(mineReport.id()).orElseThrow().getStatus());
    }

    @Test
    void deleteAccountRemovesEverything() {
        AppUser me = user("me");
        AppUser other = user("other");
        Review mine = review(me, "내 후기");
        Review theirs = review(other, "상대 후기");
        ReviewComment othersOnMine = comments.save(new ReviewComment(mine, other, null, "내 후기에 단 남의 댓글"));
        ReviewComment myRoot = comments.save(new ReviewComment(theirs, me, null, "남의 후기에 단 내 댓글"));
        ReviewComment replyToMine = comments.save(new ReviewComment(theirs, other, myRoot.getId(), "내 댓글에 단 답글"));
        ReviewComment othersRoot = comments.save(new ReviewComment(theirs, other, null, "남의 원댓글"));
        ReviewComment myReply = comments.save(new ReviewComment(theirs, me, othersRoot.getId(), "남의 댓글에 단 내 답글"));
        follows.save(new Follow(me, other));
        follows.save(new Follow(other, me));
        favorites.save(new Favorite(me, "가게", "주소"));
        blocks.save(new UserBlock(other, me));
        moderation.report(bearer(other), new ModerationController.ReportRequest("REVIEW", mine.getId(), "ABUSE", null));
        moderation.report(bearer(me), new ModerationController.ReportRequest("REVIEW", theirs.getId(), "SPAM", null));

        assertEquals(HttpStatus.NO_CONTENT, account.deleteMe(bearer(me)).getStatusCode());

        assertTrue(users.findById(me.getId()).isEmpty());
        assertTrue(reviews.findById(mine.getId()).isEmpty());
        assertTrue(reviews.findById(theirs.getId()).isPresent(), "남의 후기는 그대로");
        assertTrue(comments.findById(othersOnMine.getId()).isEmpty());
        assertTrue(comments.findById(myRoot.getId()).isEmpty());
        assertTrue(comments.findById(replyToMine.getId()).isEmpty(), "내 원댓글 아래 답글도 같이");
        assertTrue(comments.findById(myReply.getId()).isEmpty());
        assertTrue(comments.findById(othersRoot.getId()).isPresent(), "남의 원댓글은 그대로");
        assertTrue(follows.findByFollowerOrderByCreatedAtDesc(other).isEmpty());
        assertTrue(follows.findByFolloweeOrderByCreatedAtDesc(other).isEmpty());
        assertTrue(blocks.findByBlockerOrderByCreatedAtDesc(other).isEmpty());
        assertTrue(reports.targetIdsReportedBy(other, Report.TargetType.REVIEW).contains(mine.getId()),
                "남이 낸 신고 기록은 남는다");

        AppUser admin = users.findByEmail(AdminSeeder.ADMIN_EMAIL).orElseThrow();
        admin.issueToken(UUID.randomUUID().toString());
        assertEquals(HttpStatus.BAD_REQUEST, account.deleteMe(bearer(admin)).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, account.deleteMe(null).getStatusCode());
    }
}
