package com.intermap.backend.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.web.filter.ShallowEtagHeaderFilter;

import java.io.IOException;

// API 조회(GET) 응답에 ETag를 붙인다. 앱(WebView)·브라우저는 같은 주소를 다시 부를 때 If-None-Match로 이 값을 보내고,
// 내용이 그대로면 서버는 본문 없이 304만 돌려준다 — 후기·댓글 목록처럼 큰 응답을 매번 다시 받지 않는다.
// Cache-Control을 따로 정하지 않은 응답은 "private, no-cache" — 기기에만 두고, 쓰기 전에 꼭 서버에 바뀌었는지 묻게 한다.
// 사진·프로필 사진은 주소가 바뀌지 않는 한 내용도 안 바뀌어 1년 캐시를 따로 쓰므로 빼고, 로그인 리다이렉트도 뺀다.
@Configuration
public class ApiEtagFilter {

    static final String DEFAULT_CACHE_CONTROL = "private, no-cache";

    @Bean
    FilterRegistrationBean<Filter> apiEtag() {
        FilterRegistrationBean<Filter> bean = new FilterRegistrationBean<>(new Filter());
        bean.addUrlPatterns("/api/*");
        return bean;
    }

    public static class Filter extends ShallowEtagHeaderFilter {

        @Override
        protected boolean shouldNotFilter(HttpServletRequest request) {
            String path = request.getRequestURI().substring(request.getContextPath().length());
            return !"GET".equals(request.getMethod())
                    || path.startsWith("/api/photos/")
                    || path.startsWith("/api/auth/oauth/")
                    || path.matches("/api/users/[^/]+/avatar");
        }

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            super.doFilterInternal(request, response, (req, res) -> {
                chain.doFilter(req, res);
                // 본문은 아직 버퍼에 있어 헤더를 더 붙일 수 있다
                HttpServletResponse r = (HttpServletResponse) res;
                if (!r.containsHeader(HttpHeaders.CACHE_CONTROL)) r.setHeader(HttpHeaders.CACHE_CONTROL, DEFAULT_CACHE_CONTROL);
                // 같은 주소라도 로그인한 사람마다 내용이 다르다
                r.addHeader(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION);
            });
        }
    }
}
