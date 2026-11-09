package com.intermap.backend.web;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import jakarta.servlet.FilterChain;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 조회 응답에 ETag가 붙고, 같은 값을 들고 다시 오면 본문 없이 304
class ApiEtagFilterTest {

    private final ApiEtagFilter.Filter filter = new ApiEtagFilter.Filter();

    private MockHttpServletResponse get(String path, String ifNoneMatch, String body) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("GET", path);
        req.setRequestURI(path);
        if (ifNoneMatch != null) req.addHeader("If-None-Match", ifNoneMatch);
        MockHttpServletResponse res = new MockHttpServletResponse();
        FilterChain chain = (rq, rs) -> {
            rs.setContentType("application/json");
            rs.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        };
        filter.doFilter(req, res, chain);
        return res;
    }

    @Test
    void sameBodyAnswers304() throws Exception {
        MockHttpServletResponse first = get("/api/reviews", null, "[{\"id\":1}]");
        assertEquals(200, first.getStatus());
        String etag = first.getHeader("ETag");
        assertNotNull(etag);
        assertEquals("private, no-cache", first.getHeader("Cache-Control"));
        assertTrue(first.getHeaders("Vary").contains("Authorization"));

        MockHttpServletResponse again = get("/api/reviews", etag, "[{\"id\":1}]");
        assertEquals(304, again.getStatus());
        assertEquals(0, again.getContentAsByteArray().length);

        MockHttpServletResponse changed = get("/api/reviews", etag, "[{\"id\":1},{\"id\":2}]");
        assertEquals(200, changed.getStatus(), "내용이 바뀌면 새 본문");
    }

    @Test
    void photosKeepTheirOwnCaching() throws Exception {
        MockHttpServletResponse photo = get("/api/photos/3/abc", null, "jpeg-bytes");
        assertNull(photo.getHeader("ETag"));
        assertNull(photo.getHeader("Cache-Control"));
    }
}
