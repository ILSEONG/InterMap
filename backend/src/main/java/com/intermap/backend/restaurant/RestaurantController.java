package com.intermap.backend.restaurant;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
// https://localhost, capacitor://localhost 는 모바일 앱(Capacitor WebView)의 origin
@CrossOrigin(origins = {"http://localhost:5173", "http://localhost:5174", "https://localhost", "capacitor://localhost"})
public class RestaurantController {

    public record RegisterRequest(String name, String category, String roadAddress, String address, double lat, double lng) {
    }

    private final RestaurantRepository repository;

    public RestaurantController(RestaurantRepository repository) {
        this.repository = repository;
    }

    @GetMapping("/api/restaurants")
    public List<Restaurant> list() {
        return repository.findAll();
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
