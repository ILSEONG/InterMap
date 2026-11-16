package com.intermap.backend.storage;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.TreeMap;

// S3 호환 저장소(Cloudflare R2)에 객체 하나를 올리고·받고·지운다. 주소는 {endpoint}/{bucket}/{key}.
// key는 서버가 만든 값(영문 소문자·숫자·/)만 온다 — 주소에 그대로 넣는다.
final class S3Client {

    private static final DateTimeFormatter AMZ_DATE =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'").withZone(ZoneOffset.UTC);
    // R2는 지역을 쓰지 않지만 서명에는 들어간다 — Cloudflare 문서가 정한 값
    private static final String REGION = "auto";

    private final String base;
    private final String accessKey;
    private final String secretKey;
    // 상대가 응답 없이 연결만 붙잡고 있어도 요청 스레드가 묶이지 않게 타임아웃을 건다 (web/Http.java와 같은 이유)
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    S3Client(String endpoint, String bucket, String accessKey, String secretKey) {
        this.base = endpoint.replaceAll("/+$", "") + '/' + bucket + '/';
        this.accessKey = accessKey;
        this.secretKey = secretKey;
    }

    void put(String key, String contentType, byte[] data) throws IOException {
        expect(send("PUT", key, contentType, data), "올리기", 200);
    }

    // 없으면 null
    byte[] get(String key) throws IOException {
        HttpResponse<byte[]> response = send("GET", key, null, new byte[0]);
        if (response.statusCode() == 404) return null;
        expect(response, "받기", 200);
        return response.body();
    }

    // 이미 없는 것을 지워도 성공으로 본다 (S3 규약: 204)
    void delete(String key) throws IOException {
        expect(send("DELETE", key, null, new byte[0]), "지우기", 204, 200, 404);
    }

    private static void expect(HttpResponse<byte[]> response, String what, int... ok) throws IOException {
        for (int status : ok) {
            if (response.statusCode() == status) return;
        }
        throw new IOException("사진 저장소 " + what + " 실패: HTTP " + response.statusCode());
    }

    private HttpResponse<byte[]> send(String method, String key, String contentType, byte[] body) throws IOException {
        URI uri = URI.create(base + key);
        String payloadHash = S3Signer.sha256Hex(body);
        String amzDate = AMZ_DATE.format(Instant.now());
        TreeMap<String, String> signed = new TreeMap<>();
        // HttpClient가 붙이는 Host와 같은 값이어야 서명이 맞는다
        signed.put("host", uri.getPort() == -1 ? uri.getHost() : uri.getHost() + ':' + uri.getPort());
        signed.put("x-amz-content-sha256", payloadHash);
        signed.put("x-amz-date", amzDate);
        HttpRequest.Builder request = HttpRequest.newBuilder(uri)
                // 사진을 받는 쪽은 화면이 기다린다 — 올리기(20초)보다 짧게
                .timeout(Duration.ofSeconds("GET".equals(method) ? 10 : 20))
                .header("x-amz-content-sha256", payloadHash)
                .header("x-amz-date", amzDate)
                .header("Authorization", S3Signer.authorization(method, uri, signed, payloadHash,
                        accessKey, secretKey, REGION, amzDate))
                .method(method, body.length == 0
                        ? HttpRequest.BodyPublishers.noBody()
                        : HttpRequest.BodyPublishers.ofByteArray(body));
        if (contentType != null) request.header("Content-Type", contentType);
        try {
            return http.send(request.build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("사진 저장소 요청이 중단됨", e);
        }
    }
}
