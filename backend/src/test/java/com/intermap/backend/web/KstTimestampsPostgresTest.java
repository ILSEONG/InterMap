package com.intermap.backend.web;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;

// 실제 PostgreSQL에서만 의미가 있다 — CI(backend-test.yml)가 PG_TEST_URL로 띄운 DB에 붙는다. 로컬(H2)에선 건너뛴다.
@EnabledIfEnvironmentVariable(named = "PG_TEST_URL", matches = ".+")
@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=create-drop")
class KstTimestampsPostgresTest {

    private static final DateTimeFormatter MINUTE = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("PG_TEST_URL"));
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    AppUserRepository users;

    @Autowired
    KstTimestamps kst;

    @Test
    void 엔티티_시각은_한국시간_벽시계로_저장되고_그대로_읽힌다() {
        AppUser user = new AppUser("kst@test.local", null, "kst-test", null);
        user.agree(false);
        AppUser saved = users.saveAndFlush(user);
        Instant agreed = saved.getTermsAgreedAt().truncatedTo(ChronoUnit.MICROS);

        String type = jdbc.queryForObject("SELECT data_type FROM information_schema.columns"
                + " WHERE table_schema = current_schema() AND table_name = 'app_user' AND column_name = 'terms_agreed_at'", String.class);
        assertEquals("timestamp without time zone", type);

        String raw = jdbc.queryForObject("SELECT to_char(terms_agreed_at, 'YYYY-MM-DD HH24:MI:SS') FROM app_user WHERE id = ?",
                String.class, saved.getId());
        assertEquals(LocalDateTime.ofInstant(agreed, ZoneId.of("Asia/Seoul")).format(MINUTE), raw);

        Instant back = users.findById(saved.getId()).orElseThrow().getTermsAgreedAt();
        assertEquals(agreed, back.truncatedTo(ChronoUnit.MICROS));
        users.deleteById(saved.getId());
    }

    @Test
    void 예전_timestamptz_칸은_한국시간으로_옮겨진다() {
        jdbc.execute("DROP TABLE IF EXISTS kst_probe");
        jdbc.execute("CREATE TABLE kst_probe (id int, at timestamptz)");
        jdbc.execute("INSERT INTO kst_probe VALUES (1, '2026-11-10 08:00:00+00')");

        kst.run(null);

        String type = jdbc.queryForObject("SELECT data_type FROM information_schema.columns"
                + " WHERE table_schema = current_schema() AND table_name = 'kst_probe' AND column_name = 'at'", String.class);
        assertEquals("timestamp without time zone", type);
        assertEquals("2026-11-10 17:00:00",
                jdbc.queryForObject("SELECT to_char(at, 'YYYY-MM-DD HH24:MI:SS') FROM kst_probe WHERE id = 1", String.class));
        jdbc.execute("DROP TABLE kst_probe");
    }
}
