package com.intermap.backend.auth;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;
import java.util.regex.Pattern;

@RestController
// https://intermap.app:8443 은 모바일 앱(Capacitor WebView)의 origin
@CrossOrigin(origins = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app"})
public class AuthController {

    public record SignupRequest(String email, String password, String nickname) {
    }

    public record LoginRequest(String email, String password) {
    }

    public record AuthResponse(String token, String email, String nickname) {
    }

    public record ErrorResponse(String message) {
    }

    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    private static final int MIN_PASSWORD_LENGTH = 8;

    private final AppUserRepository repository;
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

    public AuthController(AppUserRepository repository) {
        this.repository = repository;
    }

    @PostMapping("/api/auth/signup")
    public ResponseEntity<?> signup(@RequestBody SignupRequest request) {
        String email = request.email() == null ? "" : request.email().trim().toLowerCase();
        String nickname = request.nickname() == null ? "" : request.nickname().trim();
        if (!EMAIL.matcher(email).matches()) {
            return ResponseEntity.badRequest().body(new ErrorResponse("이메일 형식을 확인해주세요."));
        }
        if (request.password() == null || request.password().length() < MIN_PASSWORD_LENGTH) {
            return ResponseEntity.badRequest().body(new ErrorResponse("비밀번호는 " + MIN_PASSWORD_LENGTH + "자 이상이어야 해요."));
        }
        if (nickname.isEmpty() || nickname.length() > 20) {
            return ResponseEntity.badRequest().body(new ErrorResponse("닉네임은 1~20자로 해주세요."));
        }
        if (repository.findByEmail(email).isPresent()) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(new ErrorResponse("이미 가입된 이메일이에요."));
        }
        AppUser user = new AppUser(email, encoder.encode(request.password()), nickname);
        user.issueToken(UUID.randomUUID().toString());
        repository.save(user);
        return ResponseEntity.ok(new AuthResponse(user.getToken(), user.getEmail(), user.getNickname()));
    }

    @PostMapping("/api/auth/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest request) {
        String email = request.email() == null ? "" : request.email().trim().toLowerCase();
        AppUser user = repository.findByEmail(email).orElse(null);
        // 이메일 존재 여부를 구분해서 알려주지 않는다 (계정 존재 탐지 방지)
        if (user == null || user.getPasswordHash() == null
                || request.password() == null || !encoder.matches(request.password(), user.getPasswordHash())) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new ErrorResponse("이메일 또는 비밀번호가 맞지 않아요."));
        }
        user.issueToken(UUID.randomUUID().toString());
        repository.save(user);
        return ResponseEntity.ok(new AuthResponse(user.getToken(), user.getEmail(), user.getNickname()));
    }
}
