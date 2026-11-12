package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;

// 단방향 팔로우 (follower → followee). 받는 사람이 수동 승인이면 FollowRequest를 거쳐 수락될 때 만들어진다.
@Entity
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"follower_id", "followee_id"}))
public class Follow {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser follower;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser followee;

    private Instant createdAt = Instant.now();

    // 팔로우 요청이 수락되어 맺어진 팔로우 (알림 문구를 가른다: "수락했어요" / "팔로우하기 시작했어요"). 예전 행은 null
    private Boolean viaRequest;

    protected Follow() {
    }

    public Follow(AppUser follower, AppUser followee, boolean viaRequest) {
        this(follower, followee);
        this.viaRequest = viaRequest;
    }

    public Follow(AppUser follower, AppUser followee) {
        this.follower = follower;
        this.followee = followee;
    }

    public Long getId() { return id; }
    public AppUser getFollower() { return follower; }
    public AppUser getFollowee() { return followee; }
    public Instant getCreatedAt() { return createdAt; }
    public boolean isViaRequest() { return Boolean.TRUE.equals(viaRequest); }
}
