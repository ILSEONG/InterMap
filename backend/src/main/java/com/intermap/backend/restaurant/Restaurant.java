package com.intermap.backend.restaurant;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import java.time.Instant;

@Entity
// lat_lng: 뷰포트(bounding box) 조회용. lat 범위로 좁힌 뒤 lng를 거른다.
// name: 후기 목록이 후기마다 상호+주소로 가게를 찾는다 (ReviewController.findPlace) — 없으면 매번 전체 스캔
@Table(indexes = {
        @Index(name = "idx_restaurant_lat_lng", columnList = "lat, lng"),
        @Index(name = "idx_restaurant_name", columnList = "name")
})
public class Restaurant {

    public enum Status { OPEN, CLOSED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;
    private String category;
    private String roadAddress;
    private String address;
    private double lat;
    private double lng;

    private Status status = Status.OPEN;
    private Instant statusCheckedAt;

    // LOCALDATA 관리번호 — 최초 매칭 후 저장해두면 이후 동기화는 정확 매칭
    private String localDataMgtNo;

    protected Restaurant() {
    }

    public Restaurant(String name, String category, String roadAddress, String address, double lat, double lng) {
        this.name = name;
        this.category = category;
        this.roadAddress = roadAddress;
        this.address = address;
        this.lat = lat;
        this.lng = lng;
    }

    public Long getId() { return id; }
    public String getName() { return name; }
    public String getCategory() { return category; }
    public String getRoadAddress() { return roadAddress; }
    public String getAddress() { return address; }
    public double getLat() { return lat; }
    public double getLng() { return lng; }
    public Status getStatus() { return status; }
    public Instant getStatusCheckedAt() { return statusCheckedAt; }
    public String getLocalDataMgtNo() { return localDataMgtNo; }

    public void markStatus(Status status, String mgtNo) {
        this.status = status;
        this.localDataMgtNo = mgtNo;
        this.statusCheckedAt = Instant.now();
    }
}
