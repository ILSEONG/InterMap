package com.intermap.backend.web;

import org.junit.jupiter.api.Test;
import org.springframework.web.cors.CorsConfiguration;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

// 아이폰 앱의 화면 주소는 capacitor://intermap.app:8443 (capacitor.config.ts의 hostname에 포트가 붙어 있다).
// 컨트롤러들의 @CrossOrigin 목록에 이 주소가 그대로 들어 있어야 아이폰 앱의 API 호출이 막히지 않는다.
class IosOriginCorsTest {

    @Test
    void iosAppOriginWithPortIsAllowed() {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOriginPatterns(List.of("https://intermap.app:8443", "capacitor://intermap.app", "capacitor://intermap.app:8443"));

        assertEquals("capacitor://intermap.app:8443", cors.checkOrigin("capacitor://intermap.app:8443"));
        assertNull(cors.checkOrigin("capacitor://evil.example:8443"));
    }

    @Test
    void portlessPatternAloneDoesNotCoverIt() {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOriginPatterns(List.of("capacitor://intermap.app"));

        assertNull(cors.checkOrigin("capacitor://intermap.app:8443"), "포트가 붙은 주소는 따로 허용해야 한다");
    }
}
