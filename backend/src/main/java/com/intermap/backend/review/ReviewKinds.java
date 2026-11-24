package com.intermap.backend.review;

import com.intermap.backend.restaurant.Cuisine;
import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

// 후기가 카페 후기인지 가른다 — 앱은 맛집 화면과 카페 화면을 완전히 나눠 보여 주므로,
// 서버가 세는 숫자(월간 결산, 프로필의 후기 수)도 같은 기준으로 나눠야 화면과 어긋나지 않는다.
// 기준은 후기 목록(ReviewController.Item)과 같다: 가게 행에 적힌 업종 먼저, 가게를 못 찾았거나 폐업이면 후기에 적힌 이름·분류로.
@Component
public class ReviewKinds {

    private static final String CAFE = "CAFE";

    private final RestaurantRepository restaurants;

    public ReviewKinds(RestaurantRepository restaurants) {
        this.restaurants = restaurants;
    }

    // 이 후기들 가운데 카페 후기의 id
    public Set<Long> cafeIds(List<Review> reviews) {
        if (reviews.isEmpty()) return Set.of();
        Set<String> names = reviews.stream().map(Review::getRestaurantName).collect(Collectors.toSet());
        // 행 = [name, roadAddress, address, lat, lng, status, cuisine, cafeKind] — 도로명 주소 먼저, 없으면 지번 주소로 맞춘다
        Map<String, Object[]> byRoad = new HashMap<>();
        Map<String, Object[]> byLot = new HashMap<>();
        for (Object[] row : restaurants.findPlaceRowsByNameIn(names)) {
            String name = (String) row[0];
            if (row[1] != null) byRoad.putIfAbsent(name + "|" + row[1], row);
            if (row[2] != null) byLot.putIfAbsent(name + "|" + row[2], row);
        }
        Set<Long> cafes = new HashSet<>();
        for (Review r : reviews) {
            String key = r.getRestaurantName() + "|" + r.getRestaurantAddress();
            Object[] row = byRoad.getOrDefault(key, byLot.get(key));
            String cuisine = row != null && row[5] != Restaurant.Status.CLOSED && row[6] != null ? (String) row[6]
                    : Cuisine.of(r.getRestaurantName(), null, r.getRestaurantCategory());
            if (CAFE.equals(cuisine)) cafes.add(r.getId());
        }
        return cafes;
    }
}
