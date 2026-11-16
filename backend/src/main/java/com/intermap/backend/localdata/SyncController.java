package com.intermap.backend.localdata;

import com.intermap.backend.auth.Admins;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.restaurant.GeocodeBackfill;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

// 운영자(admin) 전용 수동 실행. 둘 다 가게 전체를 훑는 무거운 작업이라 로그인한 운영자만 부른다.
@RestController
// https://intermap.app:8443 은 모바일 앱(Capacitor WebView)의 origin, *.vercel.app 은 웹 배포본
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "httpsapp://intermap.app:8443", "https://*.vercel.app"})
public class SyncController {

    // 주간 최신화가 보는 범위와 같다
    private static final int MAX_DAYS_BACK = RestaurantRefresh.DAYS_BACK;

    private final RestaurantRefresh refresh;
    private final RestaurantImportService importService;
    private final AuthController auth;
    private final GeocodeBackfill geocode;
    private final Admins admins;

    public SyncController(RestaurantRefresh refresh, RestaurantImportService importService, AuthController auth,
                          GeocodeBackfill geocode, Admins admins) {
        this.admins = admins;
        this.refresh = refresh;
        this.importService = importService;
        this.auth = auth;
        this.geocode = geocode;
    }

    private boolean isAdmin(String authorization) {
        return admins.isAdmin(auth.currentUser(authorization));
    }

    private static ResponseEntity<?> forbidden() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("운영자만 실행할 수 있어요."));
    }

    /** 음식점 최신화를 지금 한 번 돌린다 (운영/테스트용) — 새 가게 추가, 폐업 가게 삭제 */
    @PostMapping("/api/admin/sync-status")
    public ResponseEntity<?> sync(@RequestHeader(value = "Authorization", required = false) String authorization,
                                  @RequestParam(defaultValue = "31") int daysBack) {
        if (!isAdmin(authorization)) return forbidden();
        if (daysBack < 1 || daysBack > MAX_DAYS_BACK) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("daysBack은 1~" + MAX_DAYS_BACK + "이에요."));
        }
        return ResponseEntity.ok(refresh.refresh(daysBack));
    }

    /** 지자체 영업중 음식점 전량 백필 (예: localCode=3130000 마포구) */
    @PostMapping("/api/admin/import-restaurants")
    public ResponseEntity<?> importRestaurants(@RequestHeader(value = "Authorization", required = false) String authorization,
                                               @RequestParam String localCode) {
        if (!isAdmin(authorization)) return forbidden();
        RestaurantImportService.Result result = importService.importOpenRestaurants(localCode);
        geocode.start(); // 새로 들어온 가게 좌표를 네이버 기준으로 고친다
        return ResponseEntity.ok(result);
    }
}
