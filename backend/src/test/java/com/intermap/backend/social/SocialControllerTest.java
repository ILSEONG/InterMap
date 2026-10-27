package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
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
}
