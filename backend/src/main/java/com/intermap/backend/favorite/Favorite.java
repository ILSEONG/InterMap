package com.intermap.backend.favorite;

import com.intermap.backend.auth.AppUser;
import jakarta.persistence.Table;
import jakarta.persistence.Index;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

import java.time.Instant;

// 사용자의 가게 찜. 가게는 후기와 같은 이름+주소 스냅샷으로 잇는다 (restaurant 테이블에 FK 없음).
@Entity
@Table(indexes = {
        @Index(name = "idx_favorite_user", columnList = "user_id")
})
public class Favorite {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private AppUser user;

    @Column(nullable = false)
    private String restaurantName;

    @Column(nullable = false)
    private String restaurantAddress;

    private Instant createdAt = Instant.now();

    protected Favorite() {
    }

    public Favorite(AppUser user, String restaurantName, String restaurantAddress) {
        this.user = user;
        this.restaurantName = restaurantName;
        this.restaurantAddress = restaurantAddress;
    }

    public Long getId() { return id; }
    public AppUser getUser() { return user; }
    public String getRestaurantName() { return restaurantName; }
    public String getRestaurantAddress() { return restaurantAddress; }
    public Instant getCreatedAt() { return createdAt; }
}
