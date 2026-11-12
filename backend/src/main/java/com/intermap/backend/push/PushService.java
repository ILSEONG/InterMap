package com.intermap.backend.push;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.intermap.backend.auth.AppUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// 푸시 알림 발송 (Firebase Cloud Messaging HTTP v1). 서비스 계정 키(FCM_SERVICE_ACCOUNT)가 없으면 아무것도 보내지 않는다.
// 알림은 요청을 처리하는 스레드가 아니라 뒤에서 따로 보낸다 — FCM이 느리거나 죽어도 댓글·팔로우는 그대로 끝난다.
@Service
public class PushService {

    private static final Logger log = LoggerFactory.getLogger(PushService.class);
    private static final String SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
    // 앱이 만들어 두는 알림 채널 (frontend lib/push.ts와 같은 이름)
    static final String CHANNEL = "intermap";
    static final int MAX_BODY = 120;

    private final PushTokenRepository tokens;
    private final ObjectMapper mapper = new ObjectMapper();
    private final RestClient http = RestClient.create();
    private final ExecutorService sender = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "push-sender");
        t.setDaemon(true);
        return t;
    });

    private final boolean configured;
    private String projectId;
    private String clientEmail;
    private String tokenUri;
    private PrivateKey privateKey;

    // 구글 OAuth 액세스 토큰 — 1시간짜리라 만료 1분 전까지 다시 쓴다 (sender 스레드에서만 만진다)
    private String accessToken;
    private Instant accessTokenExpiry = Instant.EPOCH;

    public PushService(PushTokenRepository tokens, @Value("${fcm.service-account:}") String serviceAccount) {
        this.tokens = tokens;
        this.configured = load(serviceAccount);
    }

    // Firebase 콘솔에서 받은 서비스 계정 JSON을 그대로, 또는 base64로 감싸 넣는다 (줄바꿈이 깨지는 환경용)
    private boolean load(String raw) {
        if (raw == null || raw.isBlank()) {
            log.info("FCM_SERVICE_ACCOUNT 미설정 — 푸시 알림을 보내지 않습니다.");
            return false;
        }
        try {
            String json = raw.trim();
            if (!json.startsWith("{")) json = new String(Base64.getDecoder().decode(json), StandardCharsets.UTF_8);
            JsonNode root = mapper.readTree(json);
            projectId = root.path("project_id").asText();
            clientEmail = root.path("client_email").asText();
            tokenUri = root.path("token_uri").asText("https://oauth2.googleapis.com/token");
            String pem = root.path("private_key").asText()
                    .replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replaceAll("\\s", "");
            privateKey = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));
            if (projectId.isBlank() || clientEmail.isBlank()) throw new IllegalArgumentException("project_id / client_email 없음");
            return true;
        } catch (Exception e) {
            // 키 내용은 로그에 남기지 않는다
            log.warn("FCM_SERVICE_ACCOUNT를 읽지 못했습니다 — 푸시 알림을 보내지 않습니다. ({})", e.getClass().getSimpleName());
            return false;
        }
    }

    public boolean isConfigured() {
        return configured;
    }

    // to의 모든 기기로 알림을 보낸다. data는 앱이 알림을 눌렀을 때 받는 값 (문자열만).
    // 진행 중인 트랜잭션이 있으면 커밋된 뒤에 보낸다 — 저장이 취소됐는데 알림만 가는 일이 없게.
    public void send(AppUser to, String title, String body, Map<String, String> data) {
        if (!configured || to == null) return;
        List<String> targets = tokens.tokensOf(to);
        if (targets.isEmpty()) return;
        String text = body == null ? "" : body.strip();
        String shortBody = text.length() > MAX_BODY ? text.substring(0, MAX_BODY - 1) + "…" : text;
        Runnable task = () -> {
            for (String target : targets) deliver(target, title, shortBody, data);
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    sender.submit(task);
                }
            });
        } else {
            sender.submit(task);
        }
    }

    private void deliver(String target, String title, String body, Map<String, String> data) {
        try {
            Map<String, Object> notification = new LinkedHashMap<>();
            notification.put("title", title);
            if (!body.isEmpty()) notification.put("body", body);
            Map<String, Object> message = new LinkedHashMap<>();
            message.put("token", target);
            message.put("notification", notification);
            if (data != null && !data.isEmpty()) message.put("data", data);
            message.put("android", Map.of("priority", "high", "notification", Map.of("channel_id", CHANNEL)));
            http.post()
                    .uri("https://fcm.googleapis.com/v1/projects/" + projectId + "/messages:send")
                    .header("Authorization", "Bearer " + accessToken())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(mapper.writeValueAsString(Map.of("message", message)))
                    .retrieve()
                    .toBodilessEntity();
        } catch (RestClientResponseException e) {
            // 앱을 지웠거나 토큰이 바뀐 기기 — 더 보내지 않게 지운다
            String response = e.getResponseBodyAsString();
            if (e.getStatusCode().value() == 404 || response.contains("UNREGISTERED")) {
                tokens.deleteByTokenValue(target);
            } else {
                log.warn("푸시 발송 실패: HTTP {}", e.getStatusCode().value());
            }
        } catch (Exception e) {
            log.warn("푸시 발송 실패: {}", e.getClass().getSimpleName());
        }
    }

    // 서비스 계정으로 서명한 JWT를 구글에 내고 액세스 토큰을 받는다 (RFC 7523)
    private String accessToken() throws Exception {
        Instant now = Instant.now();
        if (accessToken != null && now.isBefore(accessTokenExpiry.minusSeconds(60))) return accessToken;
        Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("iss", clientEmail);
        claims.put("scope", SCOPE);
        claims.put("aud", tokenUri);
        claims.put("iat", now.getEpochSecond());
        claims.put("exp", now.getEpochSecond() + 3600);
        String unsigned = b64.encodeToString("{\"alg\":\"RS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8))
                + "." + b64.encodeToString(mapper.writeValueAsBytes(claims));
        Signature signer = Signature.getInstance("SHA256withRSA");
        signer.initSign(privateKey);
        signer.update(unsigned.getBytes(StandardCharsets.UTF_8));
        String jwt = unsigned + "." + b64.encodeToString(signer.sign());
        String form = "grant_type=" + URLEncoder.encode("urn:ietf:params:oauth:grant-type:jwt-bearer", StandardCharsets.UTF_8)
                + "&assertion=" + jwt;
        String response = http.post().uri(tokenUri)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .retrieve()
                .body(String.class);
        JsonNode root = mapper.readTree(response);
        accessToken = root.path("access_token").asText();
        accessTokenExpiry = now.plusSeconds(root.path("expires_in").asLong(3600));
        return accessToken;
    }
}
