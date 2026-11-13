package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import jakarta.persistence.Index;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;

// 팔로우 요청 (requester → target). 상대가 "수동 승인"으로 설정했을 때만 생긴다.
// 수락하면 Follow 행으로 바뀌고, 거절·취소하면 그냥 지워진다.
// Follow와 따로 두는 이유: 후기 열람 범위(ReviewAudience)를 비롯해 팔로우를 읽는 모든 곳이
// 대기 중인 요청을 팔로우로 착각할 일이 없게 — 수락 전에는 아무것도 열리지 않는다.
@Entity
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"requester_id", "target_id"}), indexes = {
        @Index(name = "idx_follow_request_target", columnList = "target_id")
})
public class FollowRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser requester;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser target;

    private Instant createdAt = Instant.now();

    protected FollowRequest() {
    }

    public FollowRequest(AppUser requester, AppUser target) {
        this.requester = requester;
        this.target = target;
    }

    public Long getId() { return id; }
    public AppUser getRequester() { return requester; }
    public AppUser getTarget() { return target; }
    public Instant getCreatedAt() { return createdAt; }
}
