package com.intermap.backend.push;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 아이폰 푸시 알림 발송 — Apple 푸시 서버(APNs)에 직접 보낸다 (HTTP/2, 토큰 인증).
 *
 * 안드로이드는 Firebase(PushService)로 보내지만, 아이폰 앱에는 Firebase를 넣지 않았다 — 앱이 주는 기기 토큰이
 * Apple의 토큰 그대로라, 서버가 Apple 키(.p8)로 서명한 토큰을 들고 Apple에 바로 보내면 된다.
 *
 * 필요한 값 (Render 환경변수): APNS_KEY(.p8 파일 내용), APNS_KEY_ID(키 ID), APNS_TEAM_ID(팀 ID).
 * 하나라도 없으면 아이폰으로는 아무것도 보내지 않는다 (앱 안 알림 목록은 그대로 동작).
 * TestFlight·App Store로 받은 앱은 운영 서버(api.push.apple.com)로 보낸다.
 */
@Component
public class ApnsSender {

    private static final Logger log = LoggerFactory.getLogger(ApnsSender.class);
    // Apple의 기기 토큰은 16진수 — 주소에 그대로 붙이므로 다른 글자가 섞인 값은 보내지 않는다
    private static final Pattern DEVICE_TOKEN = Pattern.compile("[0-9a-fA-F]{32,200}");
    // 서명한 토큰은 1시간까지 쓸 수 있고, 20분 안에 다시 만들면 Apple이 거절한다 — 50분마다 새로 만든다
    private static final Duration TOKEN_LIFE = Duration.ofMinutes(50);

    /** 보낸 결과. GONE = 그 기기가 더는 없다 (앱을 지웠거나 토큰이 바뀜) — 토큰을 지워야 한다 */
    public enum Outcome { SENT, GONE, FAILED }

    public record Result(Outcome outcome, String detail) {
    }

    record Response(int status, String body) {
    }

    private final ObjectMapper mapper = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_2).connectTimeout(Duration.ofSeconds(10)).build();
    private final String keyId;
    private final String teamId;
    private final String topic;
    private final String host;
    private final PrivateKey key;

    private String providerToken;
    private Instant providerTokenAt = Instant.EPOCH;

    public ApnsSender(@Value("${apns.key:}") String key, @Value("${apns.key-id:}") String keyId,
                      @Value("${apns.team-id:}") String teamId, @Value("${apns.topic:com.ilseong.intermap}") String topic,
                      @Value("${apns.host:https://api.push.apple.com}") String host) {
        this.keyId = keyId == null ? "" : keyId.trim();
        this.teamId = teamId == null ? "" : teamId.trim();
        this.topic = topic;
        this.host = host;
        this.key = load(key);
        if (this.key == null) log.info("APNS_KEY 미설정 — 아이폰 푸시 알림을 보내지 않습니다.");
        else if (this.keyId.isEmpty() || this.teamId.isEmpty()) log.warn("APNS_KEY_ID / APNS_TEAM_ID가 비어 있습니다 — 아이폰 푸시 알림을 보내지 않습니다.");
    }

    // .p8 파일 내용을 그대로, 또는 줄바꿈이 "\n" 글자로 들어온 것, 또는 base64로 감싼 것
    private static PrivateKey load(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            String text = raw.trim().replace("\\n", "\n");
            if (!text.contains("BEGIN")) {
                String decoded = new String(Base64.getDecoder().decode(text.replaceAll("\\s", "")), StandardCharsets.UTF_8);
                if (decoded.contains("BEGIN")) text = decoded;
            }
            String body = text.replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", "");
            return KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(body)));
        } catch (Exception e) {
            // 키 내용은 로그에 남기지 않는다
            log.warn("APNS_KEY를 읽지 못했습니다 — 아이폰 푸시 알림을 보내지 않습니다. ({})", e.getClass().getSimpleName());
            return null;
        }
    }

    public boolean isConfigured() {
        return key != null && !keyId.isEmpty() && !teamId.isEmpty();
    }

    /** 기기 하나에 알림을 보낸다. 부르는 쪽(PushService)의 발송 스레드에서만 부른다 */
    public Result send(String deviceToken, String title, String body, Map<String, String> data) {
        if (!isConfigured()) return new Result(Outcome.FAILED, "설정 없음");
        if (deviceToken == null || !DEVICE_TOKEN.matcher(deviceToken).matches()) return new Result(Outcome.GONE, "토큰 형식");
        try {
            String json = payload(title, body, data);
            Response response = post(deviceToken, providerToken(Instant.now()), json);
            // 서명한 토큰이 낡았다고 하면 새로 만들어 한 번 더
            if (response.status() == 403 && "ExpiredProviderToken".equals(reason(response))) {
                providerToken = null;
                response = post(deviceToken, providerToken(Instant.now()), json);
            }
            if (response.status() == 200) return new Result(Outcome.SENT, "");
            String reason = reason(response);
            // 410 = 그 토큰은 이제 없다. 400의 이 두 가지도 이 앱의 토큰이 아니라는 뜻 — 다시 보내 봐야 소용없다
            if (response.status() == 410 || "BadDeviceToken".equals(reason) || "DeviceTokenNotForTopic".equals(reason) || "Unregistered".equals(reason)) {
                return new Result(Outcome.GONE, reason);
            }
            return new Result(Outcome.FAILED, "HTTP " + response.status() + (reason.isEmpty() ? "" : " " + reason));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Result(Outcome.FAILED, "중단됨");
        } catch (Exception e) {
            return new Result(Outcome.FAILED, e.getClass().getSimpleName());
        }
    }

    // Apple이 알려 준 실패 이유 ({"reason":"BadDeviceToken"}) — 기기 토큰이나 키는 들어 있지 않다
    private String reason(Response response) {
        try {
            JsonNode root = mapper.readTree(response.body() == null || response.body().isBlank() ? "{}" : response.body());
            return root.path("reason").asText("");
        } catch (Exception e) {
            return "";
        }
    }

    // 알림 내용. data(type, reviewId …)는 aps 옆에 나란히 실린다 — 앱이 알림을 눌렀을 때 받는다
    String payload(String title, String body, Map<String, String> data) throws Exception {
        Map<String, Object> alert = new LinkedHashMap<>();
        alert.put("title", title);
        if (body != null && !body.isEmpty()) alert.put("body", body);
        Map<String, Object> aps = new LinkedHashMap<>();
        aps.put("alert", alert);
        aps.put("sound", "default");
        Map<String, Object> root = new LinkedHashMap<>();
        if (data != null) data.forEach((k, v) -> {
            if (!"aps".equals(k)) root.put(k, v);
        });
        root.put("aps", aps);
        return mapper.writeValueAsString(root);
    }

    // Apple 키로 서명한 토큰 (JWT, ES256). 만든 지 50분이 넘으면 새로 만든다
    String providerToken(Instant now) throws Exception {
        if (providerToken != null && now.isBefore(providerTokenAt.plus(TOKEN_LIFE))) return providerToken;
        Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();
        String header = b64.encodeToString(("{\"alg\":\"ES256\",\"kid\":\"" + keyId + "\"}").getBytes(StandardCharsets.UTF_8));
        String claims = b64.encodeToString(("{\"iss\":\"" + teamId + "\",\"iat\":" + now.getEpochSecond() + "}").getBytes(StandardCharsets.UTF_8));
        String unsigned = header + "." + claims;
        // JWT의 ES256 서명은 R과 S를 이어 붙인 64바이트 (자바 기본값인 DER 꼴이 아니다)
        Signature signer = Signature.getInstance("SHA256withECDSAinP1363Format");
        signer.initSign(key);
        signer.update(unsigned.getBytes(StandardCharsets.UTF_8));
        providerToken = unsigned + "." + b64.encodeToString(signer.sign());
        providerTokenAt = now;
        return providerToken;
    }

    // Apple에 실제로 보내는 곳 — 테스트는 이 메서드를 갈아 끼운다
    Response post(String deviceToken, String jwt, String json) throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create(host + "/3/device/" + deviceToken))
                .timeout(Duration.ofSeconds(15))
                .header("authorization", "bearer " + jwt)
                .header("apns-topic", topic)
                .header("apns-push-type", "alert")
                .header("apns-priority", "10")
                // 기기가 꺼져 있으면 하루까지 기다렸다 전해 준다
                .header("apns-expiration", String.valueOf(Instant.now().plus(Duration.ofDays(1)).getEpochSecond()))
                .header("content-type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        return new Response(response.statusCode(), response.body());
    }
}
