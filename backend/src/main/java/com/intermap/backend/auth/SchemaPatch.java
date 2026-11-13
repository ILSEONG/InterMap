package com.intermap.backend.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

// ddl-auto=update 가 해 주지 않는 스키마 손질을 서버 시작 때 직접 한다.
@Component
public class SchemaPatch implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SchemaPatch.class);

    private final JdbcTemplate jdbc;

    public SchemaPatch(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        // update 는 기존 컬럼의 NOT NULL 을 풀어주지 않는다. 소셜(카카오) 가입은 이메일이 없을 수 있어 직접 푼다.
        // H2/PostgreSQL 모두 같은 문법이고 이미 nullable 이면 그대로 지나간다.
        jdbc.execute("ALTER TABLE app_user ALTER COLUMN email DROP NOT NULL");
        searchIndexes();
    }

    // 가게·닉네임 검색은 "가운데 포함"(upper(name) like '%검색어%')이라 보통 인덱스를 못 타고 테이블 전체를 훑는다.
    // PostgreSQL의 trigram(GIN) 인덱스는 이런 검색을 받아 준다 — 가게가 10만 행을 넘어 효과가 크다.
    // 검색어가 3글자 이상일 때 듣고, 2글자 검색은 예전처럼 훑는다. JPA로는 선언할 수 없어 여기서 만든다.
    // 실패해도(권한·확장 미지원) 검색은 예전 방식으로 그대로 되므로 서버 시작을 막지 않는다.
    private void searchIndexes() {
        try {
            String product = jdbc.execute((ConnectionCallback<String>) c -> c.getMetaData().getDatabaseProductName());
            if (product == null || !product.toLowerCase().contains("postgres")) return;
            jdbc.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm");
            jdbc.execute("CREATE INDEX IF NOT EXISTS idx_restaurant_name_trgm ON restaurant USING gin (upper(name) gin_trgm_ops)");
            jdbc.execute("CREATE INDEX IF NOT EXISTS idx_app_user_nickname_trgm ON app_user USING gin (upper(nickname) gin_trgm_ops)");
        } catch (Exception e) {
            log.warn("검색용 trigram 인덱스를 만들지 못했어요 — 검색은 예전 방식으로 동작합니다. ({})", e.getMessage());
        }
    }
}
