package com.intermap.backend.moderation;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface UserBlockRepository extends JpaRepository<UserBlock, Long> {

    // 내가 차단한 사람들 — 차단 목록 화면용, 상대를 한 번에 조인
    @EntityGraph(attributePaths = "blocked")
    List<UserBlock> findByBlockerOrderByCreatedAtDesc(AppUser blocker);

    Optional<UserBlock> findByBlockerAndBlocked(AppUser blocker, AppUser blocked);

    // 나와 차단 관계인 사람 id — 내가 차단했거나 나를 차단한 사람. 이 사람들의 후기·댓글은 서로 안 보인다.
    @Query("select b.blocked.id from UserBlock b where b.blocker = :user")
    List<Long> blockedIdsOf(AppUser user);

    @Query("select b.blocker.id from UserBlock b where b.blocked = :user")
    List<Long> blockerIdsOf(AppUser user);

    // 회원 탈퇴 시 양쪽 방향 정리
    @Modifying
    @Query("delete from UserBlock b where b.blocker = :user or b.blocked = :user")
    void deleteAllInvolving(AppUser user);
}
