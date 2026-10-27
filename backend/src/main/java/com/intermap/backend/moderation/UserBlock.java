package com.intermap.backend.moderation;

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

// 사용자 차단. 차단하면 두 사람은 서로의 후기·댓글을 못 보고, 팔로우가 양쪽 다 끊기고, 다시 팔로우할 수 없다.
@Entity
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"blocker_id", "blocked_id"}))
public class UserBlock {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser blocker;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser blocked;

    private Instant createdAt = Instant.now();

    protected UserBlock() {
    }

    public UserBlock(AppUser blocker, AppUser blocked) {
        this.blocker = blocker;
        this.blocked = blocked;
    }

    public Long getId() { return id; }
    public AppUser getBlocker() { return blocker; }
    public AppUser getBlocked() { return blocked; }
    public Instant getCreatedAt() { return createdAt; }
}
