package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.UserAvatarRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

// 팔로우(단방향)와 나만 보이는 이름(별칭). 전부 로그인 필요.
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class SocialController {

    static final int MAX_ALIAS_LENGTH = 20;

    // alias는 내가 붙인 이름(없으면 null). following/followsMe로 맞팔 여부를 그린다. avatar는 프로필 사진 URL(API 경로) 또는 null
    public record Person(Long id, String nickname, String alias, boolean following, boolean followsMe, String avatar) {
    }

    public record SocialResponse(List<Person> following, List<Person> followers) {
    }

    public record AliasRequest(String alias) {
    }

    public record UserItem(Long id, String nickname) {
    }

    // 다른 사람 프로필 개요. 후기·별점은 프론트가 이미 /api/reviews 로 받아 두므로
    // 여기선 프론트가 모르는 것(사진, 팔로잉·팔로워 수, 관계)만 준다.
    public record Profile(Long id, String nickname, String alias, String avatar, boolean following, boolean followsMe,
                          long followingCount, long followerCount) {
    }

    private final FollowRepository follows;
    private final UserAliasRepository aliases;
    private final AppUserRepository users;
    private final AuthController auth;
    private final UserAvatarRepository avatars;

    public SocialController(FollowRepository follows, UserAliasRepository aliases, AppUserRepository users, AuthController auth,
                            UserAvatarRepository avatars) {
        this.follows = follows;
        this.aliases = aliases;
        this.users = users;
        this.auth = auth;
        this.avatars = avatars;
    }

    private static ResponseEntity<?> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
    }

    private SocialResponse socialOf(AppUser me) {
        Map<Long, String> aliasById = new HashMap<>();
        for (UserAlias a : aliases.findByOwner(me)) aliasById.put(a.getTarget().getId(), a.getAlias());
        List<Follow> out = follows.findByFollowerOrderByCreatedAtDesc(me);
        List<Follow> in = follows.findByFolloweeOrderByCreatedAtDesc(me);
        Set<Long> followingIds = new HashSet<>();
        for (Follow f : out) followingIds.add(f.getFollowee().getId());
        Set<Long> followerIds = new HashSet<>();
        for (Follow f : in) followerIds.add(f.getFollower().getId());
        Map<Long, String> avatarUrls = avatars.urlsByUserId();
        return new SocialResponse(
                out.stream().map(f -> person(f.getFollowee(), aliasById, followingIds, followerIds, avatarUrls)).toList(),
                in.stream().map(f -> person(f.getFollower(), aliasById, followingIds, followerIds, avatarUrls)).toList());
    }

    private static Person person(AppUser u, Map<Long, String> aliasById, Set<Long> followingIds, Set<Long> followerIds,
                                 Map<Long, String> avatarUrls) {
        return new Person(u.getId(), u.getNickname(), aliasById.get(u.getId()),
                followingIds.contains(u.getId()), followerIds.contains(u.getId()), avatarUrls.get(u.getId()));
    }

    @GetMapping("/api/me/social")
    public ResponseEntity<?> social(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        return ResponseEntity.ok(socialOf(me));
    }

    @PostMapping("/api/me/follows/{userId}")
    @Transactional
    public ResponseEntity<?> follow(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @PathVariable Long userId) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        if (me.getId().equals(userId)) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("나 자신은 팔로우할 수 없어요."));
        }
        AppUser target = users.findById(userId).orElse(null);
        if (target == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new AuthController.ErrorResponse("없는 사용자예요."));
        }
        if (follows.findByFollowerAndFollowee(me, target).isEmpty()) {
            follows.save(new Follow(me, target));
        }
        return ResponseEntity.ok(socialOf(me));
    }

    @DeleteMapping("/api/me/follows/{userId}")
    @Transactional
    public ResponseEntity<?> unfollow(@RequestHeader(value = "Authorization", required = false) String authorization,
                                      @PathVariable Long userId) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        users.findById(userId).flatMap(t -> follows.findByFollowerAndFollowee(me, t)).ifPresent(follows::delete);
        return ResponseEntity.ok(socialOf(me));
    }

    // 빈 문자열이면 별칭 삭제. 팔로잉/팔로워가 아닌 사람에겐 못 붙인다.
    @PutMapping("/api/me/aliases/{userId}")
    @Transactional
    public ResponseEntity<?> setAlias(@RequestHeader(value = "Authorization", required = false) String authorization,
                                      @PathVariable Long userId, @RequestBody AliasRequest request) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        AppUser target = users.findById(userId).orElse(null);
        if (target == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new AuthController.ErrorResponse("없는 사용자예요."));
        }
        boolean related = follows.findByFollowerAndFollowee(me, target).isPresent()
                || follows.findByFollowerAndFollowee(target, me).isPresent();
        if (!related) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("팔로우하거나 나를 팔로우한 사람에게만 이름을 붙일 수 있어요."));
        }
        String alias = request.alias() == null ? "" : request.alias().trim();
        if (alias.length() > MAX_ALIAS_LENGTH) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("이름은 " + MAX_ALIAS_LENGTH + "자까지예요."));
        }
        UserAlias existing = aliases.findByOwnerAndTarget(me, target).orElse(null);
        if (alias.isEmpty()) {
            if (existing != null) aliases.delete(existing);
        } else if (existing == null) {
            aliases.save(new UserAlias(me, target, alias));
        } else {
            existing.rename(alias);
        }
        return ResponseEntity.ok(socialOf(me));
    }

    // 프로필 개요. 로그인 필요. 팔로우하지 않은 사람이면 후기 내용은 프론트가 가리고
    // 여기서도 팔로잉·팔로워 수는 -1로 감춘다 (이름·사진과 관계만 보인다).
    @GetMapping("/api/users/{userId}")
    public ResponseEntity<?> profile(@RequestHeader(value = "Authorization", required = false) String authorization,
                                     @PathVariable Long userId) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        AppUser target = users.findById(userId).orElse(null);
        if (target == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new AuthController.ErrorResponse("없는 사용자예요."));
        }
        boolean following = follows.findByFollowerAndFollowee(me, target).isPresent();
        boolean followsMe = follows.findByFollowerAndFollowee(target, me).isPresent();
        String alias = aliases.findByOwnerAndTarget(me, target).map(UserAlias::getAlias).orElse(null);
        return ResponseEntity.ok(new Profile(target.getId(), target.getNickname(), alias, avatars.urlOf(target.getId()),
                following, followsMe,
                following ? follows.countByFollower(target) : -1,
                following ? follows.countByFollowee(target) : -1));
    }

    // 팔로우할 사람 찾기 — 닉네임 부분 일치 상위 20, 본인 제외. 로그인 필요 (사용자 목록 열람 방지).
    @GetMapping("/api/users")
    public ResponseEntity<?> search(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @RequestParam String q) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        String keyword = q == null ? "" : q.trim();
        if (keyword.isEmpty()) return ResponseEntity.ok(List.of());
        return ResponseEntity.ok(users.findTop20ByNicknameContainingIgnoreCase(keyword).stream()
                .filter(u -> !u.getId().equals(me.getId()))
                .map(u -> new UserItem(u.getId(), u.getNickname()))
                .toList());
    }
}
