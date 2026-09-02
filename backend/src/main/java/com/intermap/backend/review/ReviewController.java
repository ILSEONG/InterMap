package com.intermap.backend.review;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.UserAvatarRepository;
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
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class ReviewController {

    // lat/lng는 조회 응답에만 실린다 — 후기 있는 가게를 줌과 무관하게 핀으로 찍기 위해. 작성 요청은 비워 보낸다.
    public record Place(String name, String category, String address, Double lat, Double lng) {
    }

    // avatar: 프로필 사진 URL(API 경로) 또는 null
    public record Author(Long id, String name, boolean owner, String avatar) {
    }

    public record CreateRequest(Place restaurant, double rating, String text) {
    }

    // keepPhotoIds에 없는 기존 사진은 지운다. 새 사진은 photos 파트로.
    public record UpdateRequest(double rating, String text, List<Long> keepPhotoIds) {
    }

    public record Item(Long id, Place restaurant, Author author, double rating, String text, Instant createdAt,
                       List<Long> photoIds) {
        static Item from(Review r, List<Long> photoIds, Restaurant place, String avatar) {
            AppUser a = r.getAuthor();
            return new Item(r.getId(),
                    new Place(r.getRestaurantName(), r.getRestaurantCategory(), r.getRestaurantAddress(),
                            place == null ? null : place.getLat(), place == null ? null : place.getLng()),
                    new Author(a.getId(), a.getNickname(), AdminSeeder.ADMIN_EMAIL.equals(a.getEmail()), avatar),
                    r.getRating(), r.getText(), r.getCreatedAt(), photoIds);
        }
    }

    static final int MAX_PHOTOS = 10;
    static final long MAX_PHOTO_BYTES = 5L * 1024 * 1024;
    private static final Set<String> PHOTO_TYPES = Set.of("image/jpeg", "image/png", "image/webp");

    private final ReviewRepository repository;
    private final ReviewPhotoRepository photos;
    private final RestaurantRepository restaurants;
    private final AuthController auth;
    private final UserAvatarRepository avatars;
    private final ReviewCommentRepository comments;

    public ReviewController(ReviewRepository repository, ReviewPhotoRepository photos, RestaurantRepository restaurants,
                            AuthController auth, UserAvatarRepository avatars, ReviewCommentRepository comments) {
        this.restaurants = restaurants;
        this.repository = repository;
        this.photos = photos;
        this.auth = auth;
        this.avatars = avatars;
        this.comments = comments;
    }

    // 후기의 가게 스냅샷(이름+주소)으로 가게 행을 찾는다. 프론트가 도로명 우선으로 주소를 넣으므로 그 순서로 본다.
    // ponytail: 후기마다 쿼리 1~2번. 후기가 수천 건 되면 Review에 restaurant_id FK를 붙일 것
    private Restaurant findPlace(String name, String address) {
        return restaurants.findByNameAndRoadAddress(name, address)
                .or(() -> restaurants.findByNameAndAddress(name, address))
                .orElse(null);
    }

    // 초기 규모에서는 전부 내려준다 — 프론트가 가게별/작성자별로 나눈다.
    // ponytail: 후기가 수천 건 넘으면 bbox·기간 파라미터로 잘라 받도록 바꿀 것
    @GetMapping("/api/reviews")
    public List<Item> list() {
        Map<Long, List<Long>> photoIds = new HashMap<>();
        Map<String, Restaurant> places = new HashMap<>();
        for (ReviewPhotoRepository.Ref ref : photos.findAllRefs()) {
            photoIds.computeIfAbsent(ref.getReviewId(), k -> new ArrayList<>()).add(ref.getId());
        }
        Map<Long, String> avatarUrls = avatars.urlsByUserId();
        return repository.findAllByOrderByCreatedAtDesc().stream()
                .map(r -> Item.from(r, photoIds.getOrDefault(r.getId(), List.of()),
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
        if (name.isEmpty() || address.isEmpty() || !validBody(request.rating(), text)) {
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
        Review saved = repository.save(new Review(user, name, p.category() == null ? "" : p.category().trim(), address,
                request.rating(), text));
        List<Long> photoIds = new ArrayList<>();
        for (MultipartFile f : uploads) {
            photoIds.add(photos.save(new ReviewPhoto(saved, f.getContentType(), f.getBytes())).getId());
        }
        return ResponseEntity.ok(Item.from(saved, photoIds, findPlace(saved.getRestaurantName(), saved.getRestaurantAddress()),
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
        if (!validBody(request.rating(), text)) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("후기 내용과 별점을 확인해주세요."));
        }
        // 이 후기 사진 중 남길 것만 추린다 — 남의 사진 id를 넣어도 무시된다
        Set<Long> keep = request.keepPhotoIds() == null ? Set.of() : Set.copyOf(request.keepPhotoIds());
        List<Long> kept = new ArrayList<>();
        List<Long> dropped = new ArrayList<>();
        for (ReviewPhotoRepository.Ref ref : photos.findRefsByReviewId(id)) {
            (keep.contains(ref.getId()) ? kept : dropped).add(ref.getId());
        }
        List<MultipartFile> uploads = nonEmpty(files);
        String photoError = checkPhotos(uploads, kept.size());
        if (photoError != null) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse(photoError));
        }
        review.edit(request.rating(), text);
        photos.deleteAllByIdInBatch(dropped);
        List<Long> photoIds = new ArrayList<>(kept);
        for (MultipartFile f : uploads) {
            photoIds.add(photos.save(new ReviewPhoto(review, f.getContentType(), f.getBytes())).getId());
        }
        return ResponseEntity.ok(Item.from(review, photoIds, findPlace(review.getRestaurantName(), review.getRestaurantAddress()),
                avatars.urlOf(review.getAuthor().getId())));
    }

    // 본인 후기 삭제. 사진 먼저 지운다 (FK).
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
        photos.deleteAllByIdInBatch(photos.findRefsByReviewId(id).stream().map(ReviewPhotoRepository.Ref::getId).toList());
        comments.deleteAllByReviewId(id);
        repository.delete(review);
        return ResponseEntity.noContent().build();
    }

    private static boolean validBody(double rating, String text) {
        return !text.isEmpty() && text.length() <= 2000 && rating >= 0.1 && rating <= 5;
    }

    private static List<MultipartFile> nonEmpty(List<MultipartFile> files) {
        return files == null ? List.of() : files.stream().filter(f -> !f.isEmpty()).toList();
    }

    // 문제 있으면 사용자에게 보여줄 메시지, 없으면 null. existing = 이미 붙어 있는 사진 수
    private static String checkPhotos(List<MultipartFile> uploads, int existing) {
        if (existing + uploads.size() > MAX_PHOTOS) return "사진은 " + MAX_PHOTOS + "장까지 올릴 수 있어요.";
        for (MultipartFile f : uploads) {
            if (f.getSize() > MAX_PHOTO_BYTES || f.getContentType() == null || !PHOTO_TYPES.contains(f.getContentType())) {
                return "사진은 JPEG/PNG/WebP, 한 장 5MB 이하로 올려주세요.";
            }
        }
        return null;
    }

    // 사진은 한 번 올라가면 안 바뀐다 — 1년 캐시
    @GetMapping("/api/photos/{id}")
    public ResponseEntity<byte[]> photo(@PathVariable Long id) {
        return photos.findById(id)
                .map(p -> ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(p.getContentType()))
                        .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
                        .body(p.getData()))
                .orElse(ResponseEntity.notFound().build());
    }
}
