package com.intermap.backend.web;

import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Duration;

// 바깥 서비스(메일·푸시·간편 로그인 등)를 부르는 HTTP 클라이언트 — 타임아웃을 건다.
// RestClient.create()는 타임아웃이 없어서, 상대가 응답 없이 연결만 붙잡고 있으면 요청을 처리하던 스레드가 끝없이 묶인다.
// 몇 개만 그렇게 묶여도 서버 전체가 멈춘 것처럼 보인다.
public final class Http {

    private Http() {
    }

    // 연결 5초, 응답 15초 — 사용자가 기다리는 요청 안에서 부르는 호출의 기본값
    public static RestClient client() {
        return client(Duration.ofSeconds(5), Duration.ofSeconds(15));
    }

    public static RestClient client(Duration connect, Duration read) {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(connect).build());
        factory.setReadTimeout(read);
        return RestClient.builder().requestFactory(factory).build();
    }
}
