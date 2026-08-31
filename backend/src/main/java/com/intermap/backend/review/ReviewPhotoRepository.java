package com.intermap.backend.review;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface ReviewPhotoRepository extends JpaRepository<ReviewPhoto, Long> {

    interface Ref {
        Long getId();
        Long getReviewId();
    }

    // 목록 응답에는 사진 id만 필요하다 — 바이트는 /api/photos/{id}로 따로 받는다
    @Query("select p.id as id, p.review.id as reviewId from ReviewPhoto p order by p.id")
    List<Ref> findAllRefs();
}
