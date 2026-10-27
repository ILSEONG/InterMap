package com.intermap.backend.review;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface ReviewCommentRepository extends JpaRepository<ReviewComment, Long> {
    // 작성자·후기 작성자를 한 번에 조인 (댓글마다 사용자 조회하는 N+1 방지). 오래된 것부터 — 대화 순서.
    // 후기 작성자는 볼 수 있는 후기의 댓글만 거르는 데 쓴다 (ReviewAudience)
    @EntityGraph(attributePaths = {"author", "review.author"})
    List<ReviewComment> findAllByOrderByCreatedAtAsc();

    // 후기 삭제 시 딸린 댓글 정리
    void deleteAllByReviewId(Long reviewId);

    // 부모 댓글 삭제 시 대댓글 정리
    void deleteAllByParentId(Long parentId);

    // 회원 탈퇴 시 그 사람 댓글 전부
    List<ReviewComment> findAllByAuthor(AppUser author);

    // 지워지는 댓글들의 신고를 닫으려고 id만
    @Query("select c.id from ReviewComment c where c.review.id = :reviewId")
    List<Long> idsByReviewId(Long reviewId);

    @Query("select c.id from ReviewComment c where c.parentId = :parentId")
    List<Long> idsByParentId(Long parentId);
}
