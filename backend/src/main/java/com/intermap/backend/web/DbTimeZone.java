package com.intermap.backend.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * DB 시간을 한국시간(Asia/Seoul)으로 보이게 한다.
 * 시간 칸은 전부 timestamptz(절대 시각)라 저장 값은 그대로고, DB 기본 시간대만 바꿔
 * Neon 콘솔 등에서 조회하면 "+09" 한국시간으로 나온다.
 * 시간대 없는 timestamp 칸이 하나라도 있으면 기본 시간대를 바꿀 때 그 칸의 읽고 쓰는 값이 9시간 밀리므로 건드리지 않는다.
 * PostgreSQL에서만, 이미 Asia/Seoul이면 그냥 지나간다.
 */
@Component
public class DbTimeZone implements ApplicationRunner {

    static final String ZONE = "Asia/Seoul";
    private static final Logger log = LoggerFactory.getLogger(DbTimeZone.class);

    private final JdbcTemplate jdbc;

    public DbTimeZone(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        try {
            String product = jdbc.execute((java.sql.Connection c) -> c.getMetaData().getDatabaseProductName());
            if (product == null || !product.toLowerCase().contains("postgres")) return;

            String db = jdbc.queryForObject("SELECT current_database()", String.class);
            String current = jdbc.queryForObject(
                    "SELECT COALESCE((SELECT option_value FROM pg_db_role_setting s, pg_options_to_table(s.setconfig)"
                            + " WHERE s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())"
                            + " AND s.setrole = 0 AND lower(option_name) = 'timezone'), '')",
                    String.class);
            if (ZONE.equalsIgnoreCase(current)) return;

            List<String> naive = jdbc.queryForList(
                    "SELECT table_name || '.' || column_name FROM information_schema.columns"
                            + " WHERE table_schema = current_schema() AND data_type = 'timestamp without time zone'",
                    String.class);
            if (!naive.isEmpty()) {
                log.warn("DB 시간대를 {}로 바꾸지 않음 — 시간대 없는 timestamp 칸이 있어 값이 밀릴 수 있음: {}", ZONE, naive);
                return;
            }

            jdbc.execute("ALTER DATABASE \"" + db.replace("\"", "\"\"") + "\" SET timezone TO '" + ZONE + "'");
            log.info("DB {} 기본 시간대를 {}로 설정 (저장 값은 그대로, 조회 시 한국시간으로 표시)", db, ZONE);
        } catch (RuntimeException e) {
            // 권한이 없거나 해도 앱 동작엔 영향이 없다 — 남기기만 한다
            log.warn("DB 시간대 설정 실패: {}", e.getMessage());
        }
    }
}
