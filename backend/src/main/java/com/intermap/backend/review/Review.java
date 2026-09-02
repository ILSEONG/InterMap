package com.intermap.backend.review;

import com.intermap.backend.auth.AppUser;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

import java.time.Instant;

// 사용자가 가게에 남긴 후기. 주인장(admin)이 쓴 것도 같은 테이블 — 프론트가 작성자로 구분한다.
// 가게는 이름+주소 스냅샷으로 잇는다 (restaurant 테이블은 배치 동기화로 갈아엎힐 수 있어 FK를 걸지 않는다).
@Entity
public class Review {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser author;

    @Column(nullable = false)
    private String restaurantName;

    private String restaurantCategory;

    @Column(nullable = false)
    private String restaurantAddress;

    private double rating;

    @Column(nullable = false, length = 2000)
    private String text;

    // 추천 메뉴 (선택). 비우면 null
    @Column(length = 100)
    private String menu;

    private Instant createdAt = Instant.now();

    protected Review() {
    }

    public Review(AppUser author, String restaurantName, String restaurantCategory, String restaurantAddress,
                  double rating, String text, String menu) {
        this.author = author;
        this.restaurantName = restaurantName;
        this.restaurantCategory = restaurantCategory;
        this.restaurantAddress = restaurantAddress;
        this.rating = rating;
        this.text = text;
        this.menu = menu;
    }

    public void edit(double rating, String text, String menu) {
        this.rating = rating;
        this.text = text;
        this.menu = menu;
    }

    public Long getId() { return id; }
    public AppUser getAuthor() { return author; }
    public String getRestaurantName() { return restaurantName; }
    public String getRestaurantCategory() { return restaurantCategory; }
    public String getRestaurantAddress() { return restaurantAddress; }
    public double getRating() { return rating; }
    public String getText() { return text; }
    public String getMenu() { return menu; }
    public Instant getCreatedAt() { return createdAt; }
}
