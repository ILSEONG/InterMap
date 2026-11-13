package com.intermap.backend.auth;

import com.intermap.backend.state.ServerState;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

// 소셜 로그인은 됐지만 아직 우리 계정에 연결되지 않은 사용자. 닉네임·약관(가입)이나 인증번호(기존 계정 연결)를 마칠 때까지
// provider 정보를 티켓으로 들고 있는다. DB(ServerState)에 두므로 그 사이 서버가 다시 켜져도 티켓이 살아 있다.
@Component
public class PendingSocialLinks {

    // appleRefreshToken: Apple 로그인일 때만 — 계정이 만들어지면 거기에 옮겨 둔다 (탈퇴 때 연결 해제용)
    public record Pending(String provider, String providerId, String email, Instant issuedAt, String appleRefreshToken) {
    }

    // 저장 모양 (시각은 epoch 밀리초)
    record Stored(String provider, String providerId, String email, long issuedAt, String appleRefreshToken) {
    }

    private static final Duration TTL = Duration.ofMinutes(15);
    private static final String KIND = "social-ticket";

    private final ServerState state;

    public PendingSocialLinks(ServerState state) {
        this.state = state;
    }

    public String put(String provider, String providerId, String email) {
        return put(provider, providerId, email, null);
    }

    public String put(String provider, String providerId, String email, String appleRefreshToken) {
        String ticket = UUID.randomUUID().toString();
        state.put(KIND, ticket, new Stored(provider, providerId, email, Instant.now().toEpochMilli(), appleRefreshToken), TTL);
        return ticket;
    }

    // 만료됐거나 없으면 null
    public Pending get(String ticket) {
        if (ticket == null) return null;
        return state.get(KIND, ticket, Stored.class)
                .map(s -> new Pending(s.provider(), s.providerId(), s.email(), Instant.ofEpochMilli(s.issuedAt()), s.appleRefreshToken()))
                .orElse(null);
    }

    public void remove(String ticket) {
        if (ticket != null) state.remove(KIND, ticket);
    }
}
