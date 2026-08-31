package com.intermap.backend.review;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;

@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class OwnerReviewController {

    public record CreateRequest(String restaurantKey, double rating, String text) {
    }

    public record Item(Long id, String restaurantKey, double rating, String text, Instant createdAt) {
        static Item from(OwnerReview r) {
            return new Item(r.getId(), r.getRestaurantKey(), r.getRating(), r.getText(), r.getCreatedAt());
        }
    }

    private final OwnerReviewRepository repository;
    private final AuthController auth;

    public OwnerReviewController(OwnerReviewRepository repository, AuthController auth) {
        this.repository = repository;
        this.auth = auth;
    }

    // 주인장 후기는 한 사람이 쓰는 거라 양이 적다 — 앱 시작 시 전부 받아 가게별로 나눈다
    @GetMapping("/api/owner-reviews")
    public List<Item> list() {
        return repository.findAllByOrderByCreatedAtDesc().stream().map(Item::from).toList();
    }

    @PostMapping("/api/owner-reviews")
    public ResponseEntity<?> create(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @RequestBody CreateRequest request) {
        AppUser user = auth.currentUser(authorization);
        if (user == null || !AdminSeeder.ADMIN_EMAIL.equals(user.getEmail())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("주인장만 남길 수 있어요."));
        }
        String key = request.restaurantKey() == null ? "" : request.restaurantKey().trim();
        String text = request.text() == null ? "" : request.text().trim();
        if (key.isEmpty() || text.isEmpty() || text.length() > 2000 || request.rating() < 0.1 || request.rating() > 5) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("후기 내용과 별점을 확인해주세요."));
        }
        return ResponseEntity.ok(Item.from(repository.save(new OwnerReview(key, request.rating(), text))));
    }
}
