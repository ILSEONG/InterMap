package com.intermap.backend.social;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.DailyLimits;
import com.intermap.backend.auth.UserAvatarRepository;
import com.intermap.backend.moderation.Blocks;
import com.intermap.backend.push.PushService;
import com.intermap.backend.review.ReviewRepository;
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
// 팔로우 승인 방식은 받는 사람이 정한다: 자동(기본)이면 누르는 즉시 맺어지고, 수동이면 요청(FollowRequest)으로 들어가 수락해야 맺어진다.
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "httpsapp://intermap.app:8443", "https://*.vercel.app"})
public class SocialController {

    static final int MAX_ALIAS_LENGTH = 20;

    // alias는 내가 붙인 이름(없으면 null). following/followsMe로 맞팔 여부를 그린다. avatar는 프로필 사진 URL(API 경로) 또는 null
    // requested = 보는 사람이 이 사람에게 보낸 팔로우 요청이 수락을 기다리는 중
    public record Person(Long id, String nickname, String alias, boolean following, boolean followsMe, String avatar,
                         boolean requested) {
    }

    // requests = 나에게 온 팔로우 요청, requested = 내가 보내고 기다리는 요청 (둘 다 내 목록에서만 채운다)
    // manualApproval = 내 팔로우 승인 방식 (true면 수동)
    public record SocialResponse(List<Person> following, List<Person> followers, List<Person> requests,
                                 List<Person> requested, boolean manualApproval) {
    }

    public record ApprovalRequest(boolean manual) {
    }

    public record AliasRequest(String alias) {
    }

    public record UserItem(Long id, String nickname) {
    }

    // 다른 사람 프로필 개요. 후기 내용은 팔로우한 사람 것만 /api/reviews 로 오므로
    // 여기선 프론트가 모르는 것(사진, 후기·팔로잉·팔로워 수, 관계)만 준다. blocked = 내가 이 사람을 차단했는지
    // reviewCount: 팔로우 전에도 보여준다 (주인장 후기는 가게 시트 전용이라 0)
    // requested = 내가 보낸 팔로우 요청이 수락 대기 중, manualApproval = 이 사람은 팔로우를 직접 수락한다
    public record Profile(Long id, String nickname, String alias, String avatar, boolean following, boolean followsMe,
                          long followingCount, long followerCount, boolean blocked, long reviewCount,
                          boolean requested, boolean manualApproval) {
    }

    // 하루 팔로우 수 — 모든 사용자를 한꺼번에 팔로우하는 도배 방지
    static final int DAILY_FOLLOWS = 100;

    private final FollowRepository follows;
    private final FollowRequestRepository requests;
    private final PushService push;
    private final UserAliasRepository aliases;
    private final AppUserRepository users;
    private final AuthController auth;
    private final UserAvatarRepository avatars;
    private final Blocks blocks;
    private final DailyLimits limits;
    private final ReviewRepository reviews;

    public SocialController(FollowRepository follows, UserAliasRepository aliases, AppUserRepository users, AuthController auth,
                            UserAvatarRepository avatars, Blocks blocks, DailyLimits limits, ReviewRepository reviews,
                            FollowRequestRepository requests, PushService push) {
        this.limits = limits;
        this.push = push;
        this.requests = requests;
        this.reviews = reviews;
        this.follows = follows;
        this.aliases = aliases;
        this.users = users;
        this.auth = auth;
        this.avatars = avatars;
        this.blocks = blocks;
    }

    private static ResponseEntity<?> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
    }

    private SocialResponse socialOf(AppUser me) {
        return socialOf(me, me);
    }

    // owner의 팔로잉·팔로워 목록. 각 사람의 별칭·관계(following/followsMe)는 보는 사람(viewer) 기준이다.
    private SocialResponse socialOf(AppUser owner, AppUser viewer) {
        Map<Long, String> aliasById = new HashMap<>();
        for (UserAlias a : aliases.findByOwner(viewer)) aliasById.put(a.getTarget().getId(), a.getAlias());
        List<Follow> out = follows.findByFollowerOrderByCreatedAtDesc(owner);
        List<Follow> in = follows.findByFolloweeOrderByCreatedAtDesc(owner);
        boolean self = owner.getId().equals(viewer.getId());
        Set<Long> followingIds = new HashSet<>();
        for (Follow f : self ? out : follows.findByFollowerOrderByCreatedAtDesc(viewer)) followingIds.add(f.getFollowee().getId());
        Set<Long> followerIds = new HashSet<>();
        for (Follow f : self ? in : follows.findByFolloweeOrderByCreatedAtDesc(viewer)) followerIds.add(f.getFollower().getId());
        Map<Long, String> avatarUrls = avatars.urlsByUserId();
        // 남의 목록을 볼 때 나와 차단 관계인 사람은 뺀다
        Set<Long> hidden = self ? Set.of() : blocks.hiddenFor(viewer);
        // 보는 사람이 보내고 기다리는 요청 — 목록 속 버튼을 "요청됨"으로 그린다
        List<FollowRequest> sent = requests.findByRequesterOrderByCreatedAtDesc(viewer);
        Set<Long> requestedIds = new HashSet<>();
        for (FollowRequest r : sent) requestedIds.add(r.getTarget().getId());
        Relations rel = new Relations(aliasById, followingIds, followerIds, requestedIds, avatarUrls);
        return new SocialResponse(
                out.stream().filter(f -> !hidden.contains(f.getFollowee().getId())).map(f -> rel.person(f.getFollowee())).toList(),
                in.stream().filter(f -> !hidden.contains(f.getFollower().getId())).map(f -> rel.person(f.getFollower())).toList(),
                // 받은·보낸 요청과 내 설정은 내 목록에서만 — 남의 것은 보여주지 않는다
                self ? requests.findByTargetOrderByCreatedAtDesc(owner).stream().map(r -> rel.person(r.getRequester())).toList() : List.of(),
                self ? sent.stream().map(r -> rel.person(r.getTarget())).toList() : List.of(),
                self && owner.isManualFollowApproval());
    }

    // 한 사람을 보는 사람 기준의 관계로 그린다
    private record Relations(Map<Long, String> aliasById, Set<Long> followingIds, Set<Long> followerIds,
                             Set<Long> requestedIds, Map<Long, String> avatarUrls) {
        Person person(AppUser u) {
            return new Person(u.getId(), u.getNickname(), aliasById.get(u.getId()),
                    followingIds.contains(u.getId()), followerIds.contains(u.getId()), avatarUrls.get(u.getId()),
                    requestedIds.contains(u.getId()));
        }
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
        if (blocks.between(me, target)) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse(blocks.blockedBy(me, target)
                    ? "차단한 사람이에요. 차단을 풀면 팔로우할 수 있어요." : "팔로우할 수 없는 사용자예요."));
        }
        // 이미 팔로우 중이거나 요청을 보내 둔 상태면 그대로 (여러 번 눌러도 한 번)
        if (follows.findByFollowerAndFollowee(me, target).isEmpty()
                && requests.findByRequesterAndTarget(me, target).isEmpty()) {
            if (limits.exceeded("follow:" + me.getId(), DAILY_FOLLOWS)) {
                return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                        .body(new AuthController.ErrorResponse("오늘은 더 팔로우할 수 없어요. 내일 다시 해주세요."));
            }
            // 수동 승인인 사람에게는 요청만 남긴다 — 수락 전에는 후기가 열리지 않는다
            if (target.isManualFollowApproval()) {
                requests.save(new FollowRequest(me, target));
                push.send(target, "인터맵", me.getNickname() + "님이 팔로우를 요청했어요", Map.of("type", "FOLLOW_REQUEST"));
            } else {
                follows.save(new Follow(me, target));
                push.send(target, "인터맵", me.getNickname() + "님이 나를 팔로우하기 시작했어요", Map.of("type", "FOLLOW"));
            }
        }
        return ResponseEntity.ok(socialOf(me));
    }

    @DeleteMapping("/api/me/follows/{userId}")
    @Transactional
    public ResponseEntity<?> unfollow(@RequestHeader(value = "Authorization", required = false) String authorization,
                                      @PathVariable Long userId) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        AppUser target = users.findById(userId).orElse(null);
        if (target != null) {
            follows.findByFollowerAndFollowee(me, target).ifPresent(follows::delete);
            // 아직 수락 전인 요청이면 요청을 거둔다
            requests.findByRequesterAndTarget(me, target).ifPresent(requests::delete);
        }
        return ResponseEntity.ok(socialOf(me));
    }

    // 나에게 온 팔로우 요청 수락 — 그 사람이 나를 팔로우하게 된다
    @PostMapping("/api/me/follow-requests/{userId}")
    @Transactional
    public ResponseEntity<?> acceptRequest(@RequestHeader(value = "Authorization", required = false) String authorization,
                                           @PathVariable Long userId) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        AppUser requester = users.findById(userId).orElse(null);
        FollowRequest request = requester == null ? null : requests.findByRequesterAndTarget(requester, me).orElse(null);
        if (request == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new AuthController.ErrorResponse("이미 처리했거나 취소된 요청이에요."));
        }
        accept(request);
        return ResponseEntity.ok(socialOf(me));
    }

    // 나에게 온 팔로우 요청 거절 — 상대에게 알리지 않고 요청만 지운다
    @DeleteMapping("/api/me/follow-requests/{userId}")
    @Transactional
    public ResponseEntity<?> rejectRequest(@RequestHeader(value = "Authorization", required = false) String authorization,
                                           @PathVariable Long userId) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        users.findById(userId).flatMap(r -> requests.findByRequesterAndTarget(r, me)).ifPresent(requests::delete);
        return ResponseEntity.ok(socialOf(me));
    }

    // 팔로우 승인 방식 바꾸기. 자동으로 돌리면 기다리던 요청은 전부 수락한다 (자동이었다면 바로 맺어졌을 팔로우들)
    @PutMapping("/api/me/follow-approval")
    @Transactional
    public ResponseEntity<?> setApproval(@RequestHeader(value = "Authorization", required = false) String authorization,
                                         @RequestBody ApprovalRequest request) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        me.setManualFollowApproval(request.manual());
        users.save(me);
        if (!request.manual()) {
            for (FollowRequest pending : requests.findByTargetOrderByCreatedAtDesc(me)) accept(pending);
        }
        return ResponseEntity.ok(socialOf(me));
    }

    private void accept(FollowRequest request) {
        AppUser requester = request.getRequester();
        AppUser target = request.getTarget();
        if (follows.findByFollowerAndFollowee(requester, target).isEmpty()) follows.save(new Follow(requester, target, true));
        requests.delete(request);
        push.send(requester, "인터맵", target.getNickname() + "님이 팔로우 요청을 수락했어요", Map.of("type", "FOLLOW_ACCEPTED"));
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

    // 프로필 개요. 로그인 필요. 팔로우하지 않은 사람이면 후기 내용은 서버가 안 보내고(ReviewAudience)
    // 여기서도 팔로잉·팔로워 수는 -1로 감춘다 (이름·사진·후기 수와 관계만 보인다).
    @GetMapping("/api/users/{userId}")
    public ResponseEntity<?> profile(@RequestHeader(value = "Authorization", required = false) String authorization,
                                     @PathVariable Long userId) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        AppUser target = users.findById(userId).orElse(null);
        // 나를 차단한 사람은 없는 사람처럼 보인다
        if (target == null || blocks.blockedBy(target, me)) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new AuthController.ErrorResponse("없는 사용자예요."));
        }
        boolean following = follows.findByFollowerAndFollowee(me, target).isPresent();
        boolean followsMe = follows.findByFollowerAndFollowee(target, me).isPresent();
        String alias = aliases.findByOwnerAndTarget(me, target).map(UserAlias::getAlias).orElse(null);
        return ResponseEntity.ok(new Profile(target.getId(), target.getNickname(), alias, avatars.urlOf(target.getId()),
                following, followsMe,
                following ? follows.countByFollower(target) : -1,
                following ? follows.countByFollowee(target) : -1,
                blocks.blockedBy(me, target),
                AdminSeeder.ADMIN_EMAIL.equals(target.getEmail()) ? 0 : reviews.countByAuthor(target),
                requests.findByRequesterAndTarget(me, target).isPresent(),
                target.isManualFollowApproval()));
    }

    // 다른 사람의 팔로잉·팔로워 목록. 프로필의 수와 같은 기준 — 내가 팔로우 중인 사람만 볼 수 있다.
    @GetMapping("/api/users/{userId}/social")
    public ResponseEntity<?> socialOfUser(@RequestHeader(value = "Authorization", required = false) String authorization,
                                          @PathVariable Long userId) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        AppUser target = users.findById(userId).orElse(null);
        if (target == null) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new AuthController.ErrorResponse("없는 사용자예요."));
        }
        if (!me.getId().equals(userId) && follows.findByFollowerAndFollowee(me, target).isEmpty()) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("팔로우하면 볼 수 있어요."));
        }
        return ResponseEntity.ok(socialOf(target, me));
    }

    // 팔로우할 사람 찾기 — 닉네임 부분 일치 상위 20, 본인 제외. 로그인 필요 (사용자 목록 열람 방지).
    @GetMapping("/api/users")
    public ResponseEntity<?> search(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @RequestParam String q) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        String keyword = q == null ? "" : q.trim();
        if (keyword.isEmpty()) return ResponseEntity.ok(List.of());
        Set<Long> hidden = blocks.hiddenFor(me);
        return ResponseEntity.ok(users.findTop20ByNicknameContainingIgnoreCase(keyword).stream()
                .filter(u -> !u.getId().equals(me.getId()) && !hidden.contains(u.getId()))
                .map(u -> new UserItem(u.getId(), u.getNickname()))
                .toList());
    }
}
