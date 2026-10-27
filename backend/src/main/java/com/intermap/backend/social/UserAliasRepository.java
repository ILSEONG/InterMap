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
    @Modifying
    @Query("delete from UserAlias a where a.owner = :user or a.target = :user")
    void deleteAllInvolving(AppUser user);
}
