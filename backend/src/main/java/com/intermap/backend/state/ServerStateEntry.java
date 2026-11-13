package com.intermap.backend.state;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

import java.time.Instant;

// ServerState가 쓰는 표. 엔티티로 둔 건 표를 만들기 위해서일 뿐이고(ddl-auto), 읽고 쓰는 건 ServerState가 SQL로 직접 한다.
@Entity
@Table(name = "server_state", indexes = @Index(name = "idx_server_state_expires", columnList = "expires_at"))
public class ServerStateEntry {

    // "<종류>:<키의 SHA-256>" — 이메일·IP 같은 원래 키는 저장하지 않는다
    @Id
    @Column(length = 100)
    private String id;

    @Column(length = 4000)
    private String val;

    @Column(nullable = false)
    private long counter;

    @Column(nullable = false)
    private Instant expiresAt;

    protected ServerStateEntry() {
    }
}
