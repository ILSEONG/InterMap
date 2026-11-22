package com.intermap.backend.restaurant;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

// 가게 검색 — 운영과 같은 PostgreSQL에서 (글 잇기·대문자·escape가 H2와 다르게 굴지 않는지)
@EnabledIfEnvironmentVariable(named = "PG_TEST_URL", matches = ".+")
@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=update")
class RestaurantSearchPostgresTest extends RestaurantSearchChecks {

    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("PG_TEST_URL"));
    }
}
