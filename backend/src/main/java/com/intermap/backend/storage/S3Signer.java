package com.intermap.backend.storage;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.SortedMap;

// S3 호환 저장소(Cloudflare R2)에 보내는 요청의 서명 (AWS Signature Version 4).
// AWS SDK를 붙이면 수십 MB가 따라와 256MB 힙에 부담이라, 올리기·받기·지우기에 필요한 만큼만 직접 만든다.
// AWS 문서의 예제 값으로 맞는지 확인한다 (S3SignerTest).
final class S3Signer {

    private S3Signer() {
    }

    // Authorization 헤더 값. headers = 서명에 넣을 헤더 (이름은 소문자, host·x-amz-content-sha256·x-amz-date 포함).
    // 주소에 ?쿼리는 쓰지 않는다 (객체 하나를 올리고·받고·지우는 요청뿐).
    static String authorization(String method, URI uri, SortedMap<String, String> headers, String payloadHash,
                                String accessKey, String secretKey, String region, String amzDate) {
        StringBuilder canonicalHeaders = new StringBuilder();
        for (Map.Entry<String, String> h : headers.entrySet()) {
            canonicalHeaders.append(h.getKey()).append(':').append(h.getValue().trim()).append('\n');
        }
        String signedHeaders = String.join(";", headers.keySet());
        String canonicalRequest = method + '\n'
                + uri.getRawPath() + '\n'
                + '\n'
                + canonicalHeaders + '\n'
                + signedHeaders + '\n'
                + payloadHash;
        String day = amzDate.substring(0, 8);
        String scope = day + '/' + region + "/s3/aws4_request";
        String stringToSign = "AWS4-HMAC-SHA256\n" + amzDate + '\n' + scope + '\n' + sha256Hex(bytes(canonicalRequest));
        byte[] key = hmac(bytes("AWS4" + secretKey), day);
        key = hmac(key, region);
        key = hmac(key, "s3");
        key = hmac(key, "aws4_request");
        String signature = HexFormat.of().formatHex(hmac(key, stringToSign));
        return "AWS4-HMAC-SHA256 Credential=" + accessKey + '/' + scope
                + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
    }

    static String sha256Hex(byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] hmac(byte[] key, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(bytes(data));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] bytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }
}
