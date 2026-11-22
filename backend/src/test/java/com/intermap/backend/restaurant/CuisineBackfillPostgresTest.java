package com.intermap.backend.restaurant;

import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

// 가게 업종 채우기 — 운영과 같은 PostgreSQL에서 (묶음 update와 업종별 요약 쿼리가 H2와 다르게 굴지 않는지)
@EnabledIfEnvironmentVariable(named = "PG_TEST_URL", matches = ".+")
@SpringBootTest(properties = "spring.jpa.hibernate.ddl-auto=update")
class CuisineBackfillPostgresTest extends CuisineBackfillTest {

    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("PG_TEST_URL"));
    }
}
