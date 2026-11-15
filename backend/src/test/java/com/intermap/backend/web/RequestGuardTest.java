package com.intermap.backend.web;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 요청 제한 — IP별로 세고, 로그인 쪽은 더 빡빡하고, 큰 JSON은 받지 않는다
class RequestGuardTest {

    private static MockHttpServletRequest request(String method, String uri, String ip) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.addHeader("CF-Connecting-IP", ip);
        return request;
    }

    private static boolean pass(RequestGuard guard, MockHttpServletRequest request) throws Exception {
        return guard.preHandle(request, new MockHttpServletResponse(), new Object());
    }

    @Test
    void limitsPerIpPerMinute() throws Exception {
        RequestGuard guard = new RequestGuard(3, 2);
        for (int i = 0; i < 3; i++) assertTrue(pass(guard, request("GET", "/api/reviews", "1.1.1.1")));

        MockHttpServletResponse blocked = new MockHttpServletResponse();
        assertFalse(guard.preHandle(request("GET", "/api/reviews", "1.1.1.1"), blocked, new Object()));
        assertEquals(429, blocked.getStatus());
        assertEquals("60", blocked.getHeader("Retry-After"));

        // 다른 IP는 영향 없다. 사전 요청(OPTIONS)은 세지 않는다
        assertTrue(pass(guard, request("GET", "/api/reviews", "2.2.2.2")));
        assertTrue(pass(guard, request("OPTIONS", "/api/reviews", "1.1.1.1")));
    }

    @Test
    void authWritesHaveATighterLimit() throws Exception {
        RequestGuard guard = new RequestGuard(100, 2);
        assertTrue(pass(guard, request("POST", "/api/auth/login", "3.3.3.3")));
        assertTrue(pass(guard, request("POST", "/api/auth/email-code", "3.3.3.3")));
        assertFalse(pass(guard, request("POST", "/api/auth/login", "3.3.3.3")));
        // 조회는 일반 한도만 본다 — 하지만 이미 로그인 쪽 한도를 넘긴 IP도 조회는 된다
        assertTrue(pass(guard, request("GET", "/api/auth/me", "3.3.3.3")));
    }

    @Test
    void oversizedJsonIsRejected() throws Exception {
        RequestGuard guard = new RequestGuard(100, 100);
        MockHttpServletRequest big = request("POST", "/api/comments", "4.4.4.4");
        big.setContentType("application/json");
        big.setContent(new byte[(int) RequestGuard.MAX_JSON_BYTES + 1]);
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertFalse(guard.preHandle(big, response, new Object()));
        assertEquals(413, response.getStatus());

        MockHttpServletRequest ok = request("POST", "/api/comments", "4.4.4.4");
        ok.setContentType("application/json");
        ok.setContent(new byte[100]);
        assertTrue(pass(guard, ok));
    }
}
