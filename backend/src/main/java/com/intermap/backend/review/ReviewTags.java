package com.intermap.backend.review;

import java.util.Arrays;
import java.util.List;

/**
 * 카페 후기에 고르는 꼬리표 — 어떤 때 가기 좋은 곳인지 (작업·공부 / 수다 / 디저트 / 커피 맛 / 분위기).
 * 코드는 앱(lib/cafe.ts)과 같다. 후기에는 고른 코드를 쉼표로 이어 적는다 ("WORK,MOOD").
 */
final class ReviewTags {

    static final List<String> CODES = List.of("WORK", "TALK", "SWEETS", "TASTE", "MOOD");

    private ReviewTags() {
    }

    /** 요청에 온 것 가운데 아는 코드만, 정해진 순서로, 겹치지 않게. 하나도 없으면 null */
    static String store(List<String> requested) {
        if (requested == null) return null;
        List<String> picked = CODES.stream().filter(code -> requested.stream().anyMatch(r -> r != null && code.equals(r.trim()))).toList();
        return picked.isEmpty() ? null : String.join(",", picked);
    }

    /** 적어 둔 것을 코드 목록으로. 없으면 빈 목록 */
    static List<String> read(String stored) {
        if (stored == null || stored.isBlank()) return List.of();
        return Arrays.stream(stored.split(",")).map(String::trim).filter(CODES::contains).toList();
    }
}
