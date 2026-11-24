package com.intermap.backend.push;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 아이폰 푸시(Apple 서버로 직접): 키 읽기, 서명한 토큰, 알림 내용, Apple의 답에 따른 처리.
// 실제 Apple 서버에는 보내지 않는다 — 보내는 부분(post)만 갈아 끼운다.
class ApnsSenderTest {

    private static final String DEVICE = "a1b2c3d4".repeat(8);
    private final ObjectMapper mapper = new ObjectMapper();
    private final KeyPair pair = newKey();
    private final String pem = "-----BEGIN PRIVATE KEY-----\n"
            + Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(pair.getPrivate().getEncoded())
            + "\n-----END PRIVATE KEY-----\n";

    private static KeyPair newKey() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec("secp256r1"));
            return generator.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // Apple 대신 정해 둔 답을 차례로 돌려주고, 무엇을 보냈는지 적어 둔다
    private static class Fake extends ApnsSender {
        final List<String[]> sent = new ArrayList<>();
        final List<Response> answers = new ArrayList<>();

        Fake(String key, String keyId, String teamId) {
            super(key, keyId, teamId, "com.ilseong.intermap", "https://apple.invalid");
        }

        @Override
        Response post(String deviceToken, String jwt, String json) {
            sent.add(new String[]{deviceToken, jwt, json});
            return answers.isEmpty() ? new Response(200, "") : answers.remove(0);
        }
    }

    private Fake sender() {
        return new Fake(pem, "KEYID12345", "TEAMID6789");
    }

    @Test
    void needsKeyAndBothIds() {
        assertTrue(sender().isConfigured());
        assertFalse(new Fake("", "KEYID12345", "TEAMID6789").isConfigured());
        assertFalse(new Fake(pem, "", "TEAMID6789").isConfigured());
        assertFalse(new Fake(pem, "KEYID12345", " ").isConfigured());
        assertFalse(new Fake("키가 아닌 글", "KEYID12345", "TEAMID6789").isConfigured(), "읽을 수 없는 키면 꺼진 것으로");
        // 설정이 없으면 보내지 않는다
        Fake off = new Fake("", "", "");
        assertEquals(ApnsSender.Outcome.FAILED, off.send(DEVICE, "제목", "내용", Map.of()).outcome());
        assertTrue(off.sent.isEmpty());
    }

    // 환경변수에 넣다 보면 줄바꿈이 "\n" 글자로 들어가거나, 통째로 base64로 감싸 넣기도 한다
    @Test
    void readsTheKeyHoweverItWasPasted() {
        assertTrue(new Fake(pem.replace("\n", "\\n"), "K", "T").isConfigured());
        assertTrue(new Fake(Base64.getEncoder().encodeToString(pem.getBytes(StandardCharsets.UTF_8)), "K", "T").isConfigured());
        assertTrue(new Fake(pem.replace("\n", " "), "K", "T").isConfigured(), "한 줄로 붙여 넣어도");
    }

    @Test
    void signsATokenAppleCanVerify() throws Exception {
        Fake sender = sender();
        Instant now = Instant.parse("2026-11-24T12:00:00Z");
        String jwt = sender.providerToken(now);
        String[] parts = jwt.split("\\.");
        assertEquals(3, parts.length);
        JsonNode header = mapper.readTree(Base64.getUrlDecoder().decode(parts[0]));
        JsonNode claims = mapper.readTree(Base64.getUrlDecoder().decode(parts[1]));
        assertEquals("ES256", header.path("alg").asText());
        assertEquals("KEYID12345", header.path("kid").asText());
        assertEquals("TEAMID6789", claims.path("iss").asText());
        assertEquals(now.getEpochSecond(), claims.path("iat").asLong());
        // 서명은 R과 S를 이은 64바이트이고, 짝이 되는 공개 키로 확인된다
        byte[] signature = Base64.getUrlDecoder().decode(parts[2]);
        assertEquals(64, signature.length);
        Signature verifier = Signature.getInstance("SHA256withECDSAinP1363Format");
        verifier.initVerify(pair.getPublic());
        verifier.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.UTF_8));
        assertTrue(verifier.verify(signature));

        // 50분 안에는 같은 토큰을 쓰고 (자주 새로 만들면 Apple이 거절한다), 지나면 새로 만든다
        assertEquals(jwt, sender.providerToken(now.plusSeconds(49 * 60)));
        assertNotEquals(jwt, sender.providerToken(now.plusSeconds(51 * 60)));
    }

    @Test
    void buildsTheNotification() throws Exception {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("type", "COMMENT");
        data.put("reviewId", "42");
        data.put("aps", "덮어쓰기 시도");
        JsonNode root = mapper.readTree(sender().payload("태원이님이 댓글을 남겼어요", "맛있겠다", data));
        assertEquals("태원이님이 댓글을 남겼어요", root.path("aps").path("alert").path("title").asText());
        assertEquals("맛있겠다", root.path("aps").path("alert").path("body").asText());
        assertEquals("default", root.path("aps").path("sound").asText());
        assertEquals("COMMENT", root.path("type").asText());
        assertEquals("42", root.path("reviewId").asText());
        assertTrue(root.path("aps").isObject(), "data가 aps를 덮어쓰지 못한다");
        // 내용이 없으면 제목만
        assertFalse(mapper.readTree(sender().payload("제목만", "", null)).path("aps").path("alert").has("body"));
    }

    @Test
    void readsApplesAnswer() {
        Fake sender = sender();
        assertEquals(ApnsSender.Outcome.SENT, sender.send(DEVICE, "제목", "내용", Map.of("type", "FOLLOW")).outcome());
        assertEquals(DEVICE, sender.sent.get(0)[0]);

        // 앱을 지웠거나 토큰이 바뀐 기기 — 지워야 한다
        sender.answers.add(new ApnsSender.Response(410, "{\"reason\":\"Unregistered\"}"));
        assertEquals(ApnsSender.Outcome.GONE, sender.send(DEVICE, "제목", "내용", Map.of()).outcome());
        sender.answers.add(new ApnsSender.Response(400, "{\"reason\":\"BadDeviceToken\"}"));
        assertEquals(ApnsSender.Outcome.GONE, sender.send(DEVICE, "제목", "내용", Map.of()).outcome());

        // 키·설정 문제 — 토큰은 그대로 두고 이유를 남긴다
        sender.answers.add(new ApnsSender.Response(403, "{\"reason\":\"InvalidProviderToken\"}"));
        ApnsSender.Result failed = sender.send(DEVICE, "제목", "내용", Map.of());
        assertEquals(ApnsSender.Outcome.FAILED, failed.outcome());
        assertEquals("HTTP 403 InvalidProviderToken", failed.detail());
        sender.answers.add(new ApnsSender.Response(503, ""));
        assertEquals("HTTP 503", sender.send(DEVICE, "제목", "내용", Map.of()).detail());
    }

    // 서명한 토큰이 낡았다고 하면 새로 만들어 한 번 더 보낸다
    @Test
    void renewsAnExpiredToken() {
        Fake sender = sender();
        sender.answers.add(new ApnsSender.Response(403, "{\"reason\":\"ExpiredProviderToken\"}"));
        assertEquals(ApnsSender.Outcome.SENT, sender.send(DEVICE, "제목", "내용", Map.of()).outcome());
        assertEquals(2, sender.sent.size());
    }

    // 기기 토큰은 주소에 그대로 붙는다 — 16진수가 아닌 값은 Apple에 보내지 않고 없는 기기로 친다
    @Test
    void refusesTokensThatAreNotAppleTokens() {
        Fake sender = sender();
        for (String bad : new String[]{null, "", "abc", "fcm:토큰_같은-것", DEVICE + "/../../3/device/x", DEVICE + "?a=1"}) {
            assertEquals(ApnsSender.Outcome.GONE, sender.send(bad, "제목", "내용", Map.of()).outcome());
        }
        assertTrue(sender.sent.isEmpty());
    }
}
