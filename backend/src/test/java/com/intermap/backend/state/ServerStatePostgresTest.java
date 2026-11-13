package com.intermap.backend.state;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

// 실제 PostgreSQL에서만 — 운영 DB가 PostgreSQL이고, 넣기·횟수 올리기는 PostgreSQL 전용 문장(on conflict)을 쓴다.
@EnabledIfEnvironmentVariable(named = "PG_TEST_URL", matches = ".+")
@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=update")
class ServerStatePostgresTest {

    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("PG_TEST_URL"));
    }

    @Autowired ServerState state;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transactions;

    @Test
    void storesValuesAndCounters() {
        ServerStateTest.exercise(state, jdbc);
    }

    // 트랜잭션 안에서 같은 키를 다시 넣거나 올려도 트랜잭션이 깨지지 않는다 (중복 키 오류를 내지 않는 문장이어야 한다)
    @Test
    void repeatedWritesInsideOneTransaction() {
        String key = "tx-" + UUID.randomUUID();
        Long count = transactions.execute(status -> {
            state.put("t", key, "a", java.time.Duration.ofMinutes(5));
            state.put("t", key, "b", java.time.Duration.ofMinutes(5));
            state.increment("n", key, Instant.now().plusSeconds(60));
            state.increment("n", key, Instant.now().plusSeconds(60));
            return jdbc.queryForObject("select count(*) from server_state", Long.class);
        });
        assertEquals("b", state.get("t", key).orElseThrow());
        assertEquals(2, state.counter("n", key));
        assertEquals(true, count != null && count >= 2);
        state.remove("t", key);
        state.remove("n", key);
    }
}
