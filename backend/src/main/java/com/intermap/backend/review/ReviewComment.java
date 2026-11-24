package com.intermap.backend.review;

import com.intermap.backend.auth.AppUser;
import jakarta.persistence.Table;
import jakarta.persistence.Index;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

import java.time.Instant;

// 후기에 달리는 댓글. parentId가 있으면 그 댓글의 대댓글 (한 단계만 — 대댓글에 또 답글은 없다).
// 엔티티 이름을 Comment로 하면 H2 예약어 COMMENT와 부딪혀 ReviewComment로 둔다.
@Entity
@Table(indexes = {
        @Index(name = "idx_review_comment_review", columnList = "review_id"),
        @Index(name = "idx_review_comment_author", columnList = "author_id")
})
public class ReviewComment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private Review review;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser author;

    // 대댓글이면 부모 댓글 id. FK 없이 값만 둔다 (부모 삭제는 컨트롤러가 답글까지 지운다)
    private Long parentId;

    @Column(nullable = false, length = 500)
    private String text;

    private Instant createdAt = Instant.now();

    // 비공개 댓글 — 쓴 사람과 후기를 쓴 사람만 본다 (비공개 댓글에 달린 답글은 그 댓글을 쓴 사람도 본다).
    // 이 칸이 생기기 전의 댓글은 null이고 공개로 읽는다
    @Column(name = "is_secret")
    private Boolean secret;

    protected ReviewComment() {
    }

    public ReviewComment(Review review, AppUser author, Long parentId, String text) {
        this(review, author, parentId, text, false);
    }

    public ReviewComment(Review review, AppUser author, Long parentId, String text, boolean secret) {
        this.review = review;
        this.author = author;
        this.parentId = parentId;
        this.text = text;
        this.secret = secret;
    }

    // 이 사람이 이 댓글을 볼 수 있는지. parent = 답글이면 그 원댓글 (원댓글이거나 못 찾았으면 null).
    // 공개 댓글은 누구나(후기를 볼 수 있는 사람이면) 본다. 비공개 댓글은 쓴 사람과 후기를 쓴 사람,
    // 그리고 비공개 원댓글에 달린 답글이면 그 원댓글을 쓴 사람까지 — 둘이 주고받는 말이 한쪽에만 보이지 않게
    public boolean visibleTo(AppUser viewer, ReviewComment parent) {
        if (!isSecret()) return true;
        if (viewer == null) return false;
        Long id = viewer.getId();
        if (id.equals(author.getId()) || id.equals(review.getAuthor().getId())) return true;
        return parent != null && parent.isSecret() && id.equals(parent.getAuthor().getId());
    }

    public Long getId() { return id; }
    public Review getReview() { return review; }
    public AppUser getAuthor() { return author; }
    public Long getParentId() { return parentId; }
    public String getText() { return text; }
    public Instant getCreatedAt() { return createdAt; }
    public boolean isSecret() { return Boolean.TRUE.equals(secret); }
}
