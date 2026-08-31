package com.intermap.backend.review;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

import java.time.Instant;

// 주인장(admin)이 남긴 후기. 모든 사용자에게 보인다.
// 가게는 "이름|주소" 키로 잇는다 — 프론트 mock 가게와 DB 가게가 같은 키 규칙을 쓴다.
@Entity
public class OwnerReview {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String restaurantKey;

    private double rating;

    @Column(nullable = false, length = 2000)
    private String text;

    private Instant createdAt = Instant.now();

    protected OwnerReview() {
    }

    public OwnerReview(String restaurantKey, double rating, String text) {
        this.restaurantKey = restaurantKey;
        this.rating = rating;
        this.text = text;
    }

    public Long getId() { return id; }
    public String getRestaurantKey() { return restaurantKey; }
    public double getRating() { return rating; }
    public String getText() { return text; }
    public Instant getCreatedAt() { return createdAt; }
}
