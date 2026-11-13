package com.intermap.backend.ops;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// 바깥 서비스(메일·푸시·간편 로그인) 호출이 되고 있는지 — 관측 화면이 읽는다.
// 이름별로 성공·실패 횟수와 마지막 오류를 든다. 메일 발송이 막히면 가입이 통째로 멈추는데,
// 이게 없으면 누가 알려 주기 전까지 모른다.
@Component
public class ExternalCalls {

    public record Stat(String name, long ok, long fail, Instant lastOkAt, Instant lastFailAt, String lastError) {
    }

    public static final String MAIL = "mail";
    public static final String PUSH = "push";
    // 간편 로그인은 "login:네이버" 처럼 provider를 붙인다
    public static final String LOGIN = "login:";

    private static final class State {
        long ok;
        long fail;
        Instant lastOkAt;
        Instant lastFailAt;
        String lastError;
    }

    private final Map<String, State> states = new ConcurrentHashMap<>();

    public void ok(String name) {
        State s = states.computeIfAbsent(name, k -> new State());
        synchronized (s) {
            s.ok++;
            s.lastOkAt = Instant.now();
        }
    }

    public void fail(String name, Throwable error) {
        fail(name, error == null ? "" : error.getClass().getSimpleName() + ": " + error.getMessage());
    }

    public void fail(String name, String detail) {
        State s = states.computeIfAbsent(name, k -> new State());
        synchronized (s) {
            s.fail++;
            s.lastFailAt = Instant.now();
            s.lastError = ErrorLog.clean(detail, 300);
        }
    }

    public List<Stat> stats() {
        List<Stat> out = new ArrayList<>();
        for (Map.Entry<String, State> e : states.entrySet()) {
            State s = e.getValue();
            synchronized (s) {
                out.add(new Stat(e.getKey(), s.ok, s.fail, s.lastOkAt, s.lastFailAt, s.lastError));
            }
        }
        out.sort((a, b) -> a.name().compareTo(b.name()));
        return out;
    }
}
