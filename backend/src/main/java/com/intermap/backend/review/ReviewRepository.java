package com.intermap.backend.review;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReviewRepository extends JpaRepository<Review, Long> {
    // 작성자를 한 번에 조인해 가져온다 (후기마다 사용자 조회하는 N+1 방지)
    @EntityGraph(attributePaths = "author")
    List<Review> findAllByOrderByCreatedAtDesc();

    // 한 사람은 한 가게에 후기를 하나만 남긴다 (가게 키 = 이름+주소 스냅샷)
    // 회원 탈퇴 시 그 사람 후기 전부
    List<Review> findAllByAuthor(AppUser author);

    // 월간 결산 — 내 후기를 오래된 순으로 (한 사람 후기는 많아야 수백 개라 통으로 받아 달별로 나눈다)
    List<Review> findAllByAuthorOrderByCreatedAtAsc(AppUser author);

    boolean existsByAuthorAndRestaurantNameAndRestaurantAddress(AppUser author, String restaurantName, String restaurantAddress);

    // 프로필의 "후기 N개" — 팔로우 전에도 개수는 보여준다 (내용은 안 보낸다)
    long countByAuthor(AppUser author);
}
