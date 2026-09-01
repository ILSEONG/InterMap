package com.intermap.backend.auth;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

// ddl-auto=update 는 기존 컬럼의 NOT NULL 을 풀어주지 않는다. 소셜(카카오) 가입은 이메일이 없을 수 있어
// 시작 시 직접 푼다. H2/PostgreSQL 모두 같은 문법이고 이미 nullable 이면 그대로 지나간다.
@Component
public class SchemaPatch implements ApplicationRunner {

    private final JdbcTemplate jdbc;

    public SchemaPatch(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        jdbc.execute("ALTER TABLE app_user ALTER COLUMN email DROP NOT NULL");
    }
}
