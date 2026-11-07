package com.intermap.backend.poll;

import com.intermap.backend.auth.AppUser;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

import java.time.Instant;

// "어디 갈래?" 투표 — 만든 사람이 후보 가게를 골라 링크로 돌리면, 링크를 받은 사람은 로그인 없이도 고른다.
// 링크 주소의 token이 곧 열람 권한이다 (추측할 수 없는 난수, PollController.newToken).
// 마감 30일 뒤 PollStore.purgeExpired가 통째로 지운다 (개인정보처리방침의 보관 기간).
@Entity
public class Poll {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 32)
    private String token;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser creator;

    @Column(nullable = false, length = 40)
    private String title;

    private Instant createdAt = Instant.now();

    // 정해 둔 마감 시각. 만든 사람이 먼저 마감하면 closedAt이 찍힌다
    @Column(nullable = false)
    private Instant closesAt;

    private Instant closedAt;

    protected Poll() {
    }

    public Poll(String token, AppUser creator, String title, Instant closesAt) {
        this.token = token;
        this.creator = creator;
        this.title = title;
        this.closesAt = closesAt;
    }

    public boolean isClosed(Instant now) {
        return closedAt != null || !now.isBefore(closesAt);
    }

    // 실제로 끝난 시각 — 일찍 마감했으면 그 시각
    public Instant endedAt() {
        return closedAt != null && closedAt.isBefore(closesAt) ? closedAt : closesAt;
    }

    public void close() {
        if (closedAt == null) closedAt = Instant.now();
    }

    public Long getId() { return id; }
    public String getToken() { return token; }
    public AppUser getCreator() { return creator; }
    public String getTitle() { return title; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getClosesAt() { return closesAt; }
    public Instant getClosedAt() { return closedAt; }
}
