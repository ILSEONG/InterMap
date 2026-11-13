package com.intermap.backend.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import com.intermap.backend.web.Http;
import org.springframework.web.client.RestClient;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

// 휴대폰 인증번호를 SMS로 발송한다 (SOLAPI). 개인 계정도 휴대폰 본인인증만 하면 발신번호 등록이 된다.
// 카카오 알림톡·NCP SENS는 사업자 계정이 필요해서 쓰지 않는다.
@Service
public class SmsService {

    private static final Logger log = LoggerFactory.getLogger(SmsService.class);
    private static final String SEND_URL = "https://api.solapi.com/messages/v4/send";

    private final RestClient restClient = Http.client();
    private final String apiKey;
    private final String apiSecret;
    private final String from;
    private final boolean configured;

    public SmsService(
        @Value("${solapi.api-key}") String apiKey,
        @Value("${solapi.api-secret}") String apiSecret,
        @Value("${solapi.from}") String from
    ) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.from = from;
        this.configured = !apiKey.isBlank() && !apiSecret.isBlank() && !from.isBlank();
    }

    public void sendVerificationCode(String phone, String code) {
        if (!configured) {
            // SOLAPI_* 미설정 — 개발 중엔 로그로만 확인
            log.info("[휴대폰 인증번호] {} -> {}", phone, code);
            return;
        }
        restClient.post()
            .uri(SEND_URL)
            .header("Authorization", authorization())
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("message", Map.of(
                "to", phone,
                "from", from,
                "text", "[인터맵] 인증번호 " + code + "를 5분 안에 입력해주세요."
            )))
            .retrieve()
            .toBodilessEntity();
        log.info("[휴대폰 인증번호] {} 발송 완료", phone);
    }

    // HMAC-SHA256(date + salt, apiSecret) — https://developers.solapi.com/references/authentication
    private String authorization() {
        String date = Instant.now().toString();
        String salt = UUID.randomUUID().toString().replace("-", "");
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(apiSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            String signature = HexFormat.of().formatHex(mac.doFinal((date + salt).getBytes(StandardCharsets.UTF_8)));
            return "HMAC-SHA256 apiKey=" + apiKey + ", date=" + date + ", salt=" + salt + ", signature=" + signature;
        } catch (Exception e) {
            throw new IllegalStateException("SMS 서명 생성 실패", e);
        }
    }
}
