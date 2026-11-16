package com.intermap.backend.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;

import java.time.Instant;

// 프로필 사진. AppUser에 바이트를 두면 후기 목록마다 작성자와 같이 올라오므로 따로 뗀다.
// 프론트가 512px JPEG로 줄여 올린다 (수십 KB). 저장 방식은 ReviewPhoto와 같다 — 바이트는 R2, 여기엔 위치만.
@Entity
public class UserAvatar {

    // AppUser.id 와 같은 값 — 사용자당 한 장
    @Id
    private Long userId;

    @Column(nullable = false)
    private String contentType;

    // R2에 있는 사진은 빈 배열
    @Column(nullable = false, length = 2_000_000)
    private byte[] data;

    // R2 안의 위치. null이면 바이트가 data에 있다
    private String storageKey;

    // 바뀔 때마다 갱신. URL의 ?v= 로 붙여 1년 캐시를 깨는 데 쓴다
    @Column(nullable = false)
    private Instant updatedAt;

    protected UserAvatar() {
    }

    public UserAvatar(Long userId, String contentType, byte[] data) {
        this(userId, contentType, data, null);
    }

    // storageKey = PhotoStore.save가 돌려준 위치. null이면 바이트를 여기에 둔다
    public UserAvatar(Long userId, String contentType, byte[] data, String storageKey) {
        this.userId = userId;
        this.contentType = contentType;
        this.data = storageKey == null ? data : new byte[0];
        this.storageKey = storageKey;
        this.updatedAt = Instant.now();
    }

    // DB에 있던 바이트를 R2로 옮긴 뒤 부른다 (PhotoOffload). 사진은 그대로라 updatedAt(캐시 주소)은 안 바꾼다
    public void movedTo(String storageKey) {
        this.storageKey = storageKey;
        this.data = new byte[0];
    }

    public Long getUserId() { return userId; }
    public String getContentType() { return contentType; }
    public byte[] getData() { return data; }
    public String getStorageKey() { return storageKey; }
    public Instant getUpdatedAt() { return updatedAt; }
}
