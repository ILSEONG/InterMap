package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface FollowRepository extends JpaRepository<Follow, Long> {

    // 내가 팔로우한 사람들 — followee를 한 번에 조인
    @EntityGraph(attributePaths = "followee")
    List<Follow> findByFollowerOrderByCreatedAtDesc(AppUser follower);

    // 나를 팔로우한 사람들 — follower를 한 번에 조인
    @EntityGraph(attributePaths = "follower")
    List<Follow> findByFolloweeOrderByCreatedAtDesc(AppUser followee);

    // 내가 팔로우한 사람들의 id만 — 후기 공개 범위 판정용 (사람 정보는 필요 없다)
    @Query("select f.followee.id from Follow f where f.follower = :follower")
    List<Long> followeeIdsOf(AppUser follower);

    Optional<Follow> findByFollowerAndFollowee(AppUser follower, AppUser followee);

    // 프로필 개요의 팔로잉·팔로워 수 — 목록을 통째로 들고 오지 않고 센다
    long countByFollower(AppUser follower);

    long countByFollowee(AppUser followee);

    // 차단·회원 탈퇴 시 두 사람 사이 / 한 사람의 팔로우를 양방향으로 정리
    // 일괄 삭제는 메모리에 올라온 엔티티를 모른다 — 먼저 반영하고 끝나면 비워서 지운 행을 다시 쓰지 않게 한다
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from Follow f where (f.follower = :a and f.followee = :b) or (f.follower = :b and f.followee = :a)")
    void deleteBetween(AppUser a, AppUser b);

    // 일괄 삭제는 메모리에 올라온 엔티티를 모른다 — 먼저 반영하고 끝나면 비워서 지운 행을 다시 쓰지 않게 한다
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from Follow f where f.follower = :user or f.followee = :user")
    void deleteAllInvolving(AppUser user);
}
