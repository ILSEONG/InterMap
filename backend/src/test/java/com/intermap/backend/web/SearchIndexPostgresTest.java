package com.intermap.backend.web;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

// 실제 PostgreSQL에서만 — trigram 인덱스(SchemaPatch)와 조회용 인덱스가 만들어지는지.
// 가게 검색 자체는 restaurant/RestaurantSearchPostgresTest가 본다.
@EnabledIfEnvironmentVariable(named = "PG_TEST_URL", matches = ".+")
@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=update")
class SearchIndexPostgresTest {

    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("PG_TEST_URL"));
    }

    @Autowired JdbcTemplate jdbc;

    @Test
    void indexesExist() {
        List<String> names = jdbc.queryForList("select indexname from pg_indexes where schemaname = current_schema()", String.class);
        for (String expected : List.of("idx_restaurant_name_trgm", "idx_app_user_nickname_trgm",
                "idx_review_author_created", "idx_review_photo_review", "idx_follow_followee")) {
            assertTrue(names.contains(expected), expected + " 인덱스가 없다: " + names);
        }
        String def = jdbc.queryForObject("select indexdef from pg_indexes where indexname = 'idx_restaurant_name_trgm'", String.class);
        assertTrue(def.contains("upper((name)::text) gin_trgm_ops"), def);
    }
}
