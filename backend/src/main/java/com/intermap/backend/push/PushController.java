package com.intermap.backend.push;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

// 푸시 알림을 받을 기기 등록·해제. 앱(안드로이드)이 로그인한 채 켜질 때마다 등록하고, 로그아웃할 때 해제한다.
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "capacitor://intermap.app:8443", "https://*.vercel.app"})
public class PushController {

    static final int MAX_TOKEN_LENGTH = 512;

    public record TokenRequest(String token, String platform) {
    }

    private final PushTokenRepository tokens;
    private final AuthController auth;

    public PushController(PushTokenRepository tokens, AuthController auth) {
        this.tokens = tokens;
        this.auth = auth;
    }

    private static boolean valid(String token) {
        return token != null && !token.isBlank() && token.length() <= MAX_TOKEN_LENGTH;
    }

    @PostMapping("/api/me/push-token")
    @Transactional
    public ResponseEntity<?> register(@RequestHeader(value = "Authorization", required = false) String authorization,
                                      @RequestBody TokenRequest request) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
        }
        if (!valid(request.token())) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("기기 토큰이 올바르지 않아요."));
        }
        String platform = request.platform() == null || request.platform().isBlank() ? "android" : request.platform().trim();
        PushToken existing = tokens.findByToken(request.token()).orElse(null);
        // 같은 폰에서 계정을 바꿔 로그인했으면 새 주인에게 옮긴다 — 이전 계정의 알림이 이 폰으로 오지 않게
        if (existing == null) tokens.save(new PushToken(me, request.token(), platform));
        else existing.assign(me, platform);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    // 로그아웃할 때 그 기기만 해제. 토큰 값 자체가 그 기기라는 증거라 로그인 여부를 묻지 않는다 —
    // 로그아웃 요청과 순서가 뒤바뀌어도(세션이 먼저 끊겨도) 토큰이 남아 남의 알림이 가는 일이 없게
    @DeleteMapping("/api/push-token")
    @Transactional
    public ResponseEntity<?> unregister(@RequestBody TokenRequest request) {
        if (valid(request.token())) tokens.deleteByTokenValue(request.token());
        return ResponseEntity.ok(Map.of("ok", true));
    }
}
