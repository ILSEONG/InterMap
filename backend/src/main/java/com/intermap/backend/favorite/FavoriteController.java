package com.intermap.backend.favorite;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.DailyLimits;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "httpsapp://intermap.app:8443", "https://*.vercel.app"})
public class FavoriteController {

    public record Place(String name, String address) {
    }

    public record ToggleResult(boolean favored) {
    }

    // 하루 찜 추가 수 — 도배 방지 (해제는 세지 않는다)
    static final int DAILY_FAVORITES = 200;

    private final FavoriteRepository repository;
    private final AuthController auth;
    private final DailyLimits limits;

    public FavoriteController(FavoriteRepository repository, AuthController auth, DailyLimits limits) {
        this.repository = repository;
        this.auth = auth;
        this.limits = limits;
    }

    // 내 찜 목록 (최근 찜한 순)
    @GetMapping("/api/me/favorites")
    public ResponseEntity<?> list(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser user = auth.currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
        }
        List<Place> places = repository.findAllByUserOrderByCreatedAtDesc(user).stream()
                .map(f -> new Place(f.getRestaurantName(), f.getRestaurantAddress()))
                .toList();
        return ResponseEntity.ok(places);
    }

    // 찜 토글 — 있으면 해제, 없으면 추가. 결과 상태를 돌려준다.
    @PostMapping("/api/me/favorites/toggle")
    @Transactional
    public ResponseEntity<?> toggle(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @RequestBody Place request) {
        AppUser user = auth.currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("로그인 후 찜할 수 있어요."));
        }
        String name = request.name() == null ? "" : request.name().trim();
        String address = request.address() == null ? "" : request.address().trim();
        if (name.isEmpty() || address.isEmpty()) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("찜할 가게를 찾지 못했어요."));
        }
        return repository.findByUserAndRestaurantNameAndRestaurantAddress(user, name, address)
                .map(existing -> {
                    repository.delete(existing);
                    return ResponseEntity.ok((Object) new ToggleResult(false));
                })
                .orElseGet(() -> {
                    if (limits.exceeded("favorite:" + user.getId(), DAILY_FAVORITES)) {
                        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                                .body(new AuthController.ErrorResponse("오늘은 더 찜할 수 없어요. 내일 다시 해주세요."));
                    }
                    repository.save(new Favorite(user, name, address));
                    return ResponseEntity.ok((Object) new ToggleResult(true));
                });
    }
}
