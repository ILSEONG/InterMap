package com.intermap.backend.restaurant;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.List;

@RestController
// https://intermap.app:8443 은 모바일 앱(Capacitor WebView)의 origin, *.vercel.app 은 웹 배포본
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class RestaurantController {

    // 목록 응답용 슬림 DTO — 지도에 안 쓰는 status/statusCheckedAt/localDataMgtNo를 뺀다 (목록엔 영업 중인 가게만 온다)
    public record ListItem(Long id, String name, String category, String roadAddress, String address,
                           double lat, double lng) {
        static ListItem from(Restaurant r) {
            return new ListItem(r.getId(), r.getName(), r.getCategory(), r.getRoadAddress(), r.getAddress(),
                    r.getLat(), r.getLng());
        }
    }

    // 낮은 줌 요약 셀: 개별 가게 대신 격자 셀당 대표좌표+건수만
    public record Cell(double lat, double lng, int count) {
    }

    // FE 군집 반경과 같은 픽셀 크기(cluster.ts CLUSTER_PIXEL_DISTANCE)
    private static final double CLUSTER_PIXEL_DISTANCE = 26;
    // 개별 가게 bbox 한 변 상한(도). FE는 줌 17+에서만 개별 가게를 받고 0.02도 격자로 맞춰 보내 0.06도를 안 넘는다.
    // 서울 전체를 한 번에 요청해 10만 행을 메모리에 올리는 걸 막는다.
    private static final double MAX_BOX_DEG = 0.1;
    // 요약 격자 칸 수 상한. FE 화면 한 장은 많아야 수천 칸 — 높은 zoom에 넓은 bbox를 줘서 가게마다 한 칸씩 받는 걸 막는다.
    private static final double MAX_CELLS = 40_000;

    private final RestaurantRepository repository;

    public RestaurantController(RestaurantRepository repository) {
        this.repository = repository;
    }

    // q가 오면 이름 검색(상한 50건), bbox 4개가 다 오면 그 영역만. 둘 다 없으면 빈 목록 — 서울 전체(10만+ 행)를
    // 통째로 내려주지 않는다. 폐업 가게는 빼고 준다.
    // 좌표 보정이 뒤에서 도는 동안 고친 위치가 빨리 보이도록 캐시는 10분 (그 뒤엔 ETag로 304).
    @GetMapping("/api/restaurants")
    public ResponseEntity<List<ListItem>> list(
            @RequestParam(required = false) Double minLat,
            @RequestParam(required = false) Double maxLat,
            @RequestParam(required = false) Double minLng,
            @RequestParam(required = false) Double maxLng,
            @RequestParam(required = false) String q) {
        boolean hasBox = minLat != null && maxLat != null && minLng != null && maxLng != null;
        if (hasBox && (maxLat - minLat > MAX_BOX_DEG || maxLng - minLng > MAX_BOX_DEG)) {
            return ResponseEntity.badRequest().build();
        }
        List<Restaurant> rows = q != null && !q.isBlank()
                ? repository.findTop50ByStatusAndNameContainingIgnoreCase(Restaurant.Status.OPEN, q.trim())
                : hasBox
                ? repository.findByStatusAndLatBetweenAndLngBetween(Restaurant.Status.OPEN, minLat, maxLat, minLng, maxLng)
                : List.of();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(10)).cachePublic())
                .body(rows.stream().map(ListItem::from).toList());
    }

    // 좌표 보정 진행 상황 — 브라우저로 열어 확인 (건수만이라 공개해도 된다)
    @GetMapping("/api/restaurants/geocode-progress")
    public java.util.Map<String, Long> geocodeProgress() {
        return java.util.Map.of(
                "fixed", repository.countByStatusAndGeocoded(Restaurant.Status.OPEN, true),
                "notFound", repository.countByStatusAndGeocoded(Restaurant.Status.OPEN, false),
                "pending", repository.countByStatusAndGeocodedIsNull(Restaurant.Status.OPEN));
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
        if (zoom < 0 || zoom > 20 || (maxLat - minLat) / cellDeg * ((maxLng - minLng) / cellDeg) > MAX_CELLS) {
            return ResponseEntity.badRequest().build();
        }
        // DB group by — 낮은 줌에서 bbox가 서울 전체를 덮어도 행을 안 올린다. 폐업 가게는 건수에서 뺀다.
        List<Cell> body = repository.summarize(Restaurant.Status.OPEN, minLat, maxLat, minLng, maxLng, cellDeg).stream()
                .map(a -> new Cell(((Number) a[0]).doubleValue(), ((Number) a[1]).doubleValue(), ((Number) a[2]).intValue()))
                .toList();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(10)).cachePublic())
                .body(body);
    }
}
