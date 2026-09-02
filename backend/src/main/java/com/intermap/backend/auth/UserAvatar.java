package com.intermap.backend.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;

import java.time.Instant;

// 프로필 사진. AppUser에 바이트를 두면 후기 목록마다 작성자와 같이 올라오므로 따로 뗀다.
// 프론트가 512px JPEG로 줄여 올린다 (수십 KB). 저장 방식은 ReviewPhoto와 같은 이유로 DB(bytea).
@Entity
public class UserAvatar {

    // AppUser.id 와 같은 값 — 사용자당 한 장
    @Id
    private Long userId;

    @Column(nullable = false)
    private String contentType;

    @Column(nullable = false, length = 2_000_000)
    private byte[] data;

    // 바뀔 때마다 갱신. URL의 ?v= 로 붙여 1년 캐시를 깨는 데 쓴다
    @Column(nullable = false)
    private Instant updatedAt;

    protected UserAvatar() {
    }

    public UserAvatar(Long userId, String contentType, byte[] data) {
        this.userId = userId;
        this.contentType = contentType;
        this.data = data;
        this.updatedAt = Instant.now();
    }

    public Long getUserId() { return userId; }
    public String getContentType() { return contentType; }
    public byte[] getData() { return data; }
    public Instant getUpdatedAt() { return updatedAt; }
}
