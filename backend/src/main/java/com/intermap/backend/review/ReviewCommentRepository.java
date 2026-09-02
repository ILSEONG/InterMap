package com.intermap.backend.review;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReviewCommentRepository extends JpaRepository<ReviewComment, Long> {
    // 작성자를 한 번에 조인 (댓글마다 사용자 조회하는 N+1 방지). 오래된 것부터 — 대화 순서.
    @EntityGraph(attributePaths = "author")
    List<ReviewComment> findAllByOrderByCreatedAtAsc();

    // 후기 삭제 시 딸린 댓글 정리
    void deleteAllByReviewId(Long reviewId);

    // 부모 댓글 삭제 시 대댓글 정리
    void deleteAllByParentId(Long parentId);
}
