package com.intermap.backend.review;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
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

// 후기 공개 범위 (PRODUCT.md): 로그아웃이면 주인장 후기만, 로그인하면 나 + 팔로우한 사람 + 주인장.
// 댓글·사진도 같은 기준 — 서버가 아예 안 보낸다.
@SpringBootTest(properties = "admin.password=test-admin-password")
@Transactional
class ReviewVisibilityTest {

    @Autowired ReviewController reviewController;
    @Autowired ReviewCommentController commentController;
    @Autowired SocialController social;
    @Autowired AppUserRepository users;
    @Autowired ReviewRepository reviews;
    @Autowired ReviewCommentRepository comments;
    @Autowired ReviewPhotoRepository photos;
    @Autowired FollowRepository follows;

    private AppUser user(String name) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        return users.save(new AppUser(name + suffix + "@test.local", null, name + suffix, null));
    }

    private String bearer(AppUser u) {
        String token = UUID.randomUUID().toString();
        u.issueToken(token);
        users.save(u);
        return "Bearer " + token;
    }

    private Review review(AppUser author) {
        return reviews.save(new Review(author, "공개범위 식당" + UUID.randomUUID(), "한식", "서울 중구 1", 4, "후기", null));
    }

    private List<Long> reviewIds(AppUser viewer) {
        return reviewController.list(viewer == null ? null : bearer(viewer)).stream().map(ReviewController.Item::id).toList();
    }

    private List<Long> commentIds(AppUser viewer) {
        return commentController.list(viewer == null ? null : bearer(viewer)).stream().map(ReviewCommentController.Item::id).toList();
    }

    @Test
    void onlyOwnFollowedAndOwnerReviewsAreSent() {
        AppUser me = user("me");
        AppUser friend = user("friend");
        AppUser stranger = user("stranger");
        AppUser admin = users.findByEmail(AdminSeeder.ADMIN_EMAIL).orElseThrow();
        follows.save(new Follow(me, friend));
        Review mine = review(me);
        Review friends = review(friend);
        Review strangers = review(stranger);
        Review owners = review(admin);

        List<Long> seen = reviewIds(me);
        assertTrue(seen.containsAll(List.of(mine.getId(), friends.getId(), owners.getId())));
        assertFalse(seen.contains(strangers.getId()), "팔로우하지 않은 사람 후기는 안 온다");

        List<Long> loggedOut = reviewIds(null);
        assertTrue(loggedOut.contains(owners.getId()), "로그아웃이어도 주인장 후기는 보인다");
        assertFalse(loggedOut.contains(friends.getId()));
        assertFalse(loggedOut.contains(mine.getId()));
    }

    @Test
    void commentsFollowTheirReview() {
        AppUser me = user("me");
        AppUser stranger = user("stranger");
        AppUser admin = users.findByEmail(AdminSeeder.ADMIN_EMAIL).orElseThrow();
        Review strangers = review(stranger);
        Review owners = review(admin);
        ReviewComment onStranger = comments.save(new ReviewComment(strangers, stranger, null, "모르는 사람 후기 댓글"));
        ReviewComment onOwner = comments.save(new ReviewComment(owners, stranger, null, "주인장 후기 댓글"));

        assertFalse(commentIds(me).contains(onStranger.getId()));
        assertTrue(commentIds(me).contains(onOwner.getId()), "볼 수 있는 후기의 댓글은 누가 썼든 보인다");
        assertTrue(commentIds(null).contains(onOwner.getId()));
        assertEquals(HttpStatus.BAD_REQUEST, commentController.create(bearer(me),
                new ReviewCommentController.CreateRequest(strangers.getId(), "몰래 댓글", null)).getStatusCode(),
                "볼 수 없는 후기에는 댓글을 못 단다");
    }

    // 비공개 댓글: 쓴 사람과 후기를 쓴 사람만 본다. 비공개 댓글에 달린 답글은 늘 비공개이고, 그 댓글을 쓴 사람도 본다
    @Test
    void secretCommentsReachOnlyTheirPeople() {
        AppUser writer = user("writer");
        AppUser me = user("me");
        AppUser friend = user("friend");
        follows.save(new Follow(me, writer));
        follows.save(new Follow(friend, writer));
        follows.save(new Follow(writer, me));
        Review review = review(writer);

        var made = (ReviewCommentController.Item) commentController.create(bearer(me),
                new ReviewCommentController.CreateRequest(review.getId(), "둘만 아는 얘기", null, true)).getBody();
        assertTrue(made.secret());
        assertTrue(commentIds(me).contains(made.id()), "쓴 사람은 본다");
        assertTrue(commentIds(writer).contains(made.id()), "후기를 쓴 사람은 본다");
        assertFalse(commentIds(friend).contains(made.id()), "같은 후기를 보는 다른 사람에게는 안 간다");

        // 후기를 쓴 사람이 비공개 댓글에 답하면 — 체크하지 않아도 비공개, 원댓글을 쓴 사람은 본다
        var answer = (ReviewCommentController.Item) commentController.create(bearer(writer),
                new ReviewCommentController.CreateRequest(review.getId(), "네 그날 봐요", made.id())).getBody();
        assertTrue(answer.secret(), "비공개 댓글의 답글은 늘 비공개");
        assertTrue(commentIds(me).contains(answer.id()));
        assertFalse(commentIds(friend).contains(answer.id()));

        // 공개 댓글에 단 비공개 답글 — 쓴 사람과 후기를 쓴 사람만. 그 공개 댓글을 쓴 사람에게도 안 간다 (알림에도)
        var open = (ReviewCommentController.Item) commentController.create(bearer(friend),
                new ReviewCommentController.CreateRequest(review.getId(), "맛있겠다", null)).getBody();
        assertFalse(open.secret(), "체크하지 않으면 공개");
        var whisper = (ReviewCommentController.Item) commentController.create(bearer(me),
                new ReviewCommentController.CreateRequest(review.getId(), "사실은요", open.id(), true)).getBody();
        assertTrue(commentIds(writer).contains(whisper.id()));
        assertFalse(commentIds(friend).contains(whisper.id()));
        assertTrue(commentIds(friend).contains(open.id()));

        java.time.Instant from = java.time.Instant.EPOCH;
        assertFalse(comments.findRepliesToSince(friend, from).stream().anyMatch(c -> c.getId().equals(whisper.id())),
                "볼 수 없는 비공개 답글은 알림에도 안 뜬다");
        assertTrue(comments.findRepliesToSince(me, from).stream().anyMatch(c -> c.getId().equals(answer.id())),
                "내 비공개 댓글에 달린 답글은 알림에 뜬다");
    }

    @Test
    void photosNeedTheirKey() {
        AppUser me = user("me");
        ReviewPhoto photo = photos.save(new ReviewPhoto(review(me), "image/jpeg", new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF}));
        assertEquals(HttpStatus.NOT_FOUND, reviewController.photo(photo.getId(), "wrong-key").getStatusCode());
        assertEquals(HttpStatus.OK, reviewController.photo(photo.getId(), photo.getAccessKey()).getStatusCode());
        var item = reviewController.list(bearer(me)).stream()
                .filter(i -> i.id().equals(photo.getReview().getId())).findFirst().orElseThrow();
        assertEquals(List.of("/api/photos/" + photo.getId() + "/" + photo.getAccessKey()), item.photoUrls());
        // 읽을 수 없는 바이트라 크기를 모른다 — 목록에는 null로 실린다
        assertEquals(java.util.Collections.singletonList(null), item.photoRatios());
    }

    @Test
    void photosCarryAspectRatio() throws Exception {
        AppUser me = user("me");
        java.awt.image.BufferedImage img = new java.awt.image.BufferedImage(120, 80, java.awt.image.BufferedImage.TYPE_INT_RGB);
        for (int x = 0; x < 120; x++) for (int y = 0; y < 80; y++) img.setRGB(x, y, x < 60 ? 0xE0533A : 0x2A6F97);
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(img, "jpg", out);
        ReviewPhoto photo = photos.save(new ReviewPhoto(review(me), "image/jpeg", out.toByteArray()));
        var item = reviewController.list(bearer(me)).stream()
                .filter(i -> i.id().equals(photo.getReview().getId())).findFirst().orElseThrow();
        assertEquals(List.of(1.5), item.photoRatios(), "120×80 → 1.5");
    }

    @Test
    void profileCountsReviewsWithoutFollowing() {
        AppUser me = user("me");
        AppUser stranger = user("stranger");
        review(stranger);
        review(stranger);
        var profile = (SocialController.Profile) social.profile(bearer(me), stranger.getId()).getBody();
        assertEquals(2, profile.reviewCount());
        assertEquals(0, profile.cafeReviewCount());
    }

    // 프로필의 후기 수는 카페 후기를 따로도 센다 — 앱의 맛집 화면과 카페 화면이 각자 수를 보여 준다
    @Test
    void profileCountsCafeReviewsApart() {
        AppUser me = user("me");
        AppUser stranger = user("stranger");
        review(stranger);
        reviews.save(new Review(stranger, "Star Coffee " + UUID.randomUUID(), "커피숍", "서울 중구 2", 4, "후기", null));
        var profile = (SocialController.Profile) social.profile(bearer(me), stranger.getId()).getBody();
        assertEquals(2, profile.reviewCount());
        assertEquals(1, profile.cafeReviewCount());
    }
}
