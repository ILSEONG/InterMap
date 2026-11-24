package com.intermap.backend.restaurant;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface RestaurantRepository extends JpaRepository<Restaurant, Long> {

    // First — 같은 상호+주소 행이 둘 이상이어도 예외 없이 하나를 고른다 (후기 목록 전체가 500 나지 않게)
    Optional<Restaurant> findFirstByNameAndRoadAddress(String name, String roadAddress);

    Optional<Restaurant> findFirstByNameAndAddress(String name, String address);

    // 후기 목록에 좌표를 붙일 때 — 후기에 나온 상호들의 행을 한 번에 읽는다 (가게마다 따로 조회하지 않게).
    // 행 = [name, roadAddress, address, lat, lng, status, cuisine, cafeKind]. 같은 상호의 다른 지점도 섞여 오므로 주소는 호출부가 맞춘다.
    @Query("select r.name, r.roadAddress, r.address, r.lat, r.lng, r.status, r.cuisine, r.cafeKind from Restaurant r where r.name in :names")
    List<Object[]> findPlaceRowsByNameIn(Collection<String> names);

    // 지도용 조회는 status를 받는다 — 폐업 가게는 아예 내려주지 않는다 (호출부가 OPEN을 넘긴다). 검색은 RestaurantSearch
    List<Restaurant> findByStatusAndLatBetweenAndLngBetween(Restaurant.Status status, double minLat, double maxLat, double minLng, double maxLng);

    // 지도 화면 한 칸의 가게들 — 목록 응답에 실리는 열만 [id, name, category, roadAddress, address, lat, lng, cuisine, cafeKind].
    // 엔티티로 받으면 번화가 한 칸(3천 행)마다 영속성 컨텍스트에 올라가 느리다
    @Query("select r.id, r.name, r.category, r.roadAddress, r.address, r.lat, r.lng, r.cuisine, r.cafeKind from Restaurant r"
            + " where r.status = :status and r.lat between :minLat and :maxLat and r.lng between :minLng and :maxLng")
    List<Object[]> findListRows(Restaurant.Status status, double minLat, double maxLat, double minLng, double maxLng);

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

    // 위와 같지만 고른 업종의 가게만 센다 (업종 필터를 켠 지도)
    @Query("select avg(r.lat), avg(r.lng), count(r) from Restaurant r"
            + " where r.status = :status and r.cuisine in :cuisines"
            + " and r.lat between :minLat and :maxLat and r.lng between :minLng and :maxLng"
            + " group by floor(r.lat / :cell), floor(r.lng / :cell)")
    List<Object[]> summarizeCuisines(Restaurant.Status status, Collection<String> cuisines,
                                     double minLat, double maxLat, double minLng, double maxLng, double cell);

    // 고른 업종만 빼고 센다 (맛집 화면: 카페를 뺀다). 업종이 안 정해진 가게는 센다
    @Query("select avg(r.lat), avg(r.lng), count(r) from Restaurant r"
            + " where r.status = :status and (r.cuisine is null or r.cuisine not in :except)"
            + " and r.lat between :minLat and :maxLat and r.lng between :minLng and :maxLng"
            + " group by floor(r.lat / :cell), floor(r.lng / :cell)")
    List<Object[]> summarizeExcept(Restaurant.Status status, Collection<String> except,
                                   double minLat, double maxLat, double minLng, double maxLng, double cell);

    // 카페 화면의 종류 필터 — 카페 가운데 고른 종류(Cuisine.cafeKind)만 센다
    @Query("select avg(r.lat), avg(r.lng), count(r) from Restaurant r"
            + " where r.status = :status and r.cafeKind in :kinds"
            + " and r.lat between :minLat and :maxLat and r.lng between :minLng and :maxLng"
            + " group by floor(r.lat / :cell), floor(r.lng / :cell)")
    List<Object[]> summarizeCafeKinds(Restaurant.Status status, Collection<String> kinds,
                                      double minLat, double maxLat, double minLng, double maxLng, double cell);

    // 업종을 채울 때 훑는 열 — [id, name, category, roadAddress, address, sbizCategory, cuisine, cafeKind]. id 순으로 조금씩 (CuisineBackfill)
    @Query("select r.id, r.name, r.category, r.roadAddress, r.address, r.sbizCategory, r.cuisine, r.cafeKind from Restaurant r"
            + " where r.id > :after order by r.id")
    List<Object[]> findCuisineRows(long after, Pageable page);

    // 도로명주소 API로 아직 안 본 영업중 가게 — [id, roadAddress, address, geocoded]. 엔티티 대신 필요한 열만.
    // after보다 id가 큰 행만 — 실패한 행을 뒤에 남겨 두고 앞으로 나아가게 (같은 행을 끝없이 다시 잡지 않는다)
    @Query("select r.id, r.roadAddress, r.address, r.geocoded from Restaurant r"
            + " where r.coordSource is null and r.status = :status and r.id > :after order by r.id")
    List<Object[]> findCoordPending(Restaurant.Status status, long after, Pageable page);

    // 위와 같지만 예전 네이버 좌표가 든 행만 — 저장하면 안 되는 좌표라 제일 먼저 바꾼다
    @Query("select r.id, r.roadAddress, r.address, r.geocoded from Restaurant r"
            + " where r.coordSource is null and r.geocoded = true and r.status = :status and r.id > :after order by r.id")
    List<Object[]> findCoordPendingFromNaver(Restaurant.Status status, long after, Pageable page);

    // 확인한 때가 없는 "못 찾음" 표시 — 다시 묻는다. 넷째 값은 네이버 좌표가 아직 들어 있는지(REVERT)
    @Query("select r.id, r.roadAddress, r.address, case when r.coordSource = 'REVERT' then true else false end"
            + " from Restaurant r where r.coordSource in ('LICENSE', 'REVERT') and r.coordCheckedAt is null"
            + " and r.status = :status and r.id > :after order by r.id")
    List<Object[]> findCoordRecheck(Restaurant.Status status, long after, Pageable page);

    @Query("select count(r) from Restaurant r where r.coordSource in ('LICENSE', 'REVERT')"
            + " and r.coordCheckedAt is null and r.status = :status")
    long countCoordRecheck(Restaurant.Status status);

    long countByStatusAndCoordSource(Restaurant.Status status, String coordSource);

    long countByStatusAndCoordSourceIsNull(Restaurant.Status status);

    // 아직 네이버 좌표가 든 행 수 (주소로 안 본 것 + 되돌리기를 기다리는 것) — 0이 되면 다 걷어낸 것
    @Query("select count(r) from Restaurant r"
            + " where (r.coordSource is null and r.geocoded = true) or r.coordSource = 'REVERT'")
    long countHoldingNaverCoords();

    // 인허가 좌표로 되돌려야 하는 행 — [id, name, roadAddress, address, localDataMgtNo]
    @Query("select r.id, r.name, r.roadAddress, r.address, r.localDataMgtNo from Restaurant r where r.coordSource = 'REVERT'")
    List<Object[]> findRevertRows();

    // 예전에 폐업으로 표시만 해 둔 가게 — 주간 최신화가 지운다 (RestaurantRefresh)
    List<Restaurant> findAllByStatus(Restaurant.Status status);

    // 도로명주소 API 좌표로 옮긴다
    @Modifying
    @Query("update Restaurant r set r.lat = :lat, r.lng = :lng, r.geocoded = true, r.coordSource = 'JUSO' where r.id = :id")
    int relocate(Long id, double lat, double lng);

    // 주소로 못 찾음 — 인허가 좌표를 쓴다(LICENSE). 네이버 좌표가 들어 있던 행은 되돌릴 차례를 기다린다(REVERT)
    @Modifying
    @Query("update Restaurant r set r.geocoded = false, r.coordSource = :source, r.coordCheckedAt = :at where r.id = :id")
    int markCoordSource(Long id, String source, java.time.Instant at);

    // 네이버 좌표가 남아 있던 행을 인허가 좌표로 되돌린다
    @Modifying
    @Query("update Restaurant r set r.lat = :lat, r.lng = :lng, r.geocoded = false, r.coordSource = 'LICENSE'"
            + " where r.id = :id and r.coordSource = 'REVERT'")
    int revertToLicense(Long id, double lat, double lng);
}
