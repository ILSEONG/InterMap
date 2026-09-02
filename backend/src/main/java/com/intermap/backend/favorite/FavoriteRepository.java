package com.intermap.backend.favorite;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface FavoriteRepository extends JpaRepository<Favorite, Long> {
    List<Favorite> findAllByUserOrderByCreatedAtDesc(AppUser user);

    Optional<Favorite> findByUserAndRestaurantNameAndRestaurantAddress(AppUser user, String restaurantName,
                                                                      String restaurantAddress);
}
