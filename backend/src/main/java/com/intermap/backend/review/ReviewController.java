package com.intermap.backend.review;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
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

    public record Place(String name, String category, String address) {
    }

    public record Author(Long id, String name, boolean owner) {
    }

    public record CreateRequest(Place restaurant, double rating, String text) {
    }

    public record Item(Long id, Place restaurant, Author author, double rating, String text, Instant createdAt,
                       List<Long> photoIds) {
        static Item from(Review r, List<Long> photoIds) {
            AppUser a = r.getAuthor();
            return new Item(r.getId(),
                    new Place(r.getRestaurantName(), r.getRestaurantCategory(), r.getRestaurantAddress()),
                    new Author(a.getId(), a.getNickname(), AdminSeeder.ADMIN_EMAIL.equals(a.getEmail())),
                    r.getRating(), r.getText(), r.getCreatedAt(), photoIds);
        }
    }

    static final int MAX_PHOTOS = 10;
    static final long MAX_PHOTO_BYTES = 5L * 1024 * 1024;
    private static final Set<String> PHOTO_TYPES = Set.of("image/jpeg", "image/png", "image/webp");

    private final ReviewRepository repository;
    private final ReviewPhotoRepository photos;
    private final AuthController auth;

    public ReviewController(ReviewRepository repository, ReviewPhotoRepository photos, AuthController auth) {
        this.repository = repository;
        this.photos = photos;
        this.auth = auth;
    }

    // 초기 규모에서는 전부 내려준다 — 프론트가 가게별/작성자별로 나눈다.
    // ponytail: 후기가 수천 건 넘으면 bbox·기간 파라미터로 잘라 받도록 바꿀 것
    @GetMapping("/api/reviews")
    public List<Item> list() {
        Map<Long, List<Long>> photoIds = new HashMap<>();
        for (ReviewPhotoRepository.Ref ref : photos.findAllRefs()) {
            photoIds.computeIfAbsent(ref.getReviewId(), k -> new ArrayList<>()).add(ref.getId());
        }
        return repository.findAllByOrderByCreatedAtDesc().stream()
                .map(r -> Item.from(r, photoIds.getOrDefault(r.getId(), List.of())))
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
        if (name.isEmpty() || address.isEmpty() || text.isEmpty() || text.length() > 2000
                || request.rating() < 0.1 || request.rating() > 5) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("후기 내용과 별점을 확인해주세요."));
        }
        List<MultipartFile> uploads = files == null ? List.of() : files.stream().filter(f -> !f.isEmpty()).toList();
        if (uploads.size() > MAX_PHOTOS) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("사진은 " + MAX_PHOTOS + "장까지 올릴 수 있어요."));
        }
        for (MultipartFile f : uploads) {
            if (f.getSize() > MAX_PHOTO_BYTES || f.getContentType() == null || !PHOTO_TYPES.contains(f.getContentType())) {
                return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("사진은 JPEG/PNG/WebP, 한 장 5MB 이하로 올려주세요."));
            }
        }
        Review saved = repository.save(new Review(user, name, p.category() == null ? "" : p.category().trim(), address,
                request.rating(), text));
        List<Long> photoIds = new ArrayList<>();
        for (MultipartFile f : uploads) {
            photoIds.add(photos.save(new ReviewPhoto(saved, f.getContentType(), f.getBytes())).getId());
        }
        return ResponseEntity.ok(Item.from(saved, photoIds));
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
