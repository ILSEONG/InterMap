package com.intermap.backend.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;

// 기기 하나의 로그인. 계정마다 토큰이 하나뿐이던 때는 다른 기기에서 로그인하면 먼저 쓰던 기기가 풀렸다 —
// 이제 기기마다 줄이 하나씩 있어서 서로 영향을 주지 않는다.
// 로그아웃해도 줄은 남긴다(토큰만 지운다): "전에 로그인한 적 있는 기기"를 기억해야 처음 보는 기기를 가려낼 수 있다.
@Entity
@Table(name = "auth_session",
        indexes = @Index(name = "idx_auth_session_user", columnList = "user_id"),
        uniqueConstraints = @UniqueConstraint(name = "uq_auth_session_device", columnNames = {"user_id", "device_id"}))
public class AuthSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private AppUser user;

    // 토큰의 SHA-256 (원문은 저장하지 않는다). 로그아웃하면 null
    @Column(name = "token_hash", unique = true, length = 64)
    private String tokenHash;

    // 앱·브라우저가 처음 켜질 때 스스로 만든 임의 값. 예전 앱은 안 보내서 null
    @Column(name = "device_id", length = 64)
    private String deviceId;

    // 알림에 보여 줄 이름 — "Android 앱 (SM-S918N)", "Windows PC · Chrome"
    @Column(name = "device_label", length = 80)
    private String deviceLabel;

    // 이 기기에서 처음 로그인한 때
    @Column(nullable = false)
    private Instant createdAt;

    // 마지막으로 로그인한 때 — 탈퇴처럼 "방금 로그인한 사람만" 받는 일의 기준
    @Column(nullable = false)
    private Instant signedInAt;

    // 마지막으로 쓴 때 — 이 뒤로 오래 안 쓰면 만료 (Sessions.IDLE_TTL)
    @Column(nullable = false)
    private Instant lastUsedAt;

    // 이미 다른 기기를 쓰던 계정에 새로 나타난 기기 — 알림 목록에 "새 기기 로그인"으로 나온다
    @Column(nullable = false)
    private boolean announced;

    protected AuthSession() {
    }

    public AuthSession(AppUser user, String tokenHash, String deviceId, String deviceLabel, boolean announced) {
        Instant now = Instant.now();
        this.user = user;
        this.tokenHash = tokenHash;
        this.deviceId = deviceId;
        this.deviceLabel = deviceLabel;
        this.announced = announced;
        this.createdAt = now;
        this.signedInAt = now;
        this.lastUsedAt = now;
    }

    // 같은 기기에서 다시 로그인 — 줄은 그대로, 토큰만 새로
    public void signInAgain(String tokenHash, String deviceLabel) {
        Instant now = Instant.now();
        this.tokenHash = tokenHash;
        if (deviceLabel != null) this.deviceLabel = deviceLabel;
        this.signedInAt = now;
        this.lastUsedAt = now;
    }

    public void touch() {
        this.lastUsedAt = Instant.now();
    }

    public void end() {
        this.tokenHash = null;
    }

    public Long getId() { return id; }
    public AppUser getUser() { return user; }
    public String getTokenHash() { return tokenHash; }
    public String getDeviceId() { return deviceId; }
    public String getDeviceLabel() { return deviceLabel; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getSignedInAt() { return signedInAt; }
    public Instant getLastUsedAt() { return lastUsedAt; }
    public boolean isAnnounced() { return announced; }
}
