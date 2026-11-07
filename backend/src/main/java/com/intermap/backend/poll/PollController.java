package com.intermap.backend.poll;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.DailyLimits;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

// "어디 갈래?" 투표. 만들기·마감·삭제는 회원(만든 사람)만, 보기·고르기는 링크만 있으면 누구나.
// 비회원은 브라우저가 만든 난수(voterKey)로 "같은 사람"을 알아본다 — 서버엔 그 해시만 남긴다.
// 결과에는 고른 사람 이름이 보인다 (친구끼리 정하는 용도라 누가 어디를 골랐는지가 곧 정보다).
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class PollController {

    public record OptionRequest(String name, String category, String address, String note) {
    }

    // hours: 마감까지 남길 시간 (1~168, 없으면 24)
    public record CreateRequest(String title, Integer hours, List<OptionRequest> options) {
    }

    // voterKey/name은 비회원만 쓴다 (로그인했으면 계정과 닉네임으로 고른다). optionIds가 비면 내 선택을 지운다.
    public record VoteRequest(String voterKey, String name, List<Long> optionIds) {
    }

    public record Creator(Long id, String name) {
    }

    // voters: 이 후보를 고른 사람 이름 (먼저 고른 순)
    public record Option(Long id, String name, String category, String address, String note, int votes, List<String> voters) {
    }

    // mine: 내가 만든 투표 / myChoices·myName: 내가 이미 골랐으면 그 선택과 그때 쓴 이름
    // winnerIds: 마감된 뒤 가장 많이 골린 후보들 (동점이면 여럿, 아무도 안 골랐으면 빈 목록)
    public record View(String token, String title, Creator creator, Instant createdAt, Instant closesAt, boolean closed,
                       boolean mine, List<Option> options, List<Long> myChoices, String myName, int voterCount,
                       List<Long> winnerIds) {
    }

    // 마이페이지 "투표" 목록 한 줄. leader: 지금(또는 마감 때) 가장 많이 골린 가게 이름, 아무도 안 골랐으면 null
    public record Summary(String token, String title, Instant createdAt, Instant closesAt, boolean closed, boolean mine,
                          int voterCount, String leader) {
    }

    static final int MIN_OPTIONS = 2;
    static final int MAX_OPTIONS = 6;
    static final int MAX_VOTERS = 50;
    static final int DAILY_POLLS = 20;
    static final int DAILY_VOTES = 200;
    static final int DEFAULT_HOURS = 24;
    static final int MAX_HOURS = 168;
    static final String DEFAULT_TITLE = "어디 갈래?";
    // 브라우저가 만든 난수 — 영문·숫자·-_ 16~64자
    private static final Pattern GUEST_KEY = Pattern.compile("[A-Za-z0-9_-]{16,64}");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final PollRepository polls;
    private final PollOptionRepository options;
    private final PollVoteRepository votes;
    private final PollStore store;
    private final AuthController auth;
    private final DailyLimits limits;

    public PollController(PollRepository polls, PollOptionRepository options, PollVoteRepository votes, PollStore store,
                          AuthController auth, DailyLimits limits) {
        this.polls = polls;
        this.options = options;
        this.votes = votes;
        this.store = store;
        this.auth = auth;
        this.limits = limits;
    }

    @PostMapping("/api/polls")
    @Transactional
    public ResponseEntity<?> create(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @RequestBody CreateRequest request) {
        AppUser user = auth.currentUser(authorization);
        if (user == null) return error(HttpStatus.UNAUTHORIZED, "로그인 후 투표를 만들 수 있어요.");

        String title = trim(request.title());
        if (title.isEmpty()) title = DEFAULT_TITLE;
        if (title.length() > 40) return error(HttpStatus.BAD_REQUEST, "제목은 40자까지 쓸 수 있어요.");
        int hours = request.hours() == null ? DEFAULT_HOURS : request.hours();
        if (hours < 1 || hours > MAX_HOURS) return error(HttpStatus.BAD_REQUEST, "마감 시간을 다시 골라주세요.");

        // 같은 가게(이름+주소)를 두 번 담았으면 하나만
        Map<String, OptionRequest> unique = new LinkedHashMap<>();
        for (OptionRequest o : request.options() == null ? List.<OptionRequest>of() : request.options()) {
            if (o == null) continue;
            String name = trim(o.name());
            String address = trim(o.address());
            String note = trim(o.note());
            if (name.isEmpty() || address.isEmpty() || name.length() > 100 || address.length() > 200) {
                return error(HttpStatus.BAD_REQUEST, "후보 가게 정보를 확인해주세요.");
            }
            if (note.length() > 60) return error(HttpStatus.BAD_REQUEST, "한마디는 60자까지 쓸 수 있어요.");
            unique.putIfAbsent(name + "|" + address, new OptionRequest(name, cut(trim(o.category()), 100), address, note));
        }
        if (unique.size() < MIN_OPTIONS || unique.size() > MAX_OPTIONS) {
            return error(HttpStatus.BAD_REQUEST, "후보는 " + MIN_OPTIONS + "~" + MAX_OPTIONS + "곳을 골라주세요.");
        }
        if (limits.exceeded("poll:" + user.getId(), DAILY_POLLS)) {
            return error(HttpStatus.TOO_MANY_REQUESTS, "오늘은 더 만들 수 없어요. 내일 다시 해주세요.");
        }

        Poll poll = polls.save(new Poll(newToken(), user, title, Instant.now().plus(Duration.ofHours(hours))));
        int position = 0;
        for (OptionRequest o : unique.values()) {
            options.save(new PollOption(poll, position++, o.name(), o.category(), o.address(), o.note().isEmpty() ? null : o.note()));
        }
        return ResponseEntity.ok(view(poll, "u:" + user.getId(), user.getId()));
    }

    // 링크로 들어온 누구나. voter = 비회원 브라우저 난수 (내가 이미 골랐는지 표시용)
    @GetMapping("/api/polls/{token}")
    public ResponseEntity<?> get(@RequestHeader(value = "Authorization", required = false) String authorization,
                                 @PathVariable String token,
                                 @RequestParam(value = "voter", required = false) String guestKey) {
        Poll poll = polls.findByToken(token).orElse(null);
        if (poll == null) return notFound();
        AppUser user = auth.currentUser(authorization);
        return ResponseEntity.ok(view(poll, voterKeyOf(user, guestKey), user == null ? null : user.getId()));
    }

    @PostMapping("/api/polls/{token}/votes")
    @Transactional
    public ResponseEntity<?> vote(@RequestHeader(value = "Authorization", required = false) String authorization,
                                  @PathVariable String token,
                                  @RequestBody VoteRequest request) {
        Poll poll = polls.findByToken(token).orElse(null);
        if (poll == null) return notFound();
        if (poll.isClosed(Instant.now())) return error(HttpStatus.CONFLICT, "이미 마감된 투표예요.");

        AppUser user = auth.currentUser(authorization);
        String key = voterKeyOf(user, request.voterKey());
        if (key == null) return error(HttpStatus.BAD_REQUEST, "다시 열어서 투표해주세요.");
        String name;
        if (user != null) {
            name = user.getNickname();
        } else {
            name = trim(request.name());
            if (name.isEmpty()) return error(HttpStatus.BAD_REQUEST, "친구들이 알아볼 이름을 적어주세요.");
            if (name.length() > 12) return error(HttpStatus.BAD_REQUEST, "이름은 12자까지 쓸 수 있어요.");
        }

        Set<Long> valid = new HashSet<>();
        for (PollOption o : options.findAllByPollOrderByPositionAsc(poll)) valid.add(o.getId());
        Set<Long> picked = new LinkedHashSet<>(request.optionIds() == null ? List.of() : request.optionIds());
        if (!valid.containsAll(picked)) return error(HttpStatus.BAD_REQUEST, "후보를 다시 골라주세요.");

        List<PollVote> current = votes.findAllByPoll(poll);
        Set<String> voters = new HashSet<>();
        for (PollVote v : current) voters.add(v.getVoterKey());
        if (!picked.isEmpty() && !voters.contains(key) && voters.size() >= MAX_VOTERS) {
            return error(HttpStatus.CONFLICT, "참여 인원(" + MAX_VOTERS + "명)이 다 찼어요.");
        }
        if (limits.exceeded("pollvote:" + key, DAILY_VOTES)) {
            return error(HttpStatus.TOO_MANY_REQUESTS, "잠시 후 다시 해주세요.");
        }

        votes.deleteAllByPollAndVoterKey(poll, key);
        Long userId = user == null ? null : user.getId();
        for (Long optionId : picked) votes.save(new PollVote(poll, optionId, key, name, userId));
        return ResponseEntity.ok(view(poll, key, userId));
    }

    @PostMapping("/api/polls/{token}/close")
    @Transactional
    public ResponseEntity<?> close(@RequestHeader(value = "Authorization", required = false) String authorization,
                                   @PathVariable String token) {
        AppUser user = auth.currentUser(authorization);
        Poll poll = polls.findByToken(token).orElse(null);
        if (poll == null) return notFound();
        if (user == null || !poll.getCreator().getId().equals(user.getId())) {
            return error(HttpStatus.FORBIDDEN, "투표를 만든 사람만 마감할 수 있어요.");
        }
        poll.close();
        return ResponseEntity.ok(view(poll, "u:" + user.getId(), user.getId()));
    }

    @DeleteMapping("/api/polls/{token}")
    @Transactional
    public ResponseEntity<?> delete(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @PathVariable String token) {
        AppUser user = auth.currentUser(authorization);
        Poll poll = polls.findByToken(token).orElse(null);
        if (poll == null) return notFound();
        if (user == null || !poll.getCreator().getId().equals(user.getId())) {
            return error(HttpStatus.FORBIDDEN, "투표를 만든 사람만 지울 수 있어요.");
        }
        store.delete(poll);
        return ResponseEntity.noContent().build();
    }

    // 내가 만든 투표 + 회원으로 참여한 투표. 진행 중인 것 먼저, 그 안에서 최근 것부터
    @GetMapping("/api/me/polls")
    public ResponseEntity<?> mine(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser user = auth.currentUser(authorization);
        if (user == null) return error(HttpStatus.UNAUTHORIZED, "다시 로그인해주세요.");
        Map<Long, Poll> byId = new LinkedHashMap<>();
        for (Poll p : polls.findTop30ByCreatorOrderByCreatedAtDesc(user)) byId.put(p.getId(), p);
        List<Long> voted = votes.pollIdsVotedBy(user.getId()).stream().filter(id -> !byId.containsKey(id)).toList();
        if (!voted.isEmpty()) for (Poll p : polls.findAllByIdIn(voted)) byId.put(p.getId(), p);
        if (byId.isEmpty()) return ResponseEntity.ok(List.of());

        Map<Long, List<PollOption>> optionsByPoll = new HashMap<>();
        for (PollOption o : options.findAllByPollIn(byId.values())) {
            optionsByPoll.computeIfAbsent(o.getPoll().getId(), k -> new ArrayList<>()).add(o);
        }
        Map<Long, List<PollVote>> votesByPoll = new HashMap<>();
        for (PollVote v : votes.findAllByPollIn(byId.values())) {
            votesByPoll.computeIfAbsent(v.getPoll().getId(), k -> new ArrayList<>()).add(v);
        }
        Instant now = Instant.now();
        List<Summary> list = byId.values().stream()
                .map(p -> {
                    List<PollVote> pv = votesByPoll.getOrDefault(p.getId(), List.of());
                    List<PollOption> po = new ArrayList<>(optionsByPoll.getOrDefault(p.getId(), List.of()));
                    po.sort(Comparator.comparingInt(PollOption::getPosition));
                    List<Long> top = topOptions(po, pv);
                    String leader = top.isEmpty() ? null : po.stream()
                            .filter(o -> o.getId().equals(top.get(0))).findFirst().map(PollOption::getRestaurantName).orElse(null);
                    return new Summary(p.getToken(), p.getTitle(), p.getCreatedAt(), p.getClosesAt(), p.isClosed(now),
                            p.getCreator().getId().equals(user.getId()),
                            (int) pv.stream().map(PollVote::getVoterKey).distinct().count(), leader);
                })
                .sorted(Comparator.comparing(Summary::closed).thenComparing(Summary::createdAt, Comparator.reverseOrder()))
                .limit(30)
                .toList();
        return ResponseEntity.ok(list);
    }

    private View view(Poll poll, String voterKey, Long viewerId) {
        List<PollOption> opts = options.findAllByPollOrderByPositionAsc(poll);
        List<PollVote> all = new ArrayList<>(votes.findAllByPoll(poll));
        all.sort(Comparator.comparing(PollVote::getCreatedAt).thenComparing(PollVote::getId));
        Map<Long, List<String>> votersByOption = new HashMap<>();
        Set<String> voterKeys = new HashSet<>();
        List<Long> myChoices = new ArrayList<>();
        String myName = null;
        for (PollVote v : all) {
            votersByOption.computeIfAbsent(v.getOptionId(), k -> new ArrayList<>()).add(v.getVoterName());
            voterKeys.add(v.getVoterKey());
            if (v.getVoterKey().equals(voterKey)) {
                myChoices.add(v.getOptionId());
                myName = v.getVoterName();
            }
        }
        List<Option> list = opts.stream()
                .map(o -> {
                    List<String> names = votersByOption.getOrDefault(o.getId(), List.of());
                    return new Option(o.getId(), o.getRestaurantName(), o.getRestaurantCategory(), o.getRestaurantAddress(),
                            o.getNote(), names.size(), names);
                })
                .toList();
        boolean closed = poll.isClosed(Instant.now());
        AppUser creator = poll.getCreator();
        return new View(poll.getToken(), poll.getTitle(), new Creator(creator.getId(), creator.getNickname()),
                poll.getCreatedAt(), poll.getClosesAt(), closed, creator.getId().equals(viewerId), list, myChoices, myName,
                voterKeys.size(), closed ? topOptions(opts, all) : List.of());
    }

    // 가장 많이 골린 후보 id들 (담은 순서대로). 아무도 안 골랐으면 빈 목록
    static List<Long> topOptions(List<PollOption> opts, List<PollVote> all) {
        Map<Long, Integer> counts = new HashMap<>();
        for (PollVote v : all) counts.merge(v.getOptionId(), 1, Integer::sum);
        int max = counts.values().stream().mapToInt(Integer::intValue).max().orElse(0);
        if (max == 0) return List.of();
        return opts.stream().map(PollOption::getId).filter(id -> counts.getOrDefault(id, 0) == max).toList();
    }

    private static String voterKeyOf(AppUser user, String guestKey) {
        if (user != null) return "u:" + user.getId();
        if (guestKey == null || !GUEST_KEY.matcher(guestKey).matches()) return null;
        return "g:" + sha256(guestKey);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    // 링크 주소에 들어가는 투표 id — 12바이트 난수(16자). 순번이 아니라 남의 투표를 짐작해 열 수 없다
    private static String newToken() {
        byte[] bytes = new byte[12];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private static String cut(String value, int max) {
        return value.length() > max ? value.substring(0, max) : value;
    }

    private static ResponseEntity<?> notFound() {
        return error(HttpStatus.NOT_FOUND, "투표를 찾을 수 없어요. 지워졌거나 보관 기간이 지났어요.");
    }

    private static ResponseEntity<?> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(new AuthController.ErrorResponse(message));
    }
}
