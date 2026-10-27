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
    @Modifying
    @Query("delete from Favorite f where f.user = :user")
    void deleteAllByUser(AppUser user);

    Optional<Favorite> findByUserAndRestaurantNameAndRestaurantAddress(AppUser user, String restaurantName,
                                                                      String restaurantAddress);
}
