package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.AuthSession;
import com.intermap.backend.auth.Sessions;
import com.intermap.backend.auth.UserAvatarRepository;
import com.intermap.backend.moderation.Blocks;
import com.intermap.backend.moderation.Report;
import com.intermap.backend.moderation.ReportRepository;
import com.intermap.backend.review.ReviewAudience;
import com.intermap.backend.review.ReviewComment;
import com.intermap.backend.review.ReviewCommentRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

// 알림 목록. 따로 쌓아 두지 않고 이미 있는 기록(댓글·팔로우·팔로우 요청)에서 그때그때 모은다 —
// 댓글이 지워지거나 요청이 취소되면 알림도 같이 사라져 "눌렀더니 없는 글" 같은 일이 없다.
// 읽음은 마지막으로 목록을 연 때(AppUser.notificationsSeenAt) 하나로 가른다.
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "httpsapp://intermap.app:8443", "https://*.vercel.app"})
public class NotificationController {

    // 이보다 오래된 일은 알리지 않는다 (받은 팔로우 요청은 처리할 때까지 남는다)
    static final Duration WINDOW = Duration.ofDays(30);
    static final int MAX_ITEMS = 50;

    public record Actor(Long id, String nickname, String avatar) {
    }

    // type: COMMENT(내 후기에 댓글) · REPLY(내 댓글에 답글) · FOLLOW_REQUEST(팔로우 요청) · FOLLOW(새 팔로워) · FOLLOW_ACCEPTED(내 요청 수락)
    //       · NEW_DEVICE(처음 보는 기기에서 내 계정에 로그인 — actor는 나, text는 기기 이름)
    // 댓글·답글이면 reviewId·restaurantName·text(댓글 내용)가 채워진다
    public record Item(String type, Actor actor, Instant createdAt, Long reviewId, String restaurantName, String text) {
    }

    // unread = 마지막으로 연 뒤에 생긴 알림 수
    public record Response(List<Item> items, long unread) {
    }

    private final AuthController auth;
    private final AppUserRepository users;
    private final FollowRepository follows;
    private final FollowRequestRepository requests;
    private final ReviewCommentRepository comments;
    private final UserAvatarRepository avatars;
    private final Blocks blocks;
    private final ReportRepository reports;
    private final Sessions sessions;
    private final ReviewAudience audience;

    public NotificationController(AuthController auth, AppUserRepository users, FollowRepository follows,
                                  FollowRequestRepository requests, ReviewCommentRepository comments,
                                  UserAvatarRepository avatars, Blocks blocks, ReportRepository reports,
                                  Sessions sessions, ReviewAudience audience) {
        this.sessions = sessions;
        this.audience = audience;
        this.auth = auth;
        this.users = users;
        this.follows = follows;
        this.requests = requests;
        this.comments = comments;
        this.avatars = avatars;
        this.blocks = blocks;
        this.reports = reports;
    }

    private static ResponseEntity<?> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
    }

    @GetMapping("/api/me/notifications")
    @Transactional(readOnly = true)
    public ResponseEntity<?> list(@RequestHeader(value = "Authorization", required = false) String authorization) {
        Sessions.Current current = auth.current(authorization);
        if (current == null) return unauthorized();
        return ResponseEntity.ok(responseOf(current));
    }

    // 알림 목록을 열었다 — 지금까지의 알림은 읽은 것으로
    @PostMapping("/api/me/notifications/seen")
    @Transactional
    public ResponseEntity<?> seen(@RequestHeader(value = "Authorization", required = false) String authorization) {
        Sessions.Current current = auth.current(authorization);
        if (current == null) return unauthorized();
        AppUser me = current.user();
        me.markNotificationsSeen();
        users.save(me);
        return ResponseEntity.ok(responseOf(current));
    }

    private Response responseOf(Sessions.Current current) {
        AppUser me = current.user();
        Instant from = Instant.now().minus(WINDOW);
        Set<Long> hidden = blocks.hiddenFor(me);
        Set<Long> reported = Set.copyOf(reports.targetIdsReportedBy(me, Report.TargetType.COMMENT));
        Map<Long, String> avatarUrls = avatars.urlsByUserId();
        List<Item> items = new ArrayList<>();

        // 내 댓글에 달린 답글을 먼저 — 내 후기에 달린 답글이면 "댓글"로 한 번 더 알리지 않는다
        Set<Long> replyIds = new HashSet<>();
        // 댓글을 단 뒤 팔로우를 끊어 이제 볼 수 없게 된 후기의 답글은 알리지 않는다 (가게 이름·답글 내용이 새지 않게)
        Predicate<AppUser> visible = audience.visibleAuthors(me);
        for (ReviewComment c : comments.findRepliesToSince(me, from)) {
            replyIds.add(c.getId());
            if (!visible.test(c.getReview().getAuthor())) continue;
            if (hidden.contains(c.getAuthor().getId()) || reported.contains(c.getId())) continue;
            items.add(commentItem("REPLY", c, avatarUrls));
        }
        for (ReviewComment c : comments.findOnReviewsOfSince(me, from)) {
            if (replyIds.contains(c.getId())) continue;
            if (hidden.contains(c.getAuthor().getId()) || reported.contains(c.getId())) continue;
            items.add(commentItem("COMMENT", c, avatarUrls));
        }
        for (FollowRequest r : requests.findByTargetOrderByCreatedAtDesc(me)) {
            items.add(new Item("FOLLOW_REQUEST", actor(r.getRequester(), avatarUrls), r.getCreatedAt(), null, null, null));
        }
        // 내가 수락해서 생긴 팔로워는 다시 알리지 않는다
        for (Follow f : follows.findByFolloweeOrderByCreatedAtDesc(me)) {
            if (f.isViaRequest() || f.getCreatedAt().isBefore(from)) continue;
            items.add(new Item("FOLLOW", actor(f.getFollower(), avatarUrls), f.getCreatedAt(), null, null, null));
        }
        for (Follow f : follows.findByFollowerOrderByCreatedAtDesc(me)) {
            if (!f.isViaRequest() || f.getCreatedAt().isBefore(from)) continue;
            items.add(new Item("FOLLOW_ACCEPTED", actor(f.getFollowee(), avatarUrls), f.getCreatedAt(), null, null, null));
        }

        // 처음 보는 기기에서 로그인 — 그 기기 자신에게는 알리지 않는다.
        // actor를 나로 채우는 건 예전 앱 때문이다 (actor가 없으면 목록이 깨진다)
        Long thisDevice = current.session() == null ? null : current.session().getId();
        for (AuthSession s : sessions.newDevicesSince(me, from)) {
            if (s.getId().equals(thisDevice)) continue;
            items.add(new Item("NEW_DEVICE", actor(me, avatarUrls), s.getCreatedAt(), null, null, s.getDeviceLabel()));
        }

        items.sort(Comparator.comparing(Item::createdAt).reversed());
        Instant seenAt = me.getNotificationsSeenAt();
        long unread = items.stream().filter(i -> seenAt == null || i.createdAt().isAfter(seenAt)).count();
        return new Response(items.size() > MAX_ITEMS ? List.copyOf(items.subList(0, MAX_ITEMS)) : items, unread);
    }

    private static Item commentItem(String type, ReviewComment c, Map<Long, String> avatarUrls) {
        return new Item(type, actor(c.getAuthor(), avatarUrls), c.getCreatedAt(),
                c.getReview().getId(), c.getReview().getRestaurantName(), c.getText());
    }

    private static Actor actor(AppUser u, Map<Long, String> avatarUrls) {
        return new Actor(u.getId(), u.getNickname(), avatarUrls.get(u.getId()));
    }
}
