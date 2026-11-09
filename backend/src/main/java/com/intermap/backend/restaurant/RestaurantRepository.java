package com.intermap.backend.restaurant;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface RestaurantRepository extends JpaRepository<Restaurant, Long> {

    // First — 같은 상호+주소 행이 둘 이상이어도 예외 없이 하나를 고른다 (후기 목록 전체가 500 나지 않게)
    Optional<Restaurant> findFirstByNameAndRoadAddress(String name, String roadAddress);

    Optional<Restaurant> findFirstByNameAndAddress(String name, String address);

    // 지도·검색용 조회는 status를 받는다 — 폐업 가게는 아예 내려주지 않는다 (호출부가 OPEN을 넘긴다)
    List<Restaurant> findTop50ByStatusAndNameContainingIgnoreCase(Restaurant.Status status, String name);

    List<Restaurant> findByStatusAndLatBetweenAndLngBetween(Restaurant.Status status, double minLat, double maxLat, double minLng, double maxLng);

    // 백필 중복 판정용 키만 (엔티티 전체를 올리면 서울 10만 행에서 Render 512MB가 터진다).
    // 인터페이스 프로젝션은 행마다 프록시를 만들어 무거우니 Object[] — [id, name, roadAddress, localDataMgtNo]
    @Query("select r.id, r.name, r.roadAddress, r.localDataMgtNo from Restaurant r")
    List<Object[]> findAllKeys();

    // 격자 셀 요약을 DB에서 바로 집계 — 서울 전체(10만+ 행)를 엔티티로 올리지 않기 위해.
    // 행 = [avg(lat), avg(lng), count]. select엔 집계만 둔다 — 바인드 파라미터가 든 group by 식을 select에 또 쓰면
    // H2·Postgres 모두 "같은 식"으로 안 보고 GROUP BY 누락 오류를 낸다.
    @Query("select avg(r.lat), avg(r.lng), count(r) from Restaurant r"
            + " where r.status = :status and r.lat between :minLat and :maxLat and r.lng between :minLng and :maxLng"
            + " group by floor(r.lat / :cell), floor(r.lng / :cell)")
    List<Object[]> summarize(Restaurant.Status status, double minLat, double maxLat, double minLng, double maxLng, double cell);

    // 좌표를 아직 안 고친 영업중 가게 — [id, roadAddress, address, lat, lng]. 엔티티 대신 필요한 열만.
    @Query("select r.id, r.roadAddress, r.address, r.lat, r.lng from Restaurant r"
            + " where r.geocoded is null and r.status = :status order by r.id")
    List<Object[]> findUngeocoded(Restaurant.Status status, Pageable page);

    // 위와 같지만 다른 가게와 좌표가 똑같이 겹친 것만 — 필지 하나에 몰린 가게라 제일 먼저 고친다
    @Query("select r.id, r.roadAddress, r.address, r.lat, r.lng from Restaurant r"
            + " where r.geocoded is null and r.status = :status"
            + " and exists (select 1 from Restaurant o where o.lat = r.lat and o.lng = r.lng and o.id <> r.id)"
            + " order by r.id")
    List<Object[]> findUngeocodedStacked(Restaurant.Status status, Pageable page);

    long countByStatusAndGeocoded(Restaurant.Status status, Boolean geocoded);

    long countByStatusAndGeocodedIsNull(Restaurant.Status status);

    @Modifying
    @Query("update Restaurant r set r.lat = :lat, r.lng = :lng, r.geocoded = true where r.id = :id")
    int relocate(Long id, double lat, double lng);

    @Modifying
    @Query("update Restaurant r set r.geocoded = false where r.id = :id")
    int markGeocodeFailed(Long id);
}
