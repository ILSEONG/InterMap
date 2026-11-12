package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.review.Review;
import com.intermap.backend.review.ReviewComment;
import com.intermap.backend.review.ReviewCommentRepository;
import com.intermap.backend.review.ReviewRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 다른 사람의 팔로잉·팔로워 목록: 팔로우 중일 때만 열리고, 각 사람의 관계 표시는 보는 사람 기준이다.
@SpringBootTest
@Transactional
class SocialControllerTest {

    @Autowired
    SocialController controller;
    @Autowired
    AppUserRepository users;
    @Autowired
    FollowRepository follows;
    @Autowired
    FollowRequestRepository requests;
    @Autowired
    NotificationController notifications;
    @Autowired
    ReviewRepository reviews;
    @Autowired
    ReviewCommentRepository comments;

    private AppUser user(String name) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        return users.save(new AppUser(name + suffix + "@test.local", null, name + suffix, null));
    }

    // 부를 때마다 새 토큰을 발급한다 — DB엔 해시만 있어 원문을 다시 꺼낼 수 없다
    private String bearer(AppUser u) {
        String token = UUID.randomUUID().toString();
        u.issueToken(token);
        users.save(u);
        return "Bearer " + token;
    }

    private static Map<Long, SocialController.Person> byId(List<SocialController.Person> people) {
        return people.stream().collect(Collectors.toMap(SocialController.Person::id, Function.identity()));
    }

    @Test
    void listsOwnerFollowsWithViewerRelations() {
        AppUser me = user("me");
        AppUser owner = user("owner");
        AppUser a = user("a");
        AppUser b = user("b");
        follows.save(new Follow(me, owner));
        follows.save(new Follow(owner, a));
        follows.save(new Follow(owner, me));
        follows.save(new Follow(b, owner));
        follows.save(new Follow(me, a));

        ResponseEntity<?> res = controller.socialOfUser(bearer(me), owner.getId());
        assertEquals(HttpStatus.OK, res.getStatusCode());
        var body = (SocialController.SocialResponse) res.getBody();

        var following = byId(body.following());
        assertEquals(Set.of(a.getId(), me.getId()), following.keySet());
        assertTrue(following.get(a.getId()).following(), "내가 a를 팔로우 중");
        assertFalse(following.get(a.getId()).followsMe());

        var followers = byId(body.followers());
        assertEquals(Set.of(me.getId(), b.getId()), followers.keySet());
        assertFalse(followers.get(b.getId()).following(), "나는 b를 팔로우하지 않음");
    }

    @Test
    void forbiddenUnlessFollowing() {
        AppUser me = user("me");
        AppUser owner = user("owner");
        follows.save(new Follow(owner, me));

        assertEquals(HttpStatus.FORBIDDEN, controller.socialOfUser(bearer(me), owner.getId()).getStatusCode());
        assertEquals(HttpStatus.OK, controller.socialOfUser(bearer(me), me.getId()).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, controller.socialOfUser(null, owner.getId()).getStatusCode());
    }

    private SocialController.SocialResponse body(ResponseEntity<?> res) {
        assertEquals(HttpStatus.OK, res.getStatusCode());
        return (SocialController.SocialResponse) res.getBody();
    }

    @Test
    void autoApprovalFollowsImmediately() {
        AppUser me = user("me");
        AppUser target = user("target");

        var social = body(controller.follow(bearer(me), target.getId()));
        assertEquals(List.of(target.getId()), social.following().stream().map(SocialController.Person::id).toList());
        assertTrue(social.requested().isEmpty());
        assertFalse(social.manualApproval());
    }

    @Test
    void manualApprovalHoldsFollowUntilAccepted() {
        AppUser me = user("me");
        AppUser target = user("target");
        assertTrue(body(controller.setApproval(bearer(target), new SocialController.ApprovalRequest(true))).manualApproval());

        // 요청만 남고 팔로우는 아직 — 두 번 눌러도 요청은 하나
        controller.follow(bearer(me), target.getId());
        var mine = body(controller.follow(bearer(me), target.getId()));
        assertTrue(mine.following().isEmpty());
        assertEquals(List.of(target.getId()), mine.requested().stream().map(SocialController.Person::id).toList());
        assertTrue(follows.findByFollowerAndFollowee(me, target).isEmpty());
        assertEquals(1, requests.findByTargetOrderByCreatedAtDesc(target).size());

        var profile = (SocialController.Profile) controller.profile(bearer(me), target.getId()).getBody();
        assertTrue(profile.requested());
        assertTrue(profile.manualApproval());
        assertFalse(profile.following());

        // 받은 사람에게는 요청과 알림으로 보인다
        var theirs = body(controller.social(bearer(target)));
        assertEquals(List.of(me.getId()), theirs.requests().stream().map(SocialController.Person::id).toList());
        var notice = (NotificationController.Response) notifications.list(bearer(target)).getBody();
        assertEquals(List.of("FOLLOW_REQUEST"), notice.items().stream().map(NotificationController.Item::type).toList());
        assertEquals(1, notice.unread());

        // 수락하면 팔로우가 맺어지고 요청은 사라진다. 보낸 사람은 "수락" 알림을 받는다
        var accepted = body(controller.acceptRequest(bearer(target), me.getId()));
        assertTrue(accepted.requests().isEmpty());
        assertEquals(List.of(me.getId()), accepted.followers().stream().map(SocialController.Person::id).toList());
        assertTrue(follows.findByFollowerAndFollowee(me, target).isPresent());
        var mineNotice = (NotificationController.Response) notifications.list(bearer(me)).getBody();
        assertEquals(List.of("FOLLOW_ACCEPTED"), mineNotice.items().stream().map(NotificationController.Item::type).toList());
        // 내가 수락해서 생긴 팔로워는 다시 알리지 않는다
        assertTrue(((NotificationController.Response) notifications.list(bearer(target)).getBody()).items().isEmpty());
        assertEquals(HttpStatus.NOT_FOUND, controller.acceptRequest(bearer(target), me.getId()).getStatusCode());
    }

    @Test
    void rejectAndCancelRemoveTheRequest() {
        AppUser a = user("a");
        AppUser b = user("b");
        AppUser target = user("target");
        controller.setApproval(bearer(target), new SocialController.ApprovalRequest(true));
        controller.follow(bearer(a), target.getId());
        controller.follow(bearer(b), target.getId());

        // 거절
        var afterReject = body(controller.rejectRequest(bearer(target), a.getId()));
        assertEquals(List.of(b.getId()), afterReject.requests().stream().map(SocialController.Person::id).toList());
        assertTrue(follows.findByFollowerAndFollowee(a, target).isEmpty());
        // 보낸 쪽이 취소 (언팔로우와 같은 길)
        assertTrue(body(controller.unfollow(bearer(b), target.getId())).requested().isEmpty());
        assertTrue(body(controller.social(bearer(target))).requests().isEmpty());
    }

    @Test
    void switchingBackToAutoAcceptsPendingRequests() {
        AppUser me = user("me");
        AppUser target = user("target");
        controller.setApproval(bearer(target), new SocialController.ApprovalRequest(true));
        controller.follow(bearer(me), target.getId());

        var social = body(controller.setApproval(bearer(target), new SocialController.ApprovalRequest(false)));
        assertFalse(social.manualApproval());
        assertTrue(social.requests().isEmpty());
        assertEquals(List.of(me.getId()), social.followers().stream().map(SocialController.Person::id).toList());
    }

    @Test
    void newFollowerIsNotifiedAndSeenClearsUnread() {
        AppUser me = user("me");
        AppUser fan = user("fan");
        controller.follow(bearer(fan), me.getId());

        var before = (NotificationController.Response) notifications.list(bearer(me)).getBody();
        assertEquals(List.of("FOLLOW"), before.items().stream().map(NotificationController.Item::type).toList());
        assertEquals(fan.getId(), before.items().get(0).actor().id());
        assertEquals(1, before.unread());

        var after = (NotificationController.Response) notifications.seen(bearer(me)).getBody();
        assertEquals(1, after.items().size());
        assertEquals(0, after.unread());
        assertEquals(HttpStatus.UNAUTHORIZED, notifications.list(null).getStatusCode());
    }

    @Test
    void commentsAndRepliesAreNotifiedOnce() {
        AppUser me = user("me");
        AppUser friend = user("friend");
        Review mine = reviews.save(new Review(me, "모퉁이떡볶이", "분식", "서울 어딘가 1", 4.5, "맛있어요", null));
        Review theirs = reviews.save(new Review(friend, "솥밥집", "한식", "서울 어딘가 2", 4.0, "좋아요", null));
        // 친구가 내 후기에 댓글, 내가 답글(내 것은 알리지 않음), 친구가 내 답글... 이 아니라 내 댓글에 답글
        ReviewComment first = comments.save(new ReviewComment(mine, friend, null, "저도 가볼래요"));
        comments.save(new ReviewComment(mine, me, first.getId(), "꼭 가보세요"));
        ReviewComment myComment = comments.save(new ReviewComment(theirs, me, null, "여기 어때요?"));
        comments.save(new ReviewComment(theirs, friend, myComment.getId(), "추천해요"));
        // 내 후기 안에서 내 댓글에 달린 답글 — 댓글·답글 두 번이 아니라 답글로 한 번만
        ReviewComment mineOnMine = comments.save(new ReviewComment(mine, me, null, "사진 추가했어요"));
        comments.save(new ReviewComment(mine, friend, mineOnMine.getId(), "봤어요"));

        var notice = (NotificationController.Response) notifications.list(bearer(me)).getBody();
        var byText = notice.items().stream().collect(Collectors.toMap(NotificationController.Item::text, Function.identity()));
        assertEquals(Set.of("저도 가볼래요", "추천해요", "봤어요"), byText.keySet());
        assertEquals("COMMENT", byText.get("저도 가볼래요").type());
        assertEquals("모퉁이떡볶이", byText.get("저도 가볼래요").restaurantName());
        assertEquals(mine.getId(), byText.get("저도 가볼래요").reviewId());
        assertEquals("REPLY", byText.get("추천해요").type());
        assertEquals("솥밥집", byText.get("추천해요").restaurantName());
        assertEquals("REPLY", byText.get("봤어요").type());
        assertEquals(friend.getId(), byText.get("봤어요").actor().id());
    }
}
