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
        String getBlurhash();
    }

    // 목록 응답에는 사진 id·키만 필요하다 — 바이트는 /api/photos/{id}/{key}로 따로 받는다
    @Query("select p.id as id, p.review.id as reviewId, p.accessKey as accessKey, p.blurhash as blurhash from ReviewPhoto p order by p.id")
    List<Ref> findAllRefs();

    @Query("select p.id as id, p.review.id as reviewId, p.accessKey as accessKey, p.blurhash as blurhash from ReviewPhoto p where p.review.id = :reviewId order by p.id")
    List<Ref> findRefsByReviewId(Long reviewId);

    // 월간 결산 — 그 달 후기들에 붙은 사진 수
    @Query("select count(p) from ReviewPhoto p where p.review.id in :reviewIds")
    long countByReviewIds(Collection<Long> reviewIds);

    @Query("select p.id from ReviewPhoto p where p.accessKey is null")
    List<Long> idsWithoutKey();

    @Modifying
    @Query("update ReviewPhoto p set p.accessKey = :key where p.id = :id")
    void setKey(Long id, String key);

    @Query("select p.id from ReviewPhoto p where p.blurhash is null order by p.id")
    List<Long> idsWithoutBlurhash();

    @Modifying
    @Query("update ReviewPhoto p set p.blurhash = :hash where p.id = :id")
    void setBlurhash(Long id, String hash);
}
