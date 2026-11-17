package com.intermap.backend.storage;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// 테스트용 S3 흉내 — 메모리에 객체를 담고 PUT/GET/DELETE만 받는다. 서명 값은 보지 않고, 붙어 왔는지만 본다.
public final class FakeS3 implements AutoCloseable {

    public final Map<String, byte[]> objects = new ConcurrentHashMap<>();
    // true면 모든 요청에 500 — 저장소가 죽었을 때를 흉내 낸다
    public volatile boolean down;
    // 받기(GET) 요청 수 — 서버가 들고 있던 바이트로 답했는지 볼 때
    public final java.util.concurrent.atomic.AtomicInteger gets = new java.util.concurrent.atomic.AtomicInteger();

    private final HttpServer server;

    public FakeS3() {
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        server.createContext("/", this::handle);
        server.start();
    }

    public String endpoint() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            String path = exchange.getRequestURI().getRawPath();
            byte[] body = exchange.getRequestBody().readAllBytes();
            String auth = exchange.getRequestHeaders().getFirst("Authorization");
            if (down) {
                respond(exchange, 500, new byte[0]);
            } else if (auth == null || !auth.startsWith("AWS4-HMAC-SHA256 Credential=")) {
                respond(exchange, 403, new byte[0]);
            } else if ("PUT".equals(exchange.getRequestMethod())) {
                objects.put(path, body);
                respond(exchange, 200, new byte[0]);
            } else if ("GET".equals(exchange.getRequestMethod())) {
                gets.incrementAndGet();
                byte[] found = objects.get(path);
                respond(exchange, found == null ? 404 : 200, found == null ? new byte[0] : found);
            } else if ("DELETE".equals(exchange.getRequestMethod())) {
                objects.remove(path);
                respond(exchange, 204, new byte[0]);
            } else {
                respond(exchange, 405, new byte[0]);
            }
        }
    }

    private static void respond(HttpExchange exchange, int status, byte[] body) throws IOException {
        // 204는 본문이 없어야 한다 (-1), 그 밖엔 길이를 그대로
        exchange.sendResponseHeaders(status, status == 204 || body.length == 0 ? -1 : body.length);
        if (status != 204 && body.length > 0) exchange.getResponseBody().write(body);
    }

    @Override
    public void close() {
        server.stop(0);
    }
}
