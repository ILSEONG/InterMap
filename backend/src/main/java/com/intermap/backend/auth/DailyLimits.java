package com.intermap.backend.auth;

import com.intermap.backend.state.ServerState;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneId;

// 하루 횟수 상한 (인증번호 발송, 후기·댓글·신고 같은 쓰기). 날짜(KST)가 바뀌면 0부터 다시 센다.
// 횟수는 DB(ServerState)에 둔다 — 서버가 다시 켜져도 그날 센 것이 남고, 서버가 여러 대여도 같이 센다.
@Component
public class DailyLimits {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final String KIND = "limit";

    private final ServerState state;

    public DailyLimits(ServerState state) {
        this.state = state;
    }

    // 이번 요청까지 세어 limit을 넘으면 true
    public boolean exceeded(String key, int limit) {
        LocalDate today = LocalDate.now(KST);
        // 오늘 자정(KST)에 만료 — 그 뒤 첫 요청이 1부터 다시 센다
        return state.increment(KIND, key, today.plusDays(1).atStartOfDay(KST).toInstant()) > limit;
    }
}
