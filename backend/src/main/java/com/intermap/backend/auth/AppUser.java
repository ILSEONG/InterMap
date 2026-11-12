package com.intermap.backend.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;

@Entity
public class AppUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 카카오는 이메일 권한 심사 전이라 이메일 없이 가입될 수 있다 (SchemaPatch 참고)
    @Column(unique = true)
    private String email;

    private String passwordHash;

    @Column(unique = true)
    private String nickname;

    // 숫자만 저장 (01012345678)
    @Column(unique = true)
    private String phone;

    // 간편 로그인 연결: 'google' | 'naver' | 'kakao', 자체 가입은 null
    private String provider;

    // provider 쪽 사용자 고유 ID. 이메일이 바뀌거나 없어도 같은 계정으로 찾는 키.
    private String providerId;

    // 로그인 세션 토큰의 SHA-256 (hex). 원문은 클라이언트만 갖는다 — DB가 새도 세션을 쓸 수 없게.
    // 재로그인 시 교체되어 이전 토큰은 무효가 된다.
    @Column(unique = true)
    private String token;

    private Instant createdAt = Instant.now();

    // 토큰 발급 시각. 이 기준으로 만료를 판단한다 (AuthController.TOKEN_TTL_DAYS)
    private Instant tokenIssuedAt;

    // 약관 동의 시각. 필수 약관은 가입 조건이라 가입자는 항상 있고, 마케팅 수신은 선택이라 null일 수 있다.
    private Instant termsAgreedAt;
    private Instant marketingAgreedAt;

    // 팔로우 승인 방식. true면 팔로우가 "요청"으로 들어와 내가 수락해야 맺어진다 (social.FollowRequest).
    // 예전 가입자는 null — 자동 승인으로 본다.
    private Boolean manualFollowApproval;

    // 알림 목록을 마지막으로 연 때 — 그 뒤 것만 "새 알림"으로 센다 (social.NotificationController)
    private Instant notificationsSeenAt;

    protected AppUser() {
    }

    public void agree(boolean marketing) {
        Instant now = Instant.now();
        this.termsAgreedAt = now;
        this.marketingAgreedAt = marketing ? now : null;
    }

    public AppUser(String email, String passwordHash, String nickname, String phone) {
        this.email = email;
        this.passwordHash = passwordHash;
        this.nickname = nickname;
        this.phone = phone;
    }

    // 소셜 계정 연결. 소셜로 가입하면 passwordHash는 null이라 비밀번호 로그인은 막힌다.
    public void linkProvider(String provider, String providerId) {
        this.provider = provider;
        this.providerId = providerId;
    }

    public Long getId() { return id; }
    public String getEmail() { return email; }
    public String getPasswordHash() { return passwordHash; }
    public String getNickname() { return nickname; }
    public String getPhone() { return phone; }
    public String getProvider() { return provider; }
    public String getProviderId() { return providerId; }
    public Instant getCreatedAt() { return createdAt; }

    public Instant getTokenIssuedAt() { return tokenIssuedAt; }
    public Instant getTermsAgreedAt() { return termsAgreedAt; }
    public Instant getMarketingAgreedAt() { return marketingAgreedAt; }

    public boolean isManualFollowApproval() { return Boolean.TRUE.equals(manualFollowApproval); }

    public Instant getNotificationsSeenAt() { return notificationsSeenAt; }

    public void markNotificationsSeen() {
        this.notificationsSeenAt = Instant.now();
    }

    public void setManualFollowApproval(boolean manual) {
        this.manualFollowApproval = manual;
    }

    public void rename(String nickname) {
        this.nickname = nickname;
    }

    public void changePassword(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    // 원문 토큰을 받아 해시로 저장한다. null이면 로그아웃 (기존 토큰 무효)
    public void issueToken(String rawToken) {
        this.token = rawToken == null ? null : hashToken(rawToken);
        this.tokenIssuedAt = rawToken == null ? null : Instant.now();
    }

    public static String hashToken(String rawToken) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(rawToken.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
