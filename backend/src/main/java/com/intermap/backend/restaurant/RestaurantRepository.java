package com.intermap.backend.restaurant;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface RestaurantRepository extends JpaRepository<Restaurant, Long> {

    Optional<Restaurant> findByNameAndRoadAddress(String name, String roadAddress);

    Optional<Restaurant> findByNameAndAddress(String name, String address);

    List<Restaurant> findTop50ByNameContainingIgnoreCase(String name);

    List<Restaurant> findByLatBetweenAndLngBetween(double minLat, double maxLat, double minLng, double maxLng);
}
