package com.intermap.backend.review;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

// 후기 사진. 프론트가 1280px JPEG로 줄여 올리므로 한 장 수백 KB.
// ponytail: DB(bytea)에 그대로 넣는다 — Render 디스크는 재배포 때 날아가고 오브젝트 스토리지는 키 설정이 필요해서.
// Neon 무료 0.5GB 기준 수천 장까지. 넘어가면 S3/R2로 옮기고 여기엔 URL만 남길 것.
@Entity
public class ReviewPhoto {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private Review review;

    @Column(nullable = false)
    private String contentType;

    // H2는 length로 VARBINARY 크기를 잡고, Postgres는 bytea라 length를 무시한다
    @Column(nullable = false, length = 10_000_000)
    private byte[] data;

    protected ReviewPhoto() {
    }

    public ReviewPhoto(Review review, String contentType, byte[] data) {
        this.review = review;
        this.contentType = contentType;
        this.data = data;
    }

    public Long getId() { return id; }
    public Review getReview() { return review; }
    public String getContentType() { return contentType; }
    public byte[] getData() { return data; }
}
