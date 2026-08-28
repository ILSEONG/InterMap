package com.intermap.backend.localdata;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
// https://intermap.app:8443 ? 紐⑤컮????Capacitor WebView)??origin
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class SyncController {

    private final StatusSyncService syncService;
    private final RestaurantImportService importService;

    public SyncController(StatusSyncService syncService, RestaurantImportService importService) {
        this.syncService = syncService;
        this.importService = importService;
    }

    /** ?섎룞 ?숆린???몃━嫄?(?댁쁺/?뚯뒪?몄슜) */
    @PostMapping("/api/admin/sync-status")
    public Map<String, Integer> sync(@RequestParam(defaultValue = "8") int daysBack) {
        return Map.of("updated", syncService.syncOnce(daysBack));
    }

    /** 吏?먯껜 ?곸뾽以??뚯떇???꾨웾 諛깊븘 (?? localCode=3130000 留덊룷援? */
    @PostMapping("/api/admin/import-restaurants")
    public RestaurantImportService.Result importRestaurants(@RequestParam String localCode) {
        return importService.importOpenRestaurants(localCode);
    }
}
