package com.intermap.backend.auth;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

// 소셜 로그인은 됐지만 아직 우리 계정에 연결되지 않은 사용자. 이메일+비밀번호로 계정을 증명할 때까지
// provider 정보를 티켓으로 들고 있는다. 단일 인스턴스 전제라 메모리로 충분 (인증번호 저장소와 같은 이유).
@Component
public class PendingSocialLinks {

    public record Pending(String provider, String providerId, String email, Instant issuedAt) {
    }

    private static final long TTL_SECONDS = 15 * 60;

    private final Map<String, Pending> pending = new ConcurrentHashMap<>();

    public String put(String provider, String providerId, String email) {
        pending.values().removeIf(p -> p.issuedAt().plusSeconds(TTL_SECONDS).isBefore(Instant.now()));
        String ticket = UUID.randomUUID().toString();
        pending.put(ticket, new Pending(provider, providerId, email, Instant.now()));
        return ticket;
    }

    // 만료됐거나 없으면 null
    public Pending get(String ticket) {
        if (ticket == null) return null;
        Pending p = pending.get(ticket);
        if (p == null) return null;
        if (p.issuedAt().plusSeconds(TTL_SECONDS).isBefore(Instant.now())) {
            pending.remove(ticket);
            return null;
        }
        return p;
    }

    public void remove(String ticket) {
        if (ticket != null) pending.remove(ticket);
    }
}
