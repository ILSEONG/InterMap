package com.intermap.backend.web;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;

// 스토어에 등록한 주소로 그대로 공개되는 문서들 — 확인을 기다리며 비워 둔 자리가 남은 채로 나가지 않게 한다
class PolicyPagesTest {

    @Test
    void publishedPagesHaveNoUnfinishedText() throws IOException {
        for (String page : List.of("privacy.html", "terms.html", "account-deletion.html")) {
            try (InputStream in = getClass().getResourceAsStream("/static/" + page)) {
                assertNotNull(in, page);
                String text = new String(in.readAllBytes(), StandardCharsets.UTF_8);
                assertFalse(text.contains("TO_CONFIRM"), page + "에 아직 확인하지 못해 비워 둔 자리가 있어요");
            }
        }
    }
}
