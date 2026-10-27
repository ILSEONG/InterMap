package com.intermap.backend.moderation;

import com.intermap.backend.auth.AppUser;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;

import java.time.Instant;

// 후기·댓글 신고. 대상이 지워져도 운영 기록이 남도록 신고 당시 내용과 작성자를 사본으로 둔다.
@Entity
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"reporter_id", "target_type", "target_id"}))
public class Report {

    public enum TargetType { REVIEW, COMMENT }

    public enum Reason { SPAM, ABUSE, SEXUAL, PRIVACY, FALSE_INFO, OTHER }

    // OPEN: 처리 전 / REMOVED: 운영자가 콘텐츠 삭제 / DISMISSED: 문제 없음 / GONE: 작성자가 스스로 지움·탈퇴
    public enum Status { OPEN, REMOVED, DISMISSED, GONE }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser reporter;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TargetType targetType;

    @Column(nullable = false)
    private Long targetId;

    // 신고 당시 작성자 (탈퇴하면 id만 남는다)
    private Long targetAuthorId;
    private String targetAuthorName;

    @Column(length = 2000)
    private String contentSnapshot;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Reason reason;

    @Column(length = 500)
    private String detail;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status = Status.OPEN;

    private Instant createdAt = Instant.now();
    private Instant resolvedAt;

    protected Report() {
    }

    public Report(AppUser reporter, TargetType targetType, Long targetId, AppUser targetAuthor, String contentSnapshot,
                  Reason reason, String detail) {
        this.reporter = reporter;
        this.targetType = targetType;
        this.targetId = targetId;
        this.targetAuthorId = targetAuthor.getId();
        this.targetAuthorName = targetAuthor.getNickname();
        this.contentSnapshot = contentSnapshot == null || contentSnapshot.length() <= 2000
                ? contentSnapshot : contentSnapshot.substring(0, 2000);
        this.reason = reason;
        this.detail = detail;
    }

    public void resolve(Status status) {
        this.status = status;
        this.resolvedAt = Instant.now();
    }

    public Long getId() { return id; }
    public AppUser getReporter() { return reporter; }
    public TargetType getTargetType() { return targetType; }
    public Long getTargetId() { return targetId; }
    public Long getTargetAuthorId() { return targetAuthorId; }
    public String getTargetAuthorName() { return targetAuthorName; }
    public String getContentSnapshot() { return contentSnapshot; }
    public Reason getReason() { return reason; }
    public String getDetail() { return detail; }
    public Status getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getResolvedAt() { return resolvedAt; }
}
