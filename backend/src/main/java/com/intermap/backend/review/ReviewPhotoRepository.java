package com.intermap.backend.review;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;

public interface ReviewPhotoRepository extends JpaRepository<ReviewPhoto, Long> {

    interface Ref {
        Long getId();
        Long getReviewId();
        String getAccessKey();
        Integer getWidth();
        Integer getHeight();
    }

    // 목록 응답에는 사진 id·키만 필요하다 — 바이트는 /api/photos/{id}/{key}로 따로 받는다
    @Query("select p.id as id, p.review.id as reviewId, p.accessKey as accessKey, p.width as width, p.height as height from ReviewPhoto p order by p.id")
    List<Ref> findAllRefs();

    // 후기 여러 개의 사진을 한 번에 (목록 조회용 — 내려줄 후기 것만)
    @Query("select p.id as id, p.review.id as reviewId, p.accessKey as accessKey, p.width as width, p.height as height from ReviewPhoto p where p.review.id in :reviewIds order by p.id")
    List<Ref> findRefsByReviewIdIn(Collection<Long> reviewIds);

    @Query("select p.id as id, p.review.id as reviewId, p.accessKey as accessKey, p.width as width, p.height as height from ReviewPhoto p where p.review.id = :reviewId order by p.id")
    List<Ref> findRefsByReviewId(Long reviewId);

    // 월간 결산 — 그 달 후기들에 붙은 사진 수
    @Query("select count(p) from ReviewPhoto p where p.review.id in :reviewIds")
    long countByReviewIds(Collection<Long> reviewIds);

    @Query("select p.id from ReviewPhoto p where p.accessKey is null")
    List<Long> idsWithoutKey();

    @Modifying
    @Query("update ReviewPhoto p set p.accessKey = :key where p.id = :id")
    void setKey(Long id, String key);

    // R2로 옮긴 사진은 바이트가 여기 없어 크기를 못 읽는다 — 옮길 때 채운다 (ReviewPhoto.movedTo)
    @Query("select p.id from ReviewPhoto p where p.width is null and p.storageKey is null order by p.id")
    List<Long> idsWithoutSize();

    // 바이트가 아직 DB에 있는 사진 (PhotoOffload가 R2로 옮길 것)
    @Query("select p.id from ReviewPhoto p where p.storageKey is null order by p.id")
    List<Long> idsInDatabase();

    @Query("select p.storageKey from ReviewPhoto p where p.id in :ids and p.storageKey is not null")
    List<String> storageKeysByIdIn(Collection<Long> ids);

    // 사진 행을 지우기 전에, R2에서 같이 지울 위치들
    default List<String> storageKeys(Collection<Long> ids) {
        return ids.isEmpty() ? List.of() : storageKeysByIdIn(ids);
    }

}
