package com.intermap.backend.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public interface UserAvatarRepository extends JpaRepository<UserAvatar, Long> {

    interface Ref {
        Long getUserId();
        Instant getUpdatedAt();
    }

    // 목록 응답엔 URL만 필요하다 — 바이트는 /api/users/{id}/avatar 로 따로 받는다
    @Query("select a.userId as userId, a.updatedAt as updatedAt from UserAvatar a")
    List<Ref> findAllRefs();

    // 캐시를 깨기 위해 갱신 시각을 v 로 붙인다. 프론트는 API_BASE 를 앞에 붙여 쓴다.
    static String url(Long userId, Instant updatedAt) {
        return "/api/users/" + userId + "/avatar?v=" + updatedAt.getEpochSecond();
    }

    // userId -> URL. 후기·팔로우 목록처럼 여러 사람을 한 번에 그릴 때 한 쿼리로 끝낸다
    default Map<Long, String> urlsByUserId() {
        Map<Long, String> out = new HashMap<>();
        for (Ref ref : findAllRefs()) out.put(ref.getUserId(), url(ref.getUserId(), ref.getUpdatedAt()));
        return out;
    }

    // 바이트를 올리지 않고 갱신 시각만
    @Query("select a.updatedAt from UserAvatar a where a.userId = :userId")
    Optional<Instant> findUpdatedAt(Long userId);

    default String urlOf(Long userId) {
        return findUpdatedAt(userId).map(at -> url(userId, at)).orElse(null);
    }
}
