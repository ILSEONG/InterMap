package com.intermap.backend.poll;

import com.intermap.backend.account.AccountController;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

// "어디 갈래?" 투표 — 만들기·비회원/회원 투표·다시 고르기·마감·삭제·탈퇴·보관 기간
@SpringBootTest(properties = "admin.password=test-admin-password")
@Transactional
class PollTest {

    @Autowired PollController controller;
    @Autowired PollStore store;
    @Autowired PollRepository polls;
    @Autowired PollVoteRepository votes;
    @Autowired AccountController account;
    @Autowired AppUserRepository users;

    private static final String GUEST = "guest-key-0123456789abcdef";

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

    private static PollController.OptionRequest place(String name) {
        return new PollController.OptionRequest(name, "음식점>한식", "서울 마포구 망원로 " + name.length(), null);
    }

    private PollController.View create(AppUser creator, String... names) {
        var options = java.util.Arrays.stream(names).map(PollTest::place).toList();
        var res = controller.create(bearer(creator), new PollController.CreateRequest("토요일 저녁", 24, options));
        assertEquals(HttpStatus.OK, res.getStatusCode(), String.valueOf(res.getBody()));
        return (PollController.View) res.getBody();
    }

    private PollController.View vote(String authorization, String token, String guestKey, String name, Long... optionIds) {
        var res = controller.vote(authorization, token, new PollController.VoteRequest(guestKey, name, List.of(optionIds)));
        assertEquals(HttpStatus.OK, res.getStatusCode(), String.valueOf(res.getBody()));
        return (PollController.View) res.getBody();
    }

    @Test
    void createValidatesAndNeedsLogin() {
        AppUser me = user("me");
        assertEquals(HttpStatus.UNAUTHORIZED, controller.create(null,
                new PollController.CreateRequest(null, null, List.of(place("가"), place("나")))).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, controller.create(bearer(me),
                new PollController.CreateRequest(null, null, List.of(place("가")))).getStatusCode(), "후보는 2곳부터");
        assertEquals(HttpStatus.BAD_REQUEST, controller.create(bearer(me),
                new PollController.CreateRequest(null, null, List.of(place("가"), place("가")))).getStatusCode(), "같은 가게 두 번은 한 곳");
        assertEquals(HttpStatus.BAD_REQUEST, controller.create(bearer(me),
                new PollController.CreateRequest(null, 500, List.of(place("가"), place("나")))).getStatusCode());

        var res = controller.create(bearer(me), new PollController.CreateRequest("  ", null, List.of(place("가"), place("나"))));
        var view = (PollController.View) res.getBody();
        assertEquals(PollController.DEFAULT_TITLE, view.title(), "제목을 비우면 기본 제목");
        assertEquals(16, view.token().length());
        assertTrue(view.mine());
        assertFalse(view.closed());
        assertEquals(2, view.options().size());
    }

    @Test
    void guestsAndMembersVoteAndCanChangeTheirPick() {
        AppUser me = user("me");
        AppUser friend = user("friend");
        var poll = create(me, "국밥집", "라멘집", "파스타집");
        Long a = poll.options().get(0).id();
        Long b = poll.options().get(1).id();
        Long c = poll.options().get(2).id();

        // 비회원은 이름이 있어야 한다
        assertEquals(HttpStatus.BAD_REQUEST, controller.vote(null, poll.token(),
                new PollController.VoteRequest(GUEST, " ", List.of(a))).getStatusCode());
        assertEquals(HttpStatus.BAD_REQUEST, controller.vote(null, poll.token(),
                new PollController.VoteRequest("short", "지은", List.of(a))).getStatusCode(), "난수 형식이 아니면 거절");

        var afterGuest = vote(null, poll.token(), GUEST, "지은", a, b);
        assertEquals(List.of(a, b), afterGuest.myChoices());
        assertEquals("지은", afterGuest.myName());
        assertEquals(1, afterGuest.voterCount());

        vote(bearer(friend), poll.token(), null, null, b);
        // 같은 비회원이 다시 고르면 갈아 끼운다
        var changed = vote(null, poll.token(), GUEST, "지은", c);
        assertEquals(List.of(c), changed.myChoices());
        assertEquals(2, changed.voterCount());
        assertEquals(List.of(0, 1, 1), changed.options().stream().map(PollController.Option::votes).toList());
        assertEquals(List.of(friend.getNickname()), changed.options().get(1).voters(), "회원은 닉네임으로 보인다");

        // 다른 후보 id는 거절
        assertEquals(HttpStatus.BAD_REQUEST, controller.vote(null, poll.token(),
                new PollController.VoteRequest(GUEST, "지은", List.of(-1L))).getStatusCode());

        // 링크로 다시 열면 내 선택이 보인다
        var seen = (PollController.View) controller.get(null, poll.token(), GUEST).getBody();
        assertEquals(List.of(c), seen.myChoices());
        assertTrue(seen.winnerIds().isEmpty(), "마감 전에는 결정된 곳이 없다");
        assertFalse(seen.mine());
    }

    @Test
    void onlyCreatorClosesAndDeletesAndClosedPollRejectsVotes() {
        AppUser me = user("me");
        AppUser other = user("other");
        var poll = create(me, "국밥집", "라멘집");
        Long a = poll.options().get(0).id();
        Long b = poll.options().get(1).id();
        vote(null, poll.token(), GUEST, "지은", a);
        vote(bearer(other), poll.token(), null, null, a, b);

        assertEquals(HttpStatus.FORBIDDEN, controller.close(bearer(other), poll.token()).getStatusCode());
        var closed = (PollController.View) controller.close(bearer(me), poll.token()).getBody();
        assertTrue(closed.closed());
        assertEquals(List.of(a), closed.winnerIds());
        assertEquals(HttpStatus.CONFLICT, controller.vote(null, poll.token(),
                new PollController.VoteRequest(GUEST, "지은", List.of(b))).getStatusCode());

        // 마이페이지 목록: 만든 사람과 회원으로 참여한 사람 모두에게 보인다
        @SuppressWarnings("unchecked")
        var mine = (List<PollController.Summary>) controller.mine(bearer(me)).getBody();
        assertEquals(1, mine.size());
        assertEquals("국밥집", mine.get(0).leader());
        assertTrue(mine.get(0).mine());
        @SuppressWarnings("unchecked")
        var theirs = (List<PollController.Summary>) controller.mine(bearer(other)).getBody();
        assertEquals(1, theirs.size());
        assertFalse(theirs.get(0).mine());

        assertEquals(HttpStatus.FORBIDDEN, controller.delete(bearer(other), poll.token()).getStatusCode());
        assertEquals(HttpStatus.NO_CONTENT, controller.delete(bearer(me), poll.token()).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND, controller.get(null, poll.token(), null).getStatusCode());
    }

    @Test
    void accountDeletionRemovesPollsAndVotes() {
        AppUser creator = user("creator");
        AppUser voter = user("voter");
        var poll = create(creator, "국밥집", "라멘집");
        vote(bearer(voter), poll.token(), null, null, poll.options().get(0).id());

        assertEquals(HttpStatus.NO_CONTENT, account.deleteMe(bearer(voter)).getStatusCode());
        var view = (PollController.View) controller.get(null, poll.token(), null).getBody();
        assertEquals(0, view.voterCount(), "탈퇴한 사람의 선택은 지워진다");

        assertEquals(HttpStatus.NO_CONTENT, account.deleteMe(bearer(creator)).getStatusCode());
        assertTrue(polls.findByToken(poll.token()).isEmpty(), "탈퇴한 사람이 만든 투표는 통째로 지워진다");
    }

    @Test
    void purgeRemovesPollsPastRetention() {
        AppUser me = user("me");
        Poll old = polls.save(new Poll("old-" + UUID.randomUUID().toString().substring(0, 20), me, "지난 투표",
                Instant.now().minus(PollStore.RETENTION).minus(Duration.ofDays(1))));
        var fresh = create(me, "국밥집", "라멘집");
        store.purgeExpired();
        assertTrue(polls.findById(old.getId()).isEmpty());
        assertTrue(polls.findByToken(fresh.token()).isPresent());
    }
}
