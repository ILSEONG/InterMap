package com.intermap.backend.review;

import jakarta.persistence.Table;
import jakarta.persistence.Index;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.ManyToOne;

import java.util.UUID;

// 후기 사진. 프론트가 1280px JPEG로 줄여 올리므로 한 장 수백 KB.
// 바이트는 R2에 두고 여기엔 위치(storageKey)만 남긴다 (storage/PhotoStore.java).
// R2 설정이 없거나 올리지 못했을 때만 바이트가 data에 들어 있다.
@Entity
@Table(indexes = {
        @Index(name = "idx_review_photo_review", columnList = "review_id")
})
public class ReviewPhoto {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private Review review;

    @Column(nullable = false)
    private String contentType;

    // H2는 length로 VARBINARY 크기를 잡고, Postgres는 bytea라 length를 무시한다.
    // R2에 있는 사진은 빈 배열 (NOT NULL 칸이라 null 대신)
    @Column(nullable = false, length = 10_000_000)
    private byte[] data;

    // R2 안의 위치. null이면 바이트가 data에 있다
    private String storageKey;

    // 사진 주소(/api/photos/{id}/{accessKey})에 들어가는 추측 불가 키. <img>는 로그인 헤더를 못 보내므로
    // 볼 수 있는 후기 응답에만 이 키를 실어 준다 — id만으로 1, 2, 3… 훑어 남의 사진을 받지 못하게.
    // 예전 사진은 PhotoKeyBackfill이 채운다.
    @Column(unique = true)
    private String accessKey;

    // 원본 크기(px) — 앱이 사진이 오기 전부터 칸을 제 비율로 잡는다.
    // 못 읽은 사진은 0, 예전 사진은 PhotoSizeBackfill이 채우기 전까지 null
    private Integer width;
    private Integer height;

    protected ReviewPhoto() {
    }

    public ReviewPhoto(Review review, String contentType, byte[] data) {
        this(review, contentType, data, null);
    }

    // storageKey = PhotoStore.save가 돌려준 위치. null이면 바이트를 여기에 둔다
    public ReviewPhoto(Review review, String contentType, byte[] data, String storageKey) {
        this.review = review;
        this.contentType = contentType;
        this.accessKey = newKey();
        setSize(PhotoSize.of(data));
        this.data = storageKey == null ? data : new byte[0];
        this.storageKey = storageKey;
    }

    // DB에 있던 바이트를 R2로 옮긴 뒤 부른다 (PhotoOffload)
    public void movedTo(String storageKey) {
        if (width == null) setSize(PhotoSize.of(data));
        this.storageKey = storageKey;
        this.data = new byte[0];
    }

    static String newKey() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    public Long getId() { return id; }
    public String getAccessKey() { return accessKey; }
    public Integer getWidth() { return width; }
    public Integer getHeight() { return height; }

    void setSize(int[] size) {
        this.width = size[0];
        this.height = size[1];
    }
    public Review getReview() { return review; }
    public String getContentType() { return contentType; }
    public byte[] getData() { return data; }
    public String getStorageKey() { return storageKey; }
}
