package com.intermap.backend.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;

// 휴대폰 인증번호를 카카오 알림톡으로 발송한다 (NCP SENS Bizmessage API).
// NCP 콘솔에서 SENS 프로젝트 + 카카오톡 채널 연동 + #{code} 변수 포함 템플릿 승인이 끝나야 실제로 나간다.
@Service
public class AlimtalkService {

    private static final Logger log = LoggerFactory.getLogger(AlimtalkService.class);
    private static final String HOST = "https://sens.apigw.ntruss.com";

    private final RestClient restClient = RestClient.create(HOST);
    private final String accessKey;
    private final String secretKey;
    private final String serviceId;
    private final String plusFriendId;
    private final String templateCode;
    private final boolean configured;

    public AlimtalkService(
        @Value("${ncp.sens.access-key}") String accessKey,
        @Value("${ncp.sens.secret-key}") String secretKey,
        @Value("${ncp.sens.service-id}") String serviceId,
        @Value("${ncp.sens.plus-friend-id}") String plusFriendId,
        @Value("${ncp.sens.template-code}") String templateCode
    ) {
        this.accessKey = accessKey;
        this.secretKey = secretKey;
        this.serviceId = serviceId;
        this.plusFriendId = plusFriendId;
        this.templateCode = templateCode;
        this.configured = !accessKey.isBlank() && !secretKey.isBlank() && !serviceId.isBlank()
                && !plusFriendId.isBlank() && !templateCode.isBlank();
    }

    public void sendVerificationCode(String phone, String code) {
        if (!configured) {
            // NCP_SENS_* 미설정 — 개발 중엔 로그로만 확인
            log.info("[휴대폰 인증번호] {} -> {}", phone, code);
            return;
        }
        String path = "/alimtalk/v2/services/" + serviceId + "/messages";
        String timestamp = String.valueOf(System.currentTimeMillis());

        restClient.post()
            .uri(path)
            .header("Content-Type", "application/json; charset=UTF-8")
            .header("x-ncp-apigw-timestamp", timestamp)
            .header("x-ncp-iam-access-key", accessKey)
            .header("x-ncp-apigw-signature-v2", sign(path, timestamp))
            .body(Map.of(
                "plusFriendId", plusFriendId,
                "templateCode", templateCode,
                "messages", List.of(Map.of(
                    "to", phone,
                    "content", "[인터맵] 인증번호 " + code + "를 5분 안에 입력해주세요.",
                    "templateParameter", Map.of("code", code)
                ))
            ))
            .retrieve()
            .toBodilessEntity();
    }

    private String sign(String path, String timestamp) {
        try {
            String message = "POST " + path + "\n" + timestamp + "\n" + accessKey;
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secretKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return Base64.getEncoder().encodeToString(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("알림톡 서명 생성 실패", e);
        }
    }
}
