package com.intermap.backend.recap;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.moderation.Blocks;
import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import com.intermap.backend.review.Review;
import com.intermap.backend.review.ReviewComment;
import com.intermap.backend.review.ReviewCommentRepository;
import com.intermap.backend.review.ReviewPhotoRepository;
import com.intermap.backend.review.ReviewRepository;
import com.intermap.backend.social.Follow;
import com.intermap.backend.social.FollowRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

// 월간 결산 — "11월의 나: 9곳, 최애는 라멘, 제일 많이 간 동네는 망원동".
// 다녀온 곳 = 그 달(KST)에 후기를 남긴 가게. 카드 문구·칭호는 프론트가 이 숫자로 만든다 (RecapSheet).
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class RecapController {

    public record Place(String name, String category, double rating) {
    }

    public record Stat(String name, int count) {
    }

    // 내 후기에 댓글을 가장 많이 단 사람
    public record Fan(Long id, String name, int count) {
    }

    // months: 후기가 있는 달 (최근 달부터) — 달을 넘겨 볼 때 쓴다
    public record Recap(String month, int places, int photos, Double avgRating, Stat topCategory, Stat topArea,
                        Place best, int commentsReceived, Fan topFan, int newFollowing, List<Place> list,
                        List<String> months) {
    }

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    // 장르로 치지 않는 분류 — LOCALDATA·네이버가 붙이는 뭉뚱그린 이름
    private static final Set<String> VAGUE_CATEGORIES = Set.of("음식점", "일반음식점", "기타", "기타 휴게음식점");
    // 법정동·읍·면 (망원동, 성수동1가, 을지로3가, 기장읍)
    private static final Pattern DONG = Pattern.compile("[가-힣][가-힣0-9]*(동|가|읍|면)");
    private static final Pattern GU = Pattern.compile("[가-힣]+(구|군)");
    private static final Pattern CITY = Pattern.compile("[가-힣]+시");

    private final AuthController auth;
    private final ReviewRepository reviews;
    private final ReviewPhotoRepository photos;
    private final ReviewCommentRepository comments;
    private final FollowRepository follows;
    private final RestaurantRepository restaurants;
    private final Blocks blocks;

    public RecapController(AuthController auth, ReviewRepository reviews, ReviewPhotoRepository photos,
                           ReviewCommentRepository comments, FollowRepository follows, RestaurantRepository restaurants,
                           Blocks blocks) {
        this.auth = auth;
        this.reviews = reviews;
        this.photos = photos;
        this.comments = comments;
        this.follows = follows;
        this.restaurants = restaurants;
        this.blocks = blocks;
    }

    // month = "2026-11". 없으면 이번 달 (KST)
    @GetMapping("/api/me/recap")
    public ResponseEntity<?> recap(@RequestHeader(value = "Authorization", required = false) String authorization,
                                   @RequestParam(value = "month", required = false) String month) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
        }
        YearMonth ym;
        try {
            ym = month == null || month.isBlank() ? YearMonth.now(KST) : YearMonth.parse(month);
        } catch (DateTimeParseException e) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("달을 다시 골라주세요."));
        }
        Instant from = ym.atDay(1).atStartOfDay(KST).toInstant();
        Instant to = ym.plusMonths(1).atDay(1).atStartOfDay(KST).toInstant();

        List<Review> all = reviews.findAllByAuthorOrderByCreatedAtAsc(me);
        Set<String> months = new LinkedHashSet<>();
        for (int i = all.size() - 1; i >= 0; i--) months.add(YearMonth.from(all.get(i).getCreatedAt().atZone(KST)).toString());
        List<Review> inMonth = all.stream()
                .filter(r -> !r.getCreatedAt().isBefore(from) && r.getCreatedAt().isBefore(to))
                .toList();

        Map<String, Integer> categoryCounts = new LinkedHashMap<>();
        Map<String, Integer> areaCounts = new LinkedHashMap<>();
        double ratingSum = 0;
        Review best = null;
        for (Review r : inMonth) {
            String category = categoryOf(r.getRestaurantCategory());
            if (category != null) categoryCounts.merge(category, 1, Integer::sum);
            String area = areaOf(jibunOf(r), r.getRestaurantAddress());
            if (area != null) areaCounts.merge(area, 1, Integer::sum);
            ratingSum += r.getRating();
            // 별점이 같으면 먼저 다녀온 곳
            if (best == null || r.getRating() > best.getRating()) best = r;
        }

        Set<Long> hidden = blocks.hiddenFor(me);
        Map<Long, Integer> fanCounts = new LinkedHashMap<>();
        Map<Long, String> fanNames = new HashMap<>();
        int received = 0;
        for (ReviewComment c : comments.findOnReviewsOf(me, from, to)) {
            Long id = c.getAuthor().getId();
            if (hidden.contains(id)) continue;
            received++;
            fanCounts.merge(id, 1, Integer::sum);
            fanNames.put(id, c.getAuthor().getNickname());
        }
        Fan fan = fanCounts.entrySet().stream()
                .max(Map.Entry.comparingByValue())
                .map(e -> new Fan(e.getKey(), fanNames.get(e.getKey()), e.getValue()))
                .orElse(null);

        int newFollowing = 0;
        for (Follow f : follows.findByFollowerOrderByCreatedAtDesc(me)) {
            if (!f.getCreatedAt().isBefore(from) && f.getCreatedAt().isBefore(to)) newFollowing++;
        }

        List<Long> ids = inMonth.stream().map(Review::getId).toList();
        int photoCount = ids.isEmpty() ? 0 : (int) photos.countByReviewIds(ids);
        Double avg = inMonth.isEmpty() ? null : Math.round(ratingSum / inMonth.size() * 10) / 10.0;
        List<Place> list = inMonth.stream()
                .map(r -> new Place(r.getRestaurantName(), categoryOf(r.getRestaurantCategory()), r.getRating()))
                .toList();
        return ResponseEntity.ok(new Recap(ym.toString(), inMonth.size(), photoCount, avg, top(categoryCounts),
                top(areaCounts), best == null ? null : new Place(best.getRestaurantName(), categoryOf(best.getRestaurantCategory()), best.getRating()),
                received, fan, newFollowing, list, List.copyOf(months)));
    }

    // 가장 많은 것 — 같으면 그 달에 먼저 나온 것 (LinkedHashMap 순서)
    private static Stat top(Map<String, Integer> counts) {
        return counts.entrySet().stream()
                .max(Comparator.comparingInt(Map.Entry<String, Integer>::getValue))
                .map(e -> new Stat(e.getKey(), e.getValue()))
                .orElse(null);
    }

    // 후기에는 도로명 주소가 먼저 들어간다 — 동 이름은 가게 행의 지번 주소에서 꺼낸다
    private String jibunOf(Review r) {
        return restaurants.findFirstByNameAndRoadAddress(r.getRestaurantName(), r.getRestaurantAddress())
                .or(() -> restaurants.findFirstByNameAndAddress(r.getRestaurantName(), r.getRestaurantAddress()))
                .map(Restaurant::getAddress)
                .orElse(null);
    }

    // "음식점>한식" → 한식, "일식>라멘,우동" → 라멘. 뭉뚱그린 분류는 null
    static String categoryOf(String raw) {
        if (raw == null) return null;
        String last = raw.substring(raw.lastIndexOf('>') + 1).split(",")[0].trim();
        return last.isEmpty() || VAGUE_CATEGORIES.contains(last) ? null : last;
    }

    // 동네 이름: 지번 주소의 법정동 → 도로명 주소 괄호 안 동 → 구·군 → 시 순으로 찾는다
    static String areaOf(String jibun, String road) {
        for (String address : new String[]{jibun, road}) {
            String found = firstToken(address, DONG);
            if (found != null) return found;
        }
        for (Pattern p : new Pattern[]{GU, CITY}) {
            for (String address : new String[]{jibun, road}) {
                String found = firstToken(address, p);
                if (found != null && !found.endsWith("특별시") && !found.endsWith("광역시") && !found.endsWith("자치시")) return found;
            }
        }
        return null;
    }

    // 맨 앞(시·도)은 건너뛰고 패턴에 통째로 맞는 첫 토큰. 괄호는 떼고 본다 ("포은로 2 (망원동)")
    private static String firstToken(String address, Pattern pattern) {
        if (address == null) return null;
        String[] tokens = address.replaceAll("[(),]", " ").trim().split("\\s+");
        for (int i = 1; i < tokens.length; i++) {
            if (pattern.matcher(tokens[i]).matches()) return tokens[i];
        }
        return null;
    }
}
