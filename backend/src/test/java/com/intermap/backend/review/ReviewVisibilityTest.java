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

    @Test
    void photosNeedTheirKey() {
        AppUser me = user("me");
        ReviewPhoto photo = photos.save(new ReviewPhoto(review(me), "image/jpeg", new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF}));
        assertEquals(HttpStatus.NOT_FOUND, reviewController.photo(photo.getId(), "wrong-key").getStatusCode());
        assertEquals(HttpStatus.OK, reviewController.photo(photo.getId(), photo.getAccessKey()).getStatusCode());
        var item = reviewController.list(bearer(me)).stream()
                .filter(i -> i.id().equals(photo.getReview().getId())).findFirst().orElseThrow();
        assertEquals(List.of("/api/photos/" + photo.getId() + "/" + photo.getAccessKey()), item.photoUrls());
    }

    @Test
    void profileCountsReviewsWithoutFollowing() {
        AppUser me = user("me");
        AppUser stranger = user("stranger");
        review(stranger);
        review(stranger);
        var profile = (SocialController.Profile) social.profile(bearer(me), stranger.getId()).getBody();
        assertEquals(2, profile.reviewCount());
    }
}
