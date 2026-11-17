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

    // 좌표 출처. null = 인허가 좌표 그대로(아직 안 고침), true = 네이버 지오코딩으로 고침, false = 고치려 했지만 실패.
    // 인허가 좌표는 지번(필지) 기준이라 가게 자리와 수십~수백 m 어긋나고, 한강공원처럼 하천 필지면 강 한가운데 찍힌다.
    private Boolean geocoded;

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
    public Boolean getGeocoded() { return geocoded; }

    public void markStatus(Status status, String mgtNo) {
        this.status = status;
        this.localDataMgtNo = mgtNo;
        this.statusCheckedAt = Instant.now();
    }
}
