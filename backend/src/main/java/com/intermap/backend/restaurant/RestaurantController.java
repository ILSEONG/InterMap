package com.intermap.backend.restaurant;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.List;

@RestController
// https://intermap.app:8443 은 모바일 앱(Capacitor WebView)의 origin
@CrossOrigin(origins = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app"})
public class RestaurantController {

    public record RegisterRequest(String name, String category, String roadAddress, String address, double lat, double lng) {
    }

    private final RestaurantRepository repository;

    public RestaurantController(RestaurantRepository repository) {
        this.repository = repository;
    }

    // bbox 4개가 다 오면 그 영역만, 아니면 전체. 데이터는 주 2회 배치 동기화로만 바뀌므로
    // 6시간 캐시 — 동기화 후 최대 6시간 안에 전파되면 충분하다.
    @GetMapping("/api/restaurants")
    public ResponseEntity<List<Restaurant>> list(
            @RequestParam(required = false) Double minLat,
            @RequestParam(required = false) Double maxLat,
            @RequestParam(required = false) Double minLng,
            @RequestParam(required = false) Double maxLng) {
        boolean hasBox = minLat != null && maxLat != null && minLng != null && maxLng != null;
        List<Restaurant> body = hasBox
                ? repository.findByLatBetweenAndLngBetween(minLat, maxLat, minLng, maxLng)
                : repository.findAll();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofHours(6)).cachePublic())
                .body(body);
    }

    @PostMapping("/api/restaurants")
    public Restaurant register(@RequestBody RegisterRequest request) {
        // 같은 상호+도로명주소면 기존 레코드 반환 — 중복 등록 방지
        return repository.findByNameAndRoadAddress(request.name(), request.roadAddress())
            .orElseGet(() -> repository.save(new Restaurant(
                request.name(), request.category(), request.roadAddress(),
                request.address(), request.lat(), request.lng()
            )));
    }
}
