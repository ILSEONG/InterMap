package com.intermap.backend.push;

import com.intermap.backend.auth.AppUser;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

import java.time.Instant;

// 푸시 알림을 받을 기기 (FCM 등록 토큰). 한 사람이 여러 기기를 쓸 수 있고, 토큰 하나는 한 사람에게만 붙는다 —
// 같은 폰에서 다른 계정으로 로그인하면 그 계정으로 옮겨 간다.
@Entity
public class PushToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser user;

    @Column(unique = true, nullable = false, length = 512)
    private String token;

    // 'android' (나중에 'ios')
    private String platform;

    private Instant updatedAt = Instant.now();

    protected PushToken() {
    }

    public PushToken(AppUser user, String token, String platform) {
        this.user = user;
        this.token = token;
        this.platform = platform;
    }

    // 앱을 켤 때마다 다시 등록한다 — 주인과 시각을 맞춘다
    public void assign(AppUser user, String platform) {
        this.user = user;
        this.platform = platform;
        this.updatedAt = Instant.now();
    }

    public Long getId() { return id; }
    public AppUser getUser() { return user; }
    public String getToken() { return token; }
    public String getPlatform() { return platform; }
    public Instant getUpdatedAt() { return updatedAt; }
}
