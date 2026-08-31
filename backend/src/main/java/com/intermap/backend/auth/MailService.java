package com.intermap.backend.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Map;

// Brevo HTTP API로 발송한다. Render 무료 티어가 SMTP 포트(25/465/587)를 막아서 SMTP는 못 쓴다.
@Service
public class MailService {

    private static final Logger log = LoggerFactory.getLogger(MailService.class);
    private static final String BREVO_URL = "https://api.brevo.com/v3/smtp/email";

    private final RestClient client = RestClient.create();
    private final String apiKey;
    private final String from;

    public MailService(@Value("${brevo.api-key}") String apiKey, @Value("${mail.from}") String from) {
        this.apiKey = apiKey;
        this.from = from;
    }

    public void sendVerificationCode(String email, String code) {
        if (apiKey.isBlank()) {
            // BREVO_API_KEY 미설정 — 개발 중엔 로그로만 확인
            log.info("[이메일 인증번호] {} -> {}", email, code);
            return;
        }
        client.post()
            .uri(BREVO_URL)
            .header("api-key", apiKey)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of(
                "sender", Map.of("email", from, "name", "인터맵"),
                "to", List.of(Map.of("email", email)),
                "subject", "[인터맵] 이메일 인증번호",
                "textContent", "인증번호: " + code + "\n5분 안에 입력해주세요."))
            .retrieve()
            .toBodilessEntity();
        log.info("[이메일 인증번호] {} 발송 완료", email);
    }
}
