package com.intermap.backend.storage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.io.IOException;
import java.util.Collection;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

// 사진(후기 사진·프로필 사진) 바이트를 두는 곳 — Cloudflare R2.
// DB에는 위치(key)만 남기고, 사진 주소(/api/photos/…, /api/users/…/avatar)는 그대로라 앱은 바뀐 줄 모른다.
// R2 설정이 없으면 꺼져 있고, 그때는 예전처럼 DB에 바이트를 넣는다 (로컬 개발·테스트).
@Component
public class PhotoStore {

    private static final Logger log = LoggerFactory.getLogger(PhotoStore.class);

    // null이면 꺼짐
    private final S3Client client;

    // R2에서 받은 바이트를 잠깐 들고 있는다 (최근에 쓴 것부터 남긴다). 위치(key)는 올릴 때마다 새로 만들고
    // 내용을 덮어쓰지 않으므로, 같은 위치면 언제나 같은 사진이다. 여러 사람이 같은 사진을 볼 때 R2를 다시 다녀오지 않는다.
    // 힙이 256MB라 작게 잡는다
    private static final long CACHE_MAX_BYTES = 16L << 20;
    private final LinkedHashMap<String, byte[]> cache = new LinkedHashMap<>(64, 0.75f, true);
    private long cachedBytes;

    public PhotoStore(@Value("${r2.account-id:}") String accountId,
                      @Value("${r2.access-key-id:}") String accessKey,
                      @Value("${r2.secret-access-key:}") String secretKey,
                      @Value("${r2.bucket:}") String bucket,
                      @Value("${r2.endpoint:}") String endpoint) {
        String base = !endpoint.isBlank() ? endpoint.trim()
                : accountId.isBlank() ? "" : "https://" + accountId.trim() + ".r2.cloudflarestorage.com";
        boolean on = !base.isEmpty() && !accessKey.isBlank() && !secretKey.isBlank() && !bucket.isBlank();
        this.client = on ? new S3Client(base, bucket.trim(), accessKey.trim(), secretKey.trim()) : null;
        log.info(on ? "사진 저장소: R2" : "사진 저장소: DB (R2 설정이 없어요)");
    }

    public boolean enabled() {
        return client != null;
    }

    // 올리고 위치(key)를 돌려준다. 꺼져 있거나 올리지 못하면 null — 부르는 쪽이 바이트를 DB에 둔다
    // (나중에 PhotoOffload가 옮긴다). 그래서 R2가 잠깐 안 돼도 사진 올리기는 된다.
    // 트랜잭션 안에서 불렸는데 그 트랜잭션이 되돌려지면 올린 것도 지운다.
    public String save(String folder, String contentType, byte[] data) {
        if (client == null) return null;
        String key = folder + '/' + UUID.randomUUID().toString().replace("-", "");
        try {
            client.put(key, contentType, data);
        } catch (IOException | RuntimeException e) {
            log.warn("사진을 R2에 올리지 못해 DB에 둡니다: {}", e.getMessage());
            return null;
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCompletion(int status) {
                    if (status != STATUS_COMMITTED) delete(key);
                }
            });
        }
        return key;
    }

    // 못 받으면 null (없거나 R2가 응답하지 않음)
    public byte[] load(String key) {
        if (client == null) return null;
        byte[] hit = cached(key);
        if (hit != null) return hit;
        try {
            byte[] data = client.get(key);
            if (data != null) remember(key, data);
            return data;
        } catch (IOException | RuntimeException e) {
            log.warn("사진을 R2에서 받지 못했어요: {}", e.getMessage());
            return null;
        }
    }

    private synchronized byte[] cached(String key) {
        return cache.get(key);
    }

    private synchronized void remember(String key, byte[] data) {
        if (data.length > CACHE_MAX_BYTES / 8) return;
        byte[] previous = cache.put(key, data);
        cachedBytes += data.length - (previous == null ? 0 : previous.length);
        Iterator<Map.Entry<String, byte[]>> oldest = cache.entrySet().iterator();
        while (cachedBytes > CACHE_MAX_BYTES && oldest.hasNext()) {
            cachedBytes -= oldest.next().getValue().length;
            oldest.remove();
        }
    }

    private synchronized void forget(String key) {
        byte[] previous = cache.remove(key);
        if (previous != null) cachedBytes -= previous.length;
    }

    // 테스트용: 들고 있던 바이트를 버린다
    synchronized void clearCache() {
        cache.clear();
        cachedBytes = 0;
    }

    // DB에서 행을 지운 뒤에 부른다. 트랜잭션 안이면 커밋된 다음에 지운다 — 되돌려졌는데 사진만 사라지지 않게.
    // 지우지 못한 것은 R2에 남는다 (주소를 아는 행이 없어 보이지는 않는다).
    public void deleteAfterCommit(Collection<String> keys) {
        if (client == null || keys.isEmpty()) return;
        List<String> targets = List.copyOf(keys);
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    targets.forEach(PhotoStore.this::delete);
                }
            });
        } else {
            targets.forEach(this::delete);
        }
    }

    private void delete(String key) {
        forget(key);
        try {
            client.delete(key);
        } catch (IOException | RuntimeException e) {
            log.warn("R2에서 사진을 지우지 못했어요: {}", e.getMessage());
        }
    }
}
