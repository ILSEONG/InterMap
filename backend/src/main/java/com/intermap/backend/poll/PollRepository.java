package com.intermap.backend.poll;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface PollRepository extends JpaRepository<Poll, Long> {

    @EntityGraph(attributePaths = "creator")
    Optional<Poll> findByToken(String token);

    // 회원 탈퇴 시 그 사람이 만든 투표 전부
    List<Poll> findAllByCreator(AppUser creator);

    @EntityGraph(attributePaths = "creator")
    List<Poll> findTop30ByCreatorOrderByCreatedAtDesc(AppUser creator);

    @EntityGraph(attributePaths = "creator")
    List<Poll> findAllByIdIn(Collection<Long> ids);

    // 마감(정해 둔 시각 또는 일찍 마감한 시각)이 cutoff보다 오래된 투표 — 보관 기간이 지나 지운다
    @Query("select p from Poll p where p.closesAt < :cutoff or (p.closedAt is not null and p.closedAt < :cutoff)")
    List<Poll> findEndedBefore(Instant cutoff);
}
