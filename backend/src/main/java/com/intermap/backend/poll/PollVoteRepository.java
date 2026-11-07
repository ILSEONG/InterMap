package com.intermap.backend.poll;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;

public interface PollVoteRepository extends JpaRepository<PollVote, Long> {

    List<PollVote> findAllByPoll(Poll poll);

    List<PollVote> findAllByPollIn(Collection<Poll> polls);

    // 같은 사람이 다시 고르면 기존 선택을 지우고 새로 넣는다
    void deleteAllByPollAndVoterKey(Poll poll, String voterKey);

    void deleteAllByPoll(Poll poll);

    // 회원 탈퇴 시 남의 투표에 남긴 내 선택
    void deleteAllByUserId(Long userId);

    // 내가 (회원으로) 참여한 투표들 — 최근 것 위주로 충분하다
    @Query("select distinct v.poll.id from PollVote v where v.userId = :userId")
    List<Long> pollIdsVotedBy(Long userId);
}
