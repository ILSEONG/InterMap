package com.intermap.backend.storage;

import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.assertEquals;

// AWS 문서 "Signature Calculations for the Authorization Header: Transferring Payload in a Single Chunk"의
// 예제 요청과 서명 값. 이 값이 그대로 나오면 서명 계산이 규격과 같다.
class S3SignerTest {

    private static final String ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
    private static final String SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    private static final String DATE = "20130524T000000Z";
    private static final String SCOPE = "Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request";

    @Test
    void getObjectMatchesTheDocumentedSignature() {
        String empty = S3Signer.sha256Hex(new byte[0]);
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", empty);
        TreeMap<String, String> headers = new TreeMap<>();
        headers.put("host", "examplebucket.s3.amazonaws.com");
        headers.put("range", "bytes=0-9");
        headers.put("x-amz-content-sha256", empty);
        headers.put("x-amz-date", DATE);

        String authorization = S3Signer.authorization("GET", URI.create("https://examplebucket.s3.amazonaws.com/test.txt"),
                headers, empty, ACCESS_KEY, SECRET_KEY, "us-east-1", DATE);

        assertEquals("AWS4-HMAC-SHA256 " + SCOPE + ", SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, "
                + "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41", authorization);
    }

    @Test
    void putObjectMatchesTheDocumentedSignature() {
        String payloadHash = S3Signer.sha256Hex("Welcome to Amazon S3.".getBytes(StandardCharsets.UTF_8));
        TreeMap<String, String> headers = new TreeMap<>();
        headers.put("date", "Fri, 24 May 2013 00:00:00 GMT");
        headers.put("host", "examplebucket.s3.amazonaws.com");
        headers.put("x-amz-content-sha256", payloadHash);
        headers.put("x-amz-date", DATE);
        headers.put("x-amz-storage-class", "REDUCED_REDUNDANCY");

        String authorization = S3Signer.authorization("PUT",
                URI.create("https://examplebucket.s3.amazonaws.com/test%24file.text"),
                headers, payloadHash, ACCESS_KEY, SECRET_KEY, "us-east-1", DATE);

        assertEquals("AWS4-HMAC-SHA256 " + SCOPE
                + ", SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, "
                + "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd", authorization);
    }
}
