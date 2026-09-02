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
import java.util.Set;

// 프로필 사진. 올리기/지우기는 본인만, 보기는 누구나 (후기·팔로우 목록에서 그린다).
@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class AvatarController {

    static final long MAX_BYTES = 2L * 1024 * 1024;
    private static final Set<String> TYPES = Set.of("image/jpeg", "image/png", "image/webp");

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
        if (file.isEmpty() || file.getContentType() == null || !TYPES.contains(file.getContentType())) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("JPG, PNG, WEBP 사진만 올릴 수 있어요."));
        }
        if (file.getSize() > MAX_BYTES) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("사진은 2MB 이하로 올려주세요."));
        }
        UserAvatar saved = avatars.save(new UserAvatar(me.getId(), file.getContentType(), file.getBytes()));
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
                        .cacheControl(CacheControl.maxAge(Duration.ofDays(365)).cachePublic().immutable())
                        .body(a.getData()))
                .orElse(ResponseEntity.notFound().build());
    }
}
