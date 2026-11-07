package com.intermap.backend.poll;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

import java.time.Instant;

// 한 사람이 고른 후보 하나 = 한 행. 여러 곳을 고를 수 있어(괜찮은 곳 다 고르기) 한 사람이 여러 행을 가진다.
// voterKey: 회원은 "u:{userId}", 비회원은 "g:{브라우저 난수의 SHA-256}" — 같은 사람이 다시 고르면 기존 행을 갈아 끼운다.
@Entity
public class PollVote {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private Poll poll;

    @Column(nullable = false)
    private Long optionId;

    @Column(nullable = false, length = 80)
    private String voterKey;

    // 결과에 보이는 이름 (회원은 그때의 닉네임, 비회원은 직접 적은 이름)
    @Column(nullable = false, length = 20)
    private String voterName;

    // 회원이 고른 경우만 — "내 투표" 목록과 회원 탈퇴 정리에 쓴다
    private Long userId;

    private Instant createdAt = Instant.now();

    protected PollVote() {
    }

    public PollVote(Poll poll, Long optionId, String voterKey, String voterName, Long userId) {
        this.poll = poll;
        this.optionId = optionId;
        this.voterKey = voterKey;
        this.voterName = voterName;
        this.userId = userId;
    }

    public Long getId() { return id; }
    public Poll getPoll() { return poll; }
    public Long getOptionId() { return optionId; }
    public String getVoterKey() { return voterKey; }
    public String getVoterName() { return voterName; }
    public Long getUserId() { return userId; }
    public Instant getCreatedAt() { return createdAt; }
}
