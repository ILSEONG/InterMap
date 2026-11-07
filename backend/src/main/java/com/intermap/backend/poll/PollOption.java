package com.intermap.backend.poll;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

// 투표 후보 가게. 후기·찜과 같은 이름+주소 스냅샷으로 가게를 가리킨다 (restaurant 테이블에 FK 없음).
@Entity
public class PollOption {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private Poll poll;

    // 만든 사람이 담은 순서
    private int position;

    @Column(nullable = false, length = 100)
    private String restaurantName;

    @Column(length = 100)
    private String restaurantCategory;

    @Column(nullable = false, length = 200)
    private String restaurantAddress;

    // 만든 사람의 한마디 (선택) — "민수가 추천한 국밥집" 같은
    @Column(length = 60)
    private String note;

    protected PollOption() {
    }

    public PollOption(Poll poll, int position, String restaurantName, String restaurantCategory, String restaurantAddress, String note) {
        this.poll = poll;
        this.position = position;
        this.restaurantName = restaurantName;
        this.restaurantCategory = restaurantCategory;
        this.restaurantAddress = restaurantAddress;
        this.note = note;
    }

    public Long getId() { return id; }
    public Poll getPoll() { return poll; }
    public int getPosition() { return position; }
    public String getRestaurantName() { return restaurantName; }
    public String getRestaurantCategory() { return restaurantCategory; }
    public String getRestaurantAddress() { return restaurantAddress; }
    public String getNote() { return note; }
}
