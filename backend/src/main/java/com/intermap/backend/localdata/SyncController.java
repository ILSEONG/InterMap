package com.intermap.backend.localdata;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.restaurant.GeocodeBackfill;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

// 운영자(admin) 전용 수동 실행. 둘 다 가게 전체를 훑는 무거운 작업이라 로그인한 운영자만 부른다.
@RestController
// https://intermap.app:8443 은 모바일 앱(Capacitor WebView)의 origin, *.vercel.app 은 웹 배포본
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "httpsapp://intermap.app:8443", "https://*.vercel.app"})
public class SyncController {

    // 주간 동기화가 8일이라 한 달이면 밀린 것도 충분히 따라잡는다
    private static final int MAX_DAYS_BACK = 31;

    private final StatusSyncService syncService;
    private final RestaurantImportService importService;
    private final AuthController auth;
    private final GeocodeBackfill geocode;

    public SyncController(StatusSyncService syncService, RestaurantImportService importService, AuthController auth,
                          GeocodeBackfill geocode) {
        this.syncService = syncService;
        this.importService = importService;
        this.auth = auth;
        this.geocode = geocode;
    }

    private boolean isAdmin(String authorization) {
        AppUser me = auth.currentUser(authorization);
        return me != null && AdminSeeder.ADMIN_EMAIL.equals(me.getEmail());
    }

    private static ResponseEntity<?> forbidden() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("운영자만 실행할 수 있어요."));
    }

    /** 수동 동기화 트리거 (운영/테스트용) */
    @PostMapping("/api/admin/sync-status")
    public ResponseEntity<?> sync(@RequestHeader(value = "Authorization", required = false) String authorization,
                                  @RequestParam(defaultValue = "8") int daysBack) {
        if (!isAdmin(authorization)) return forbidden();
        if (daysBack < 1 || daysBack > MAX_DAYS_BACK) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("daysBack은 1~" + MAX_DAYS_BACK + "이에요."));
        }
        return ResponseEntity.ok(Map.of("updated", syncService.syncOnce(daysBack)));
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
