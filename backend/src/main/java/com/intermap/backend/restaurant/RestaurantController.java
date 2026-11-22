package com.intermap.backend.restaurant;

import com.intermap.backend.auth.Admins;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.Arrays;
import java.util.List;

@RestController
// https://intermap.app:8443 은 모바일 앱(Capacitor WebView)의 origin, *.vercel.app 은 웹 배포본
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "httpsapp://intermap.app:8443", "https://*.vercel.app"})
public class RestaurantController {

    // 목록 응답용 슬림 DTO — 지도에 안 쓰는 status/statusCheckedAt/localDataMgtNo를 뺀다 (목록엔 영업 중인 가게만 온다)
    // cuisine = 필터용 업종 코드 (Cuisine), 정해지지 않은 가게는 null
    public record ListItem(Long id, String name, String category, String roadAddress, String address,
                           double lat, double lng, String cuisine) {
        static ListItem from(Restaurant r) {
            return new ListItem(r.getId(), r.getName(), r.getCategory(), r.getRoadAddress(), r.getAddress(),
                    r.getLat(), r.getLng(), r.getCuisine());
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
    // 검색 결과 상한
    private static final int SEARCH_LIMIT = 50;

    private final RestaurantRepository repository;
    private final RestaurantSearch search;
    private final AuthController auth;
    private final Admins admins;

    public RestaurantController(RestaurantRepository repository, RestaurantSearch search, AuthController auth, Admins admins) {
        this.repository = repository;
        this.search = search;
        this.auth = auth;
        this.admins = admins;
    }

    // q가 오면 검색(상한 50건 — RestaurantSearch), bbox 4개가 다 오면 그 영역만.
    // 둘 다 없으면 빈 목록 — 서울 전체(10만+ 행)를
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
        List<ListItem> items;
        if (q != null && !q.isBlank()) {
            items = search.find(q, SEARCH_LIMIT).stream().map(ListItem::from).toList();
        } else if (hasBox) {
            // 번화가는 격자 한 칸에 가게가 3천 곳 가까이 된다 — 엔티티로 올리면 행마다 관리 대상이 되어 느리다. 필요한 열만 읽는다
            items = repository.findListRows(Restaurant.Status.OPEN, minLat, maxLat, minLng, maxLng).stream()
                    .map(r -> new ListItem((Long) r[0], (String) r[1], (String) r[2], (String) r[3], (String) r[4],
                            (Double) r[5], (Double) r[6], (String) r[7]))
                    .toList();
        } else {
            items = List.of();
        }
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(10)).cachePublic())
                .body(items);
    }

    // 좌표 보정 진행 상황 — 운영 관리자만. 가게 표를 세 번 훑는 무거운 조회(1~2초)라 아무나 부르게 두지 않는다
    @GetMapping("/api/restaurants/geocode-progress")
    public ResponseEntity<?> geocodeProgress(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
        }
        if (!admins.isAdmin(me)) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("운영자만 볼 수 있어요."));
        }
        // fixed = 도로명주소 API 좌표, notFound = 못 찾아 인허가 좌표, pending = 아직 안 봄,
        // recheck = 못 찾음으로 표시됐지만 다시 물을 행, naverLeft = 예전 네이버 좌표가 아직 남은 행 (0이어야 한다)
        return ResponseEntity.ok(java.util.Map.of(
                "fixed", repository.countByStatusAndCoordSource(Restaurant.Status.OPEN, "JUSO"),
                "notFound", repository.countByStatusAndCoordSource(Restaurant.Status.OPEN, "LICENSE"),
                "pending", repository.countByStatusAndCoordSourceIsNull(Restaurant.Status.OPEN),
                "recheck", repository.countCoordRecheck(Restaurant.Status.OPEN),
                "naverLeft", repository.countHoldingNaverCoords()));
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
            @RequestParam int zoom,
            @RequestParam(required = false) String cuisine) {
        double cellDeg = 360.0 * CLUSTER_PIXEL_DISTANCE / (256.0 * Math.pow(2, zoom));
        if (zoom < 0 || zoom > 20 || (maxLat - minLat) / cellDeg * ((maxLng - minLng) / cellDeg) > MAX_CELLS) {
            return ResponseEntity.badRequest().build();
        }
        // DB group by — 낮은 줌에서 bbox가 서울 전체를 덮어도 행을 안 올린다. 폐업 가게는 건수에서 뺀다.
        // cuisine = 업종 코드를 쉼표로 이은 것 (업종 필터를 켰을 때). 모르는 코드는 버리고, 아는 게 하나도 없으면 빈 결과
        List<String> cuisines = cuisine == null || cuisine.isBlank() ? null
                : Arrays.stream(cuisine.split(",")).map(String::trim).filter(Cuisine::isCode).distinct().toList();
        List<Object[]> cells = cuisines == null
                ? repository.summarize(Restaurant.Status.OPEN, minLat, maxLat, minLng, maxLng, cellDeg)
                : cuisines.isEmpty() ? List.of()
                : repository.summarizeCuisines(Restaurant.Status.OPEN, cuisines, minLat, maxLat, minLng, maxLng, cellDeg);
        List<Cell> body = cells.stream()
                .map(a -> new Cell(((Number) a[0]).doubleValue(), ((Number) a[1]).doubleValue(), ((Number) a[2]).intValue()))
                .toList();
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(10)).cachePublic())
                .body(body);
    }
}
