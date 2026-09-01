package com.intermap.backend.restaurant;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface RestaurantRepository extends JpaRepository<Restaurant, Long> {

    Optional<Restaurant> findByNameAndRoadAddress(String name, String roadAddress);

    Optional<Restaurant> findByNameAndAddress(String name, String address);

    List<Restaurant> findTop50ByNameContainingIgnoreCase(String name);

    List<Restaurant> findByLatBetweenAndLngBetween(double minLat, double maxLat, double minLng, double maxLng);

    // 백필 중복 판정용 키만 (엔티티 전체를 올리면 서울 10만 행에서 Render 512MB가 터진다)
    interface KeyRef {
        Long getId();
        String getName();
        String getRoadAddress();
        String getLocalDataMgtNo();
    }

    @Query("select r.id as id, r.name as name, r.roadAddress as roadAddress, r.localDataMgtNo as localDataMgtNo from Restaurant r")
    List<KeyRef> findAllKeys();

    // 격자 셀 요약을 DB에서 바로 집계 — 서울 전체(10만+ 행)를 엔티티로 올리지 않기 위해.
    // 행 = [avg(lat), avg(lng), count]. select엔 집계만 둔다 — 바인드 파라미터가 든 group by 식을 select에 또 쓰면
    // H2·Postgres 모두 "같은 식"으로 안 보고 GROUP BY 누락 오류를 낸다.
    @Query("select avg(r.lat), avg(r.lng), count(r) from Restaurant r"
            + " where r.lat between :minLat and :maxLat and r.lng between :minLng and :maxLng"
            + " group by floor(r.lat / :cell), floor(r.lng / :cell)")
    List<Object[]> summarize(double minLat, double maxLat, double minLng, double maxLng, double cell);
}
