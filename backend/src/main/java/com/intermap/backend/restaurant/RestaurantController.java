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
// https://intermap.app:8443 은 모바일 앱(Capacitor WebView)의 origin, *.vercel.app 은 웹 배포본
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class RestaurantController {

    public record RegisterRequest(String name, String category, String roadAddress, String address, double lat, double lng) {
    }

    // 목록 응답용 슬림 DTO — 지도에 안 쓰는 statusCheckedAt/localDataMgtNo를 뺀다
    public record ListItem(Long id, String name, String category, String roadAddress, String address,
                           double lat, double lng, Restaurant.Status status) {
        static ListItem from(Restaurant r) {
            return new ListItem(r.getId(), r.getName(), r.getCategory(), r.getRoadAddress(), r.getAddress(),
                    r.getLat(), r.getLng(), r.getStatus());
        }
    }

    // 낮은 줌 요약 셀: 개별 가게 대신 격자 셀당 대표좌표+건수만
    public record Cell(double lat, double lng, int count) {
    }

    // FE 군집 반경과 같은 픽셀 크기(cluster.ts CLUSTER_PIXEL_DISTANCE)
    private static final double CLUSTER_PIXEL_DISTANCE = 26;

    private final RestaurantRepository repository;

    public RestaurantController(RestaurantRepository repository) {
        this.repository = repository;
    }

    // q가 오면 이름 검색(상한 50건), bbox 4개가 다 오면 그 영역만. 둘 다 없으면 빈 목록 — 서울 전체(10만+ 행)를
    // 통째로 내려주지 않는다. 데이터는 주간 배치 동기화로만 바뀌므로 6시간 캐시.
    @GetMapping("/api/restaurants")
    public ResponseEntity<List<ListItem>> list(
            @RequestParam(required = false) Double minLat,
            @RequestParam(required = false) Double maxLat,
            @RequestParam(required = false) Double minLng,
            @RequestParam(required = false) Double maxLng,
            @RequestParam(required = false) String q) {
        boolean hasBox = minLat != null && maxLat != null && minLng != null && maxLng != null;
        List<Restaurant> rows = q != null && !q.isBlank()
                ? repository.findTop50ByNameContainingIgnoreCase(q.trim())
                : hasBox
                ? repository.findByLatBetweenAndLngBetween(minLat, maxLat, minLng, maxLng)
                : List.of();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofHours(6)).cachePublic())
                .body(rows.stream().map(ListItem::from).toList());
    }

    // 낮은 줌에서는 개별 가게(수천 행) 대신 격자 셀 요약(수십~수백 행)만 내려준다.
    // 셀 한 변 = FE 군집 반경 26px를 해당 줌의 경도(도) 단위로 환산한 값.
    // 위도도 같은 값을 쓴다 — 메르카토르라 위도 방향은 약간 큰 셀이 되지만 요약 용도로 충분.
    @GetMapping("/api/restaurants/summary")
    public ResponseEntity<List<Cell>> summary(
            @RequestParam double minLat,
            @RequestParam double maxLat,
            @RequestParam double minLng,
            @RequestParam double maxLng,
            @RequestParam int zoom) {
        double cellDeg = 360.0 * CLUSTER_PIXEL_DISTANCE / (256.0 * Math.pow(2, zoom));
        // DB group by — 낮은 줌에서 bbox가 서울 전체를 덮어도 행을 안 올린다
        List<Cell> body = repository.summarize(minLat, maxLat, minLng, maxLng, cellDeg).stream()
                .map(a -> new Cell(((Number) a[0]).doubleValue(), ((Number) a[1]).doubleValue(), ((Number) a[2]).intValue()))
                .toList();
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
