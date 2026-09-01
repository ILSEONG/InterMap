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

// 단방향 팔로우 (follower → followee). 상호 승인 없음.
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

    protected Follow() {
    }

    public Follow(AppUser follower, AppUser followee) {
        this.follower = follower;
        this.followee = followee;
    }

    public Long getId() { return id; }
    public AppUser getFollower() { return follower; }
    public AppUser getFollowee() { return followee; }
    public Instant getCreatedAt() { return createdAt; }
}
