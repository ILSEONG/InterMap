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
                "textContent", "인증번호: " + code + "\n5분 안에 입력해주세요.",
                "htmlContent", html(code)))
            .retrieve()
            .toBodilessEntity();
        log.info("[이메일 인증번호] {} 발송 완료", email);
    }

    // 메일 클라이언트 호환을 위해 table + inline style만 쓴다. 워드마크 색은 프론트 Header와 동일.
    private static String html(String code) {
        String[] colors = {"#ff5d73", "#ff7a45", "#2fbfa6", "#8b6bff"};
        StringBuilder wordmark = new StringBuilder();
        String brand = "인터맵";
        for (int i = 0; i < brand.length(); i++) {
            wordmark.append("<span style=\"color:").append(colors[i % colors.length]).append("\">")
                    .append(brand.charAt(i)).append("</span>");
        }
        StringBuilder digits = new StringBuilder();
        for (char c : code.toCharArray()) {
            digits.append("<td style=\"padding:0 5px\"><div style=\"width:48px;height:48px;line-height:48px;")
                  .append("background:#f1f1f1;border-radius:10px;font-size:26px;font-weight:700;color:#444;")
                  .append("text-align:center\">").append(c).append("</div></td>");
        }
        return "<div style=\"background:#f2f3f5;padding:32px 12px;font-family:-apple-system,BlinkMacSystemFont,"
            + "'Apple SD Gothic Neo','Malgun Gothic',sans-serif\">"
            + "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px;width:100%;"
            + "margin:0 auto;background:#fff;border-radius:16px\"><tr><td style=\"padding:40px 36px\">"
            + "<div style=\"font-size:22px;font-weight:800;letter-spacing:.02em\">" + wordmark + "</div>"
            + "<h1 style=\"margin:28px 0 12px;font-size:24px;font-weight:500;color:#222\">인터맵 인증 코드</h1>"
            + "<p style=\"margin:0 0 24px;font-size:15px;color:#333\">요청하신 화면에 아래 인증 코드를 "
            + "<b>5분</b> 내로 입력해 주세요.</p>"
            + "<hr style=\"border:0;border-top:1px solid #ddd;margin:0 0 28px\">"
            + "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:0 auto\"><tr>"
            + digits + "</tr></table>"
            + "<p style=\"margin:28px 0 0;font-size:12px;color:#888\">본인이 요청하지 않았다면 이 메일은 무시해 주세요.</p>"
            + "</td></tr></table></div>";
    }
}
