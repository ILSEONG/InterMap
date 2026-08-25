package com.intermap.backend.restaurant;

import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;

import java.time.Instant;

@Entity
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
