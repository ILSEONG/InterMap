package com.intermap.backend.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.util.List;
import java.util.Map;

/**
 * DB 시간을 한국시간으로 저장한다 (PostgreSQL).
 * 1) 예전 timestamptz 칸을 시간대 없는 timestamp로 바꾸며 값을 한국시간 벽시계로 옮긴다
 *    (08:00+00 → 17:00). 한 번 바꾸면 timestamptz 칸이 없어 다음부터는 아무것도 안 한다.
 * 2) DB 기본 시간대를 Asia/Seoul로 — 콘솔에서 now() 등도 한국시간으로 보인다.
 * 새로 쓰는 값은 Hibernate 설정(application.properties의 preferred_instant_jdbc_type / jdbc.time_zone)이 한국시간으로 넣는다.
 */
@Component
public class KstTimestamps implements ApplicationRunner {

    static final String ZONE = "Asia/Seoul";
    private static final Logger log = LoggerFactory.getLogger(KstTimestamps.class);

    private final JdbcTemplate jdbc;

    public KstTimestamps(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        String product = jdbc.execute((Connection c) -> c.getMetaData().getDatabaseProductName());
        if (product == null || !product.toLowerCase().contains("postgres")) return;

        List<Map<String, Object>> columns = jdbc.queryForList(
                "SELECT table_name, column_name FROM information_schema.columns"
                        + " WHERE table_schema = current_schema() AND data_type = 'timestamp with time zone'"
                        + " ORDER BY table_name, column_name");
        for (Map<String, Object> col : columns) {
            String table = quote((String) col.get("table_name"));
            String column = quote((String) col.get("column_name"));
            jdbc.execute("ALTER TABLE " + table + " ALTER COLUMN " + column
                    + " TYPE timestamp(6) without time zone USING " + column + " AT TIME ZONE '" + ZONE + "'");
            log.info("{}.{} → 한국시간 timestamp", table, column);
        }

        try {
            String db = jdbc.queryForObject("SELECT current_database()", String.class);
            jdbc.execute("ALTER DATABASE " + quote(db) + " SET timezone TO '" + ZONE + "'");
        } catch (RuntimeException e) {
            // 권한이 없어도 저장 값에는 영향이 없다 (콘솔 표시 시간대만)
            log.warn("DB 기본 시간대 설정 실패: {}", e.getMessage());
        }
    }

    private static String quote(String identifier) {
        return "\"" + identifier.replace("\"", "\"\"") + "\"";
    }
}
