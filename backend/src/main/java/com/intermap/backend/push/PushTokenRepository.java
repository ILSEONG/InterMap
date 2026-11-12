package com.intermap.backend.push;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

public interface PushTokenRepository extends JpaRepository<PushToken, Long> {

    Optional<PushToken> findByToken(String token);

    @Query("select t.token from PushToken t where t.user = :user")
    List<String> tokensOf(AppUser user);

    // 로그아웃·앱 삭제(FCM이 없는 토큰이라고 알려 줌) 때 그 기기만
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from PushToken t where t.token = :token")
    void deleteByTokenValue(String token);

    // 회원 탈퇴
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from PushToken t where t.user = :user")
    void deleteAllByUser(AppUser user);
}
