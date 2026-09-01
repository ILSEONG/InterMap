package com.intermap.backend.social;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UserAliasRepository extends JpaRepository<UserAlias, Long> {

    List<UserAlias> findByOwner(AppUser owner);

    Optional<UserAlias> findByOwnerAndTarget(AppUser owner, AppUser target);
}
