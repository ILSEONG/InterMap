package com.intermap.backend.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

import java.time.Instant;

@Entity
public class AppUser {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String email;

    private String passwordHash;

    @Column(unique = true)
    private String nickname;

    // 숫자만 저장 (01012345678)
    @Column(unique = true)
    private String phone;

    // 간편 로그인 대비: 'google' | 'naver' | 'kakao', 자체 가입은 null
    private String provider;

    // 로그인 세션 토큰. 재로그인 시 교체되어 이전 토큰은 무효가 된다.
    @Column(unique = true)
    private String token;

    private Instant createdAt = Instant.now();

    protected AppUser() {
    }

    public AppUser(String email, String passwordHash, String nickname, String phone) {
        this.email = email;
        this.passwordHash = passwordHash;
        this.nickname = nickname;
        this.phone = phone;
    }

    // 소셜 로그인 최초 가입 — 비밀번호/휴대폰 없이 provider로 식별
    public AppUser(String email, String nickname, String provider) {
        this.email = email;
        this.nickname = nickname;
        this.provider = provider;
    }

    public Long getId() { return id; }
    public String getEmail() { return email; }
    public String getPasswordHash() { return passwordHash; }
    public String getNickname() { return nickname; }
    public String getPhone() { return phone; }
    public String getProvider() { return provider; }
    public String getToken() { return token; }
    public Instant getCreatedAt() { return createdAt; }

    public void issueToken(String token) { this.token = token; }
}
