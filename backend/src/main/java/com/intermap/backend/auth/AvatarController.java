package com.intermap.backend.auth;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.time.Duration;
import java.util.Arrays;

// 프로필 사진. 올리기/지우기는 본인만, 보기는 누구나 (후기·팔로우 목록에서 그린다).
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "httpsapp://intermap.app:8443", "https://*.vercel.app"})
public class AvatarController {

    // 프론트가 512px JPEG로 줄여 보내 보통 100KB 아래다
    static final long MAX_BYTES = 1024 * 1024;
    private static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1A, '\n'};

    // 파일 앞 바이트로 실제 형식을 본다 — 클라이언트가 보낸 Content-Type은 믿지 않는다 (후기 사진도 이걸 쓴다).
    // JPEG/PNG/WebP가 아니면 null
    public static String imageType(byte[] data) {
        if (data.length >= 3 && (data[0] & 0xFF) == 0xFF && (data[1] & 0xFF) == 0xD8 && (data[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (data.length >= 8 && Arrays.equals(Arrays.copyOf(data, 8), PNG)) return "image/png";
        if (data.length >= 12 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F'
                && data[8] == 'W' && data[9] == 'E' && data[10] == 'B' && data[11] == 'P') {
            return "image/webp";
        }
        return null;
    }

    public record AvatarResponse(String avatar) {
    }

    private final UserAvatarRepository avatars;
    private final AuthController auth;

    public AvatarController(UserAvatarRepository avatars, AuthController auth) {
        this.avatars = avatars;
        this.auth = auth;
    }

    private static ResponseEntity<?> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
    }

    // multipart "photo" 한 장. 있던 사진은 덮어쓴다. 응답의 avatar 는 새 URL (?v= 가 바뀐다)
    @PutMapping(value = "/api/me/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> upload(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @RequestPart("photo") MultipartFile file) throws IOException {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        if (file.getSize() > MAX_BYTES) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("사진은 1MB 이하로 올려주세요."));
        }
        byte[] data = file.getBytes();
        String type = imageType(data);
        if (type == null) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("JPG, PNG, WEBP 사진만 올릴 수 있어요."));
        }
        UserAvatar saved = avatars.save(new UserAvatar(me.getId(), type, data));
        return ResponseEntity.ok(new AvatarResponse(UserAvatarRepository.url(me.getId(), saved.getUpdatedAt())));
    }

    @DeleteMapping("/api/me/avatar")
    public ResponseEntity<?> delete(@RequestHeader(value = "Authorization", required = false) String authorization) {
        AppUser me = auth.currentUser(authorization);
        if (me == null) return unauthorized();
        avatars.deleteById(me.getId());
        return ResponseEntity.ok(new AvatarResponse(null));
    }

    // URL에 ?v= 갱신 시각이 붙으므로 1년 캐시해도 바뀐 사진은 새 URL로 받는다
    @GetMapping("/api/users/{id}/avatar")
    public ResponseEntity<byte[]> photo(@PathVariable Long id) {
        return avatars.findById(id)
                .map(a -> ResponseEntity.ok()
                        .contentType(MediaType.parseMediaType(a.getContentType()))
                        .header("X-Content-Type-Options", "nosniff")
                        .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
                        .body(a.getData()))
                .orElse(ResponseEntity.notFound().build());
    }
}
