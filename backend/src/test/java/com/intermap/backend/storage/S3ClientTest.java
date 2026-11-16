package com.intermap.backend.storage;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.Random;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class S3ClientTest {

    @Test
    void putsGetsAndDeletesUnderTheBucket() throws IOException {
        try (FakeS3 s3 = new FakeS3()) {
            S3Client client = new S3Client(s3.endpoint() + "/", "bucket", "access", "secret");
            byte[] photo = new byte[900_000];
            new Random(1).nextBytes(photo);

            client.put("reviews/abc123", "image/jpeg", photo);
            assertTrue(s3.objects.containsKey("/bucket/reviews/abc123"), "주소는 /버킷/위치");
            assertArrayEquals(photo, client.get("reviews/abc123"));
            assertNull(client.get("reviews/none"), "없는 것은 null");

            client.delete("reviews/abc123");
            client.delete("reviews/abc123");
            assertNull(client.get("reviews/abc123"));
        }
    }

    @Test
    void failuresSurfaceAsIoException() throws IOException {
        try (FakeS3 s3 = new FakeS3()) {
            S3Client client = new S3Client(s3.endpoint(), "bucket", "access", "secret");
            s3.down = true;
            assertThrows(IOException.class, () -> client.put("reviews/x", "image/jpeg", new byte[]{1}));
            assertThrows(IOException.class, () -> client.get("reviews/x"));
            assertThrows(IOException.class, () -> client.delete("reviews/x"));
        }
        // 아무도 듣지 않는 포트
        S3Client dead = new S3Client("http://127.0.0.1:9", "bucket", "access", "secret");
        assertThrows(IOException.class, () -> dead.get("reviews/x"));
    }
}
