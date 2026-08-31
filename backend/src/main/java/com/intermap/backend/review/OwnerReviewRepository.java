package com.intermap.backend.review;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface OwnerReviewRepository extends JpaRepository<OwnerReview, Long> {
    List<OwnerReview> findAllByOrderByCreatedAtDesc();
}
