package com.intermap.backend.review;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.AvatarController;
import com.intermap.backend.auth.DailyLimits;
import com.intermap.backend.auth.UserAvatarRepository;
import com.intermap.backend.moderation.Blocks;
import com.intermap.backend.moderation.Report;
import com.intermap.backend.moderation.ReportRepository;
import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;

@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class ReviewController {

    // lat/lng는 조회 응답에만 실린다 — 후기 있는 가게를 줌과 무관하게 핀으로 찍기 위해. 작성 요청은 비워 보낸다.
    public record Place(String name, String category, String address, Double lat, Double lng) {
    }

    // avatar: 프로필 사진 URL(API 경로) 또는 null
    public record Author(Long id, String name, boolean owner, String avatar) {
    }

    // menu = 추천 메뉴 (선택, 100자)
    public record CreateRequest(Place restaurant, double rating, String text, String menu) {
    }

    // keepPhotoIds에 없는 기존 사진은 지운다. 새 사진은 photos 파트로.
    public record UpdateRequest(double rating, String text, String menu, List<Long> keepPhotoIds) {
    }

    // 사진 하나의 id, 주소 키 (ReviewPhoto.accessKey), 가로/세로 비율 (모르면 null)
    record Photo(Long id, String key, Double ratio) {
        static Photo of(Long id, String key, Integer width, Integer height) {
            Double ratio = width == null || height == null || width <= 0 || height <= 0 ? null : Math.round(width * 1000.0 / height) / 1000.0;
            return new Photo(id, key, ratio);
        }

        static Photo of(ReviewPhotoRepository.Ref ref) {
            return of(ref.getId(), ref.getAccessKey(), ref.getWidth(), ref.getHeight());
        }
    }

    // photoUrls는 photoIds와 같은 순서의 사진 주소(API 경로, 키 포함). photoIds는 수정 때 남길 사진을 고르는 데 쓴다.
    // photoRatios도 같은 순서 — 사진이 받아지기 전에 칸을 잡을 가로/세로 비율 (모르면 null)
    public record Item(Long id, Place restaurant, Author author, double rating, String text, String menu,
                       Instant createdAt, List<Long> photoIds, List<String> photoUrls, List<Double> photoRatios) {
        static Item from(Review r, List<Photo> photos, Restaurant place, String avatar) {
            AppUser a = r.getAuthor();
            return new Item(r.getId(),
                    new Place(r.getRestaurantName(), r.getRestaurantCategory(), r.getRestaurantAddress(),
                            place == null ? null : place.getLat(), place == null ? null : place.getLng()),
                    new Author(a.getId(), a.getNickname(), AdminSeeder.ADMIN_EMAIL.equals(a.getEmail()), avatar),
                    r.getRating(), r.getText(), r.getMenu(), r.getCreatedAt(),
                    photos.stream().map(Photo::id).toList(),
                    photos.stream().map(p -> "/api/photos/" + p.id() + "/" + p.key()).toList(),
                    photos.stream().map(Photo::ratio).toList());
        }
    }

    static final int MAX_PHOTOS = 10;
    // 프론트가 1280px JPEG로 줄여 보내 보통 0.5MB 아래다. 사진은 DB에 들어가므로 작게 묶는다.
    static final long MAX_PHOTO_BYTES = 1024 * 1024;
    // 계정 하나가 하루에 올릴 수 있는 양 — 도배와 DB 저장 공간 채우기 방지
    static final int DAILY_REVIEWS = 20;
    static final int DAILY_PHOTOS = 30;

    private final ReviewRepository repository;
    private final ReviewPhotoRepository photos;
    private final RestaurantRepository restaurants;
    private final AuthController auth;
    private final UserAvatarRepository avatars;
    private final ReviewCleanup cleanup;
    private final Blocks blocks;
    private final ReportRepository reports;
    private final DailyLimits limits;
    private final ReviewAudience audience;

    public ReviewController(ReviewRepository repository, ReviewPhotoRepository photos, RestaurantRepository restaurants,
                            AuthController auth, UserAvatarRepository avatars, ReviewCleanup cleanup, Blocks blocks,
                            ReportRepository reports, DailyLimits limits, ReviewAudience audience) {
        this.limits = limits;
        this.audience = audience;
        this.restaurants = restaurants;
        this.repository = repository;
        this.photos = photos;
        this.auth = auth;
        this.avatars = avatars;
        this.cleanup = cleanup;
        this.blocks = blocks;
        this.reports = reports;
    }

    // 후기의 가게 스냅샷(이름+주소)으로 가게 행을 찾는다. 프론트가 도로명 우선으로 주소를 넣으므로 그 순서로 본다.
    // 폐업한 가게는 못 찾은 것으로 친다 — 좌표가 안 실려 지도에 핀이 생기지 않는다.
    // ponytail: 후기마다 쿼리 1~2번. 후기가 수천 건 되면 Review에 restaurant_id FK를 붙일 것
    private Restaurant findPlace(String name, String address) {
        return restaurants.findFirstByNameAndRoadAddress(name, address)
                .or(() -> restaurants.findFirstByNameAndAddress(name, address))
                .filter(r -> r.getStatus() != Restaurant.Status.CLOSED)
                .orElse(null);
    }

    // 볼 수 있는 후기(ReviewAudience: 로그아웃이면 주인장 것만, 로그인하면 나·팔로우한 사람·주인장)를 전부 내려준다
    // — 프론트가 가게별/작성자별로 나눈다. 로그인했으면 차단 관계인 사람의 후기와 내가 신고한 후기도 뺀다.
    // ponytail: 후기가 수천 건 넘으면 작성자 조건을 쿼리로 내리고 bbox·기간 파라미터로 잘라 받도록 바꿀 것
    @GetMapping("/api/reviews")
    public List<Item> list(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser viewer = auth.currentUser(authorization);
        Predicate<AppUser> visible = audience.visibleAuthors(viewer);
        Set<Long> hiddenAuthors = blocks.hiddenFor(viewer);
        Set<Long> reported = viewer == null ? Set.of()
                : Set.copyOf(reports.targetIdsReportedBy(viewer, Report.TargetType.REVIEW));
        Map<Long, List<Photo>> photosByReview = new HashMap<>();
        Map<String, Restaurant> places = new HashMap<>();
        for (ReviewPhotoRepository.Ref ref : photos.findAllRefs()) {
            photosByReview.computeIfAbsent(ref.getReviewId(), k -> new ArrayList<>()).add(Photo.of(ref));
        }
        Map<Long, String> avatarUrls = avatars.urlsByUserId();
        return repository.findAllByOrderByCreatedAtDesc().stream()
                .filter(r -> visible.test(r.getAuthor()))
                .filter(r -> !hiddenAuthors.contains(r.getAuthor().getId()) && !reported.contains(r.getId()))
                .map(r -> Item.from(r, photosByReview.getOrDefault(r.getId(), List.of()),
                        places.computeIfAbsent(r.getRestaurantName() + "|" + r.getRestaurantAddress(),
                                k -> findPlace(r.getRestaurantName(), r.getRestaurantAddress())),
                        avatarUrls.get(r.getAuthor().getId())))
                .toList();
    }

    // multipart: "review" 파트(JSON) + "photos" 파트(파일, 0~10장). 프론트가 1280px JPEG로 줄여서 보낸다.
    @PostMapping(value = "/api/reviews", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional
    public ResponseEntity<?> create(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @RequestPart("review") CreateRequest request,
                                    @RequestPart(value = "photos", required = false) List<MultipartFile> files)
            throws IOException {
        AppUser user = auth.currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("로그인 후 후기를 남길 수 있어요."));
        }
        Place p = request.restaurant();
        String name = p == null || p.name() == null ? "" : p.name().trim();
        String address = p == null || p.address() == null ? "" : p.address().trim();
        String text = request.text() == null ? "" : request.text().trim();
        String menu = cleanMenu(request.menu());
        if (name.isEmpty() || address.isEmpty() || !validBody(request.rating(), text) || !validMenu(menu)) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("후기 내용과 별점을 확인해주세요."));
        }
        // ponytail: 앱 레벨 검사. 운영 DB에 중복이 이미 있을 수 있어 unique 제약은 데이터 정리 후 붙일 것
        if (repository.existsByAuthorAndRestaurantNameAndRestaurantAddress(user, name, address)) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new AuthController.ErrorResponse("이 가게엔 이미 후기를 남겼어요. 기존 후기를 수정해주세요."));
        }
        List<MultipartFile> uploads = nonEmpty(files);
        String photoError = checkPhotos(uploads, 0);
        if (photoError != null) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse(photoError));
        }
        if (limits.exceeded("review:" + user.getId(), DAILY_REVIEWS) || overPhotoLimit(user, uploads.size())) {
            return tooMany();
        }
        Review saved = repository.save(new Review(user, name, p.category() == null ? "" : p.category().trim(), address,
                request.rating(), text, menu));
        List<Photo> savedPhotos = new ArrayList<>();
        for (MultipartFile f : uploads) {
            savedPhotos.add(savePhoto(saved, f));
        }
        return ResponseEntity.ok(Item.from(saved, savedPhotos, findPlace(saved.getRestaurantName(), saved.getRestaurantAddress()),
                avatars.urlOf(saved.getAuthor().getId())));
    }

    // 본인 후기만 고친다. 가게는 못 바꾼다 (별점·내용·사진만).
    @PutMapping(value = "/api/reviews/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional
    public ResponseEntity<?> update(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @PathVariable Long id,
                                    @RequestPart("review") UpdateRequest request,
                                    @RequestPart(value = "photos", required = false) List<MultipartFile> files)
            throws IOException {
        AppUser user = auth.currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
        }
        Review review = repository.findById(id).orElse(null);
        if (review == null || !review.getAuthor().getId().equals(user.getId())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("내가 쓴 후기만 고칠 수 있어요."));
        }
        String text = request.text() == null ? "" : request.text().trim();
        String menu = cleanMenu(request.menu());
        if (!validBody(request.rating(), text) || !validMenu(menu)) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("후기 내용과 별점을 확인해주세요."));
        }
        // 이 후기 사진 중 남길 것만 추린다 — 남의 사진 id를 넣어도 무시된다
        Set<Long> keep = request.keepPhotoIds() == null ? Set.of() : Set.copyOf(request.keepPhotoIds());
        List<Photo> kept = new ArrayList<>();
        List<Long> dropped = new ArrayList<>();
        for (ReviewPhotoRepository.Ref ref : photos.findRefsByReviewId(id)) {
            if (keep.contains(ref.getId())) kept.add(Photo.of(ref));
            else dropped.add(ref.getId());
        }
        List<MultipartFile> uploads = nonEmpty(files);
        String photoError = checkPhotos(uploads, kept.size());
        if (photoError != null) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse(photoError));
        }
        if (overPhotoLimit(user, uploads.size())) {
            return tooMany();
        }
        review.edit(request.rating(), text, menu);
        photos.deleteAllByIdInBatch(dropped);
        List<Photo> result = new ArrayList<>(kept);
        for (MultipartFile f : uploads) {
            result.add(savePhoto(review, f));
        }
        return ResponseEntity.ok(Item.from(review, result, findPlace(review.getRestaurantName(), review.getRestaurantAddress()),
                avatars.urlOf(review.getAuthor().getId())));
    }

    // 본인 후기 삭제. 사진·댓글도 같이 지운다 (ReviewCleanup).
    @DeleteMapping("/api/reviews/{id}")
    @Transactional
    public ResponseEntity<?> delete(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @PathVariable Long id) {
        AppUser user = auth.currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
        }
        Review review = repository.findById(id).orElse(null);
        if (review == null || !review.getAuthor().getId().equals(user.getId())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("내가 쓴 후기만 지울 수 있어요."));
        }
        cleanup.deleteReview(review, Report.Status.GONE);
        return ResponseEntity.noContent().build();
    }

    private static boolean validBody(double rating, String text) {
        return !text.isEmpty() && text.length() <= 2000 && rating >= 0.1 && rating <= 5;
    }

    // 추천 메뉴: 공백을 다듬고 비어 있으면 null
    private static String cleanMenu(String menu) {
        if (menu == null) return null;
        String trimmed = menu.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static boolean validMenu(String menu) {
        return menu == null || menu.length() <= 100;
    }

    private static List<MultipartFile> nonEmpty(List<MultipartFile> files) {
        return files == null ? List.of() : files.stream().filter(f -> !f.isEmpty()).toList();
    }

    // 문제 있으면 사용자에게 보여줄 메시지, 없으면 null. existing = 이미 붙어 있는 사진 수
    private static String checkPhotos(List<MultipartFile> uploads, int existing) throws IOException {
        if (existing + uploads.size() > MAX_PHOTOS) return "사진은 " + MAX_PHOTOS + "장까지 올릴 수 있어요.";
        for (MultipartFile f : uploads) {
            if (f.getSize() > MAX_PHOTO_BYTES || AvatarController.imageType(f.getBytes()) == null) {
                return "사진은 JPEG/PNG/WebP, 한 장 1MB 이하로 올려주세요.";
            }
        }
        return null;
    }

    // 형식은 파일 바이트로 판별한 값을 저장한다 (checkPhotos를 통과한 파일만 온다)
    private Photo savePhoto(Review review, MultipartFile f) throws IOException {
        byte[] data = f.getBytes();
        ReviewPhoto saved = photos.save(new ReviewPhoto(review, AvatarController.imageType(data), data));
        return Photo.of(saved.getId(), saved.getAccessKey(), saved.getWidth(), saved.getHeight());
    }

    private boolean overPhotoLimit(AppUser user, int count) {
        boolean over = false;
        for (int i = 0; i < count; i++) over |= limits.exceeded("photo:" + user.getId(), DAILY_PHOTOS);
        return over;
    }

    private static ResponseEntity<?> tooMany() {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .body(new AuthController.ErrorResponse("오늘은 더 올릴 수 없어요. 내일 다시 해주세요."));
    }

    // 사진은 한 번 올라가면 안 바뀐다 — 1년 캐시. 키가 맞아야 준다 (볼 수 있는 후기 응답에만 키가 실린다).
    @GetMapping("/api/photos/{id}/{key}")
    public ResponseEntity<byte[]> photo(@PathVariable Long id, @PathVariable String key) {
        return photos.findById(id)
                .filter(p -> p.getAccessKey() != null && MessageDigest.isEqual(
                        p.getAccessKey().getBytes(StandardCharsets.UTF_8), key.getBytes(StandardCharsets.UTF_8)))
                .map(p -> ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(p.getContentType()))
                        .header("X-Content-Type-Options", "nosniff")
                        .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
                        .body(p.getData()))
                .orElse(ResponseEntity.notFound().build());
    }
}
