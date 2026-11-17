package com.intermap.backend.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public interface UserAvatarRepository extends JpaRepository<UserAvatar, Long> {

    interface Ref {
        Long getUserId();
        Instant getUpdatedAt();
        String getAccessKey();
    }

    // 목록 응답엔 URL만 필요하다 — 바이트는 /api/users/{id}/avatar 로 따로 받는다
    @Query("select a.userId as userId, a.updatedAt as updatedAt, a.accessKey as accessKey from UserAvatar a")
    List<Ref> findAllRefs();

    @Query("select a.userId as userId, a.updatedAt as updatedAt, a.accessKey as accessKey from UserAvatar a where a.userId in :userIds")
    List<Ref> findRefsByUserIdIn(Collection<Long> userIds);

    @Query("select a.userId as userId, a.updatedAt as updatedAt, a.accessKey as accessKey from UserAvatar a where a.userId = :userId")
    Optional<Ref> findRefByUserId(Long userId);

    // 캐시를 깨기 위해 갱신 시각을 v 로 붙이고, 키(k)가 맞아야 사진을 준다. 프론트는 API_BASE 를 앞에 붙여 쓴다.
    // 키가 아직 없는 행(백필 전 잠깐)은 주소를 주지 않는다 — 화면은 기본 그림을 쓴다
    static String url(Long userId, Instant updatedAt, String accessKey) {
        if (accessKey == null) return null;
        return "/api/users/" + userId + "/avatar?v=" + updatedAt.getEpochSecond() + "&k=" + accessKey;
    }

    static String url(Ref ref) {
        return url(ref.getUserId(), ref.getUpdatedAt(), ref.getAccessKey());
    }

    // 키가 없는 예전 행 (AvatarKeyBackfill)
    @Query("select a.userId from UserAvatar a where a.accessKey is null")
    List<Long> idsWithoutKey();

    @Modifying
    @Query("update UserAvatar a set a.accessKey = :key where a.userId = :userId and a.accessKey is null")
    int setKey(Long userId, String key);

    // userId -> URL. 후기·팔로우 목록처럼 여러 사람을 한 번에 그릴 때 한 쿼리로 끝낸다
    default Map<Long, String> urlsByUserId() {
        Map<Long, String> out = new HashMap<>();
        for (Ref ref : findAllRefs()) if (ref.getAccessKey() != null) out.put(ref.getUserId(), url(ref));
        return out;
    }

    // 위와 같지만 필요한 사람 것만 읽는다 (회원이 늘어도 조회량이 그대로)
    default Map<Long, String> urlsByUserId(Collection<Long> userIds) {
        Map<Long, String> out = new HashMap<>();
        if (userIds.isEmpty()) return out;
        for (Ref ref : findRefsByUserIdIn(userIds)) if (ref.getAccessKey() != null) out.put(ref.getUserId(), url(ref));
        return out;
    }

    // R2 안의 위치 (없거나 DB에 있으면 비어 있다) — 사진을 바꾸거나 지울 때 R2에서도 지우려고
    @Query("select a.storageKey from UserAvatar a where a.userId = :userId")
    Optional<String> findStorageKey(Long userId);

    // 바이트가 아직 DB에 있는 사진 (PhotoOffload가 R2로 옮길 것)
    @Query("select a.userId from UserAvatar a where a.storageKey is null order by a.userId")
    List<Long> idsInDatabase();

    default String urlOf(Long userId) {
        return findRefByUserId(userId).map(UserAvatarRepository::url).orElse(null);
    }
}
