package com.intermap.backend.web;

import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 실제 PostgreSQL에서만 — 검색용 trigram 인덱스(SchemaPatch)와 조회용 인덱스가 만들어지고, 검색이 그대로 되는지.
@EnabledIfEnvironmentVariable(named = "PG_TEST_URL", matches = ".+")
@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=update")
class SearchIndexPostgresTest {

    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("PG_TEST_URL"));
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired RestaurantRepository restaurants;

    @Test
    void indexesExistAndSearchStillWorks() {
        List<String> names = jdbc.queryForList("select indexname from pg_indexes where schemaname = current_schema()", String.class);
        for (String expected : List.of("idx_restaurant_name_trgm", "idx_app_user_nickname_trgm",
                "idx_review_author_created", "idx_review_photo_review", "idx_follow_followee")) {
            assertTrue(names.contains(expected), expected + " 인덱스가 없다: " + names);
        }
        // 인덱스 식(upper(name))이 검색 쿼리가 쓰는 식과 같아야 인덱스를 탄다
        String def = jdbc.queryForObject("select indexdef from pg_indexes where indexname = 'idx_restaurant_name_trgm'", String.class);
        assertTrue(def.contains("upper((name)::text) gin_trgm_ops"), def);

        Restaurant saved = restaurants.save(new Restaurant("트라이그램 Test 식당", "한식", "서울 중구 검색길 1", "서울 중구 검색동 1", 37.5, 127.0));
        try {
            List<Restaurant> found = restaurants.findTop50ByStatusAndNameContainingIgnoreCase(Restaurant.Status.OPEN, "그램 test");
            assertEquals(1, found.stream().filter(r -> r.getId().equals(saved.getId())).count());
        } finally {
            restaurants.delete(saved);
        }
    }
}
