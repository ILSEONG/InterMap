package com.intermap.backend.poll;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface PollOptionRepository extends JpaRepository<PollOption, Long> {

    List<PollOption> findAllByPollOrderByPositionAsc(Poll poll);

    // "내 투표" 목록에서 앞선 가게 이름을 붙이려고 여러 투표의 후보를 한 번에
    List<PollOption> findAllByPollIn(Collection<Poll> polls);

    void deleteAllByPoll(Poll poll);
}
