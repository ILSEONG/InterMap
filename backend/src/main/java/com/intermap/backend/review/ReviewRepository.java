package com.intermap.backend.review;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReviewRepository extends JpaRepository<Review, Long> {
    // 작성자를 한 번에 조인해 가져온다 (후기마다 사용자 조회하는 N+1 방지)
    @EntityGraph(attributePaths = "author")
    List<Review> findAllByOrderByCreatedAtDesc();
}
