package com.intermap.backend.auth;

import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// 하루 횟수 상한 (인증번호 발송, 후기·댓글·신고 같은 쓰기). 날짜(KST)가 바뀌면 통째로 비운다.
// 단일 인스턴스 전제라 메모리로 충분 — 재시작하면 초기화된다.
@Component
public class DailyLimits {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    // 키를 마구 바꿔 보내 메모리를 채우는 걸 막는다. 이만큼 쌓이면 새 키는 그날 전부 막힌다.
    private static final int MAX_KEYS = 50_000;

    private final Map<String, Integer> counts = new ConcurrentHashMap<>();
    private volatile LocalDate day = LocalDate.now(KST);

    // 이번 요청까지 세어 limit을 넘으면 true
    public boolean exceeded(String key, int limit) {
        LocalDate today = LocalDate.now(KST);
        if (!today.equals(day)) {
            counts.clear();
            day = today;
        }
        if (counts.size() >= MAX_KEYS && !counts.containsKey(key)) return true;
        return counts.merge(key, 1, Integer::sum) > limit;
    }
}
