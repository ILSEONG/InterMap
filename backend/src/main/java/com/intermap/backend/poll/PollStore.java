package com.intermap.backend.poll;

import com.intermap.backend.auth.AppUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

// 투표를 지우는 곳을 한데 모은다 — 만든 사람이 지울 때, 회원 탈퇴, 보관 기간이 지났을 때.
@Component
public class PollStore {

    private static final Logger log = LoggerFactory.getLogger(PollStore.class);
    // 마감 후 이만큼 지나면 지운다 (개인정보처리방침: 비회원 투표 이름의 보관 기간)
    static final Duration RETENTION = Duration.ofDays(30);

    private final PollRepository polls;
    private final PollOptionRepository options;
    private final PollVoteRepository votes;

    public PollStore(PollRepository polls, PollOptionRepository options, PollVoteRepository votes) {
        this.polls = polls;
        this.options = options;
        this.votes = votes;
    }

    @Transactional
    public void delete(Poll poll) {
        votes.deleteAllByPoll(poll);
        options.deleteAllByPoll(poll);
        polls.delete(poll);
    }

    // 회원 탈퇴: 내가 만든 투표는 통째로, 남의 투표에 남긴 내 선택은 그 행만
    @Transactional
    public void deleteAllFor(AppUser user) {
        for (Poll poll : polls.findAllByCreator(user)) delete(poll);
        votes.deleteAllByUserId(user.getId());
    }

    // 매일 새벽 5시(KST) — 보관 기간이 지난 투표를 지운다
    @Scheduled(cron = "0 0 5 * * *", zone = "Asia/Seoul")
    @Transactional
    public void purgeExpired() {
        List<Poll> expired = polls.findEndedBefore(Instant.now().minus(RETENTION));
        for (Poll poll : expired) delete(poll);
        if (!expired.isEmpty()) log.info("보관 기간이 지난 투표 {}개를 지웠어요", expired.size());
    }
}
