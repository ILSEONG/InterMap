package com.intermap.backend.auth;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface AuthSessionRepository extends JpaRepository<AuthSession, Long> {

    Optional<AuthSession> findByTokenHash(String tokenHash);

    Optional<AuthSession> findByUserAndDeviceId(AppUser user, String deviceId);

    // 기기 식별값을 보내는 기기로 로그인한 적이 있는지 (예전 앱의 이름 없는 줄은 세지 않는다)
    boolean existsByUserAndDeviceIdIsNotNull(AppUser user);

    // 알림 목록용 — 최근에 새로 나타난 기기
    List<AuthSession> findByUserAndAnnouncedTrueAndCreatedAtAfter(AppUser user, Instant after);

    // 다른 기기 모두 로그아웃 — 줄은 남기고 토큰만 지운다
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update AuthSession s set s.tokenHash = null where s.user = :user and s.id <> :keepId and s.tokenHash is not null")
    int endOthers(AppUser user, Long keepId);

    // 계정의 로그인을 전부 끊는다 (관리자 비밀번호 교체)
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update AuthSession s set s.tokenHash = null where s.user = :user and s.tokenHash is not null")
    int endAll(AppUser user);

    // 회원 탈퇴
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from AuthSession s where s.user = :user")
    void deleteAllByUser(AppUser user);

    // 오래 안 쓴 줄 정리
    @Transactional
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from AuthSession s where s.lastUsedAt < :before")
    int deleteUnusedSince(Instant before);
}
