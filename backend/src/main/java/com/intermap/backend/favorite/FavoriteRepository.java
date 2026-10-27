package com.intermap.backend.favorite;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface FavoriteRepository extends JpaRepository<Favorite, Long> {
    List<Favorite> findAllByUserOrderByCreatedAtDesc(AppUser user);

    // 회원 탈퇴 시
    // 일괄 삭제는 메모리에 올라온 엔티티를 모른다 — 먼저 반영하고 끝나면 비워서 지운 행을 다시 쓰지 않게 한다
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from Favorite f where f.user = :user")
    void deleteAllByUser(AppUser user);

    Optional<Favorite> findByUserAndRestaurantNameAndRestaurantAddress(AppUser user, String restaurantName,
                                                                      String restaurantAddress);
}
