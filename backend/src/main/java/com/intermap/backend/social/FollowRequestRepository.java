package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface FollowRequestRepository extends JpaRepository<FollowRequest, Long> {

    // 나에게 온 요청 — requester를 한 번에 조인
    @EntityGraph(attributePaths = "requester")
    List<FollowRequest> findByTargetOrderByCreatedAtDesc(AppUser target);

    // 내가 보낸 요청 — target을 한 번에 조인
    @EntityGraph(attributePaths = "target")
    List<FollowRequest> findByRequesterOrderByCreatedAtDesc(AppUser requester);

    Optional<FollowRequest> findByRequesterAndTarget(AppUser requester, AppUser target);

    // 차단·회원 탈퇴 시 두 사람 사이 / 한 사람의 요청을 양방향으로 정리 (FollowRepository와 같은 규칙)
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from FollowRequest r where (r.requester = :a and r.target = :b) or (r.requester = :b and r.target = :a)")
    void deleteBetween(AppUser a, AppUser b);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from FollowRequest r where r.requester = :user or r.target = :user")
    void deleteAllInvolving(AppUser user);
}
