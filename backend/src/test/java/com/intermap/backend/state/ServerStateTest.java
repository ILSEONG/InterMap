package com.intermap.backend.state;

import com.intermap.backend.auth.DailyLimits;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 서버 상태 저장소 — 인증번호·로그인 진행 상태·횟수 제한이 서버 메모리가 아니라 DB에 남는다
@SpringBootTest
@Transactional
class ServerStateTest {

    record Sample(String name, long at) {
    }

    @Autowired ServerState state;
    @Autowired DailyLimits limits;
    @Autowired JdbcTemplate jdbc;

    static void exercise(ServerState state, JdbcTemplate jdbc) {
        String key = "k-" + UUID.randomUUID();

        // 값: 넣고, 바꾸고, 지운다
        assertTrue(state.get("t", key).isEmpty());
        state.put("t", key, "one", Duration.ofMinutes(5));
        assertEquals(Optional.of("one"), state.get("t", key));
        state.put("t", key, "two", Duration.ofMinutes(5));
        assertEquals(Optional.of("two"), state.get("t", key));
        assertTrue(state.get("other", key).isEmpty(), "종류가 다르면 다른 값");
        state.remove("t", key);
        assertTrue(state.get("t", key).isEmpty());

        // 만료된 값은 없는 것으로 친다. 같은 키에 다시 넣을 수 있다
        state.put("t", key, "old", Duration.ofSeconds(-1));
        assertTrue(state.get("t", key).isEmpty());
        state.put("t", key, "new", Duration.ofMinutes(5));
        assertEquals(Optional.of("new"), state.get("t", key));

        // 한 번만 꺼낸다
        assertEquals(Optional.of("new"), state.take("t", key));
        assertTrue(state.take("t", key).isEmpty());

        // JSON
        state.put("t", key, new Sample("이름", 42L), Duration.ofMinutes(5));
        assertEquals(new Sample("이름", 42L), state.get("t", key, Sample.class).orElseThrow());
        assertEquals(new Sample("이름", 42L), state.take("t", key, Sample.class).orElseThrow());

        // 횟수: 1부터 오르고, 만료되면 다시 1부터
        Instant later = Instant.now().plusSeconds(300);
        assertEquals(0, state.counter("n", key));
        assertEquals(1, state.increment("n", key, later));
        assertEquals(2, state.increment("n", key, later));
        assertEquals(3, state.increment("n", key, later));
        assertEquals(3, state.counter("n", key));
        String gone = "g-" + UUID.randomUUID();
        assertEquals(1, state.increment("n", gone, Instant.now().minusSeconds(1)));
        assertEquals(0, state.counter("n", gone), "만료된 횟수는 0");
        assertEquals(1, state.increment("n", gone, later), "만료 뒤엔 1부터 다시");
        assertEquals(2, state.increment("n", gone, later));

        // 종류별 개수, 만료된 행 지우기
        String kind = "c-" + UUID.randomUUID().toString().substring(0, 8);
        state.put(kind, "a", "1", Duration.ofMinutes(5));
        state.put(kind, "b", "1", Duration.ofMinutes(5));
        state.put(kind, "c", "1", Duration.ofSeconds(-1));
        assertEquals(2, state.count(kind));
        state.purgeExpired();
        assertEquals(2, jdbc.queryForObject("select count(*) from server_state where id like ?", Long.class, kind + ":%"));

        // 원래 키(이메일 등)는 표에 그대로 남지 않는다
        state.put("t", "someone@example.com", "x", Duration.ofMinutes(5));
        assertEquals(0, jdbc.queryForObject("select count(*) from server_state where id like '%example.com%'", Long.class));
    }

    @Test
    void storesValuesAndCounters() {
        exercise(state, jdbc);
    }

    @Test
    void dailyLimitCountsInTheDatabase() {
        String key = "test:" + UUID.randomUUID();
        assertFalse(limits.exceeded(key, 2));
        assertFalse(limits.exceeded(key, 2));
        assertTrue(limits.exceeded(key, 2), "세 번째부터 넘는다");
        // 서버가 다시 켜진 셈 — 새로 만든 DailyLimits도 같은 횟수를 이어서 센다
        assertTrue(new DailyLimits(state).exceeded(key, 2));
    }
}
