package com.intermap.backend.localdata;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
// https://localhost, capacitor://localhost 는 모바일 앱(Capacitor WebView)의 origin
@CrossOrigin(origins = {"http://localhost:5173", "http://localhost:5174", "https://localhost", "capacitor://localhost"})
public class SyncController {

    private final StatusSyncService syncService;

    public SyncController(StatusSyncService syncService) {
        this.syncService = syncService;
    }

    /** 수동 동기화 트리거 (운영/테스트용) */
    @PostMapping("/api/admin/sync-status")
    public Map<String, Integer> sync(@RequestParam(defaultValue = "8") int daysBack) {
        return Map.of("updated", syncService.syncOnce(daysBack));
    }
}
