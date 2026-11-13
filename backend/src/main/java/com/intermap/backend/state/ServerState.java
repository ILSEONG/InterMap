package com.intermap.backend.state;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;

// 잠깐 들고 있다 버리는 서버 상태를 DB에 둔다 — 이메일 인증번호, 간편 로그인 진행 상태, 로그인 실패 횟수, 하루 한도.
// 예전엔 서버 메모리(ConcurrentHashMap)에 있어서 서버가 다시 켜지면(재배포·무료 서버가 잠들었다 깰 때) 전부 사라졌고,
// 서버를 두 대로 늘릴 수도 없었다 (한 대가 내준 인증번호를 다른 한 대는 모른다).
// 모든 값에 만료 시각이 있고, 지난 것은 없는 것으로 친다. 하루에 한 번 지난 행을 지운다.
//
// 키는 "<종류>:<원래 키의 SHA-256>"로 저장한다 — 이메일·IP가 표에 그대로 남지 않는다.
// 시각은 다른 표와 같이 한국시간 벽시계로 넣는다 (application.properties의 jdbc.time_zone) — 여기선 비교에만 쓴다.
@Component
public class ServerState {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper = new ObjectMapper();
    private Boolean postgres;

    public ServerState(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static String id(String kind, String key) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
            return kind + ":" + HexFormat.of().formatHex(hash);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static Timestamp ts(Instant at) {
        return Timestamp.valueOf(LocalDateTime.ofInstant(at, KST));
    }

    private boolean postgres() {
        if (postgres == null) {
            String product = jdbc.execute((ConnectionCallback<String>) c -> c.getMetaData().getDatabaseProductName());
            postgres = product != null && product.toLowerCase().contains("postgres");
        }
        return postgres;
    }

    // ---- 값 ----

    public Optional<String> get(String kind, String key) {
        List<String> rows = jdbc.queryForList("select val from server_state where id = ? and expires_at > ?", String.class,
                id(kind, key), ts(Instant.now()));
        return rows.isEmpty() ? Optional.empty() : Optional.ofNullable(rows.get(0));
    }

    public void put(String kind, String key, String value, Duration ttl) {
        String id = id(kind, key);
        Timestamp expires = ts(Instant.now().plus(ttl));
        if (postgres()) {
            // 한 문장으로 넣거나 바꾼다 — PostgreSQL은 트랜잭션 안에서 중복 키 오류가 나면 그 트랜잭션이 통째로 못 쓰게 된다
            jdbc.update("insert into server_state (id, val, counter, expires_at) values (?, ?, 0, ?)"
                    + " on conflict (id) do update set val = excluded.val, counter = 0, expires_at = excluded.expires_at", id, value, expires);
            return;
        }
        if (jdbc.update("update server_state set val = ?, counter = 0, expires_at = ? where id = ?", value, expires, id) > 0) return;
        try {
            jdbc.update("insert into server_state (id, val, counter, expires_at) values (?, ?, 0, ?)", id, value, expires);
        } catch (DuplicateKeyException e) {
            jdbc.update("update server_state set val = ?, counter = 0, expires_at = ? where id = ?", value, expires, id);
        }
    }

    public void remove(String kind, String key) {
        jdbc.update("delete from server_state where id = ?", id(kind, key));
    }

    // 한 번만 꺼낼 수 있다 — 동시에 두 요청이 와도 지우는 데 성공한 한쪽만 값을 받는다
    public Optional<String> take(String kind, String key) {
        Optional<String> value = get(kind, key);
        if (value.isEmpty()) return value;
        return jdbc.update("delete from server_state where id = ?", id(kind, key)) > 0 ? value : Optional.empty();
    }

    // 만료 전인 행이 몇 개인지 — 누가 요청을 쏟아부어 표를 채우는 걸 막을 때 쓴다
    public long count(String kind) {
        Long n = jdbc.queryForObject("select count(*) from server_state where id like ? and expires_at > ?", Long.class,
                kind + ":%", ts(Instant.now()));
        return n == null ? 0 : n;
    }

    // ---- 값(JSON) ----

    public <T> Optional<T> get(String kind, String key, Class<T> type) {
        return get(kind, key).map(json -> read(json, type));
    }

    public <T> Optional<T> take(String kind, String key, Class<T> type) {
        return take(kind, key).map(json -> read(json, type));
    }

    public void put(String kind, String key, Object value, Duration ttl) {
        try {
            put(kind, key, mapper.writeValueAsString(value), ttl);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException("상태를 저장할 수 없어요", e);
        }
    }

    private <T> T read(String json, Class<T> type) {
        try {
            return mapper.readValue(json, type);
        } catch (Exception e) {
            throw new IllegalStateException("저장된 상태를 읽을 수 없어요", e);
        }
    }

    // ---- 횟수 ----

    // 1 올리고 올린 뒤의 값을 돌려준다. 행이 없거나 만료됐으면 1부터, 만료 시각은 그때 받은 expiresAt으로 잡는다
    // (이미 세고 있는 중이면 만료 시각은 그대로 — 창이 뒤로 밀리지 않는다).
    public long increment(String kind, String key, Instant expiresAt) {
        String id = id(kind, key);
        Timestamp now = ts(Instant.now());
        Timestamp expires = ts(expiresAt);
        if (postgres()) {
            Long n = jdbc.queryForObject("insert into server_state (id, val, counter, expires_at) values (?, null, 1, ?)"
                    + " on conflict (id) do update set"
                    + " counter = case when server_state.expires_at <= ? then 1 else server_state.counter + 1 end,"
                    + " expires_at = case when server_state.expires_at <= ? then excluded.expires_at else server_state.expires_at end"
                    + " returning counter", Long.class, id, expires, now, now);
            return n == null ? 1 : n;
        }
        String bump = "update server_state set counter = case when expires_at <= ? then 1 else counter + 1 end,"
                + " expires_at = case when expires_at <= ? then ? else expires_at end where id = ?";
        if (jdbc.update(bump, now, now, expires, id) == 0) {
            try {
                jdbc.update("insert into server_state (id, val, counter, expires_at) values (?, null, 1, ?)", id, expires);
            } catch (DuplicateKeyException e) {
                jdbc.update(bump, now, now, expires, id);
            }
        }
        return counter(kind, key);
    }

    public long counter(String kind, String key) {
        List<Long> rows = jdbc.queryForList("select counter from server_state where id = ? and expires_at > ?", Long.class,
                id(kind, key), ts(Instant.now()));
        return rows.isEmpty() ? 0 : rows.get(0);
    }

    // 매일 새벽 만료된 행을 지운다 (없는 것으로 치므로 안 지워도 동작은 같다 — 표가 커지지 않게 할 뿐)
    @Scheduled(cron = "0 30 4 * * *", zone = "Asia/Seoul")
    public void purgeExpired() {
        jdbc.update("delete from server_state where expires_at <= ?", ts(Instant.now()));
    }
}
