package com.intermap.backend.review;

import com.intermap.backend.auth.AppUser;
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

    protected ReviewComment() {
    }

    public ReviewComment(Review review, AppUser author, Long parentId, String text) {
        this.review = review;
        this.author = author;
        this.parentId = parentId;
        this.text = text;
    }

    public Long getId() { return id; }
    public Review getReview() { return review; }
    public AppUser getAuthor() { return author; }
    public Long getParentId() { return parentId; }
    public String getText() { return text; }
    public Instant getCreatedAt() { return createdAt; }
}
