package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface UserAliasRepository extends JpaRepository<UserAlias, Long> {

    List<UserAlias> findByOwner(AppUser owner);

    Optional<UserAlias> findByOwnerAndTarget(AppUser owner, AppUser target);

    // 회원 탈퇴 시 — 내가 붙인 이름, 남이 나에게 붙인 이름 모두
    // 일괄 삭제는 메모리에 올라온 엔티티를 모른다 — 먼저 반영하고 끝나면 비워서 지운 행을 다시 쓰지 않게 한다
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from UserAlias a where a.owner = :user or a.target = :user")
    void deleteAllInvolving(AppUser user);
}
