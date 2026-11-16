package com.intermap.backend.storage;

import com.intermap.backend.auth.UserAvatarRepository;
import com.intermap.backend.review.ReviewPhotoRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Arrays;
import java.util.List;

// 바이트가 DB에 있는 사진을 R2로 옮긴다 — R2를 켜기 전에 올라온 사진과, R2가 안 돼서 DB에 둔 사진.
// 한 장씩 올리고, 다시 받아 같은지 확인한 다음에야 DB의 바이트를 비운다. 서버 시작을 막지 않게 뒤에서 돈다.
// 다 옮겨지면 매번 빈 목록만 보고 끝난다.
@Component
public class PhotoOffload implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(PhotoOffload.class);

    private final PhotoStore store;
    private final ReviewPhotoRepository photos;
    private final UserAvatarRepository avatars;
    private final TransactionTemplate tx;

    public PhotoOffload(PhotoStore store, ReviewPhotoRepository photos, UserAvatarRepository avatars,
                        TransactionTemplate tx) {
        this.store = store;
        this.photos = photos;
        this.avatars = avatars;
        this.tx = tx;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!store.enabled()) return;
        Thread worker = new Thread(this::move, "photo-offload");
        worker.setDaemon(true);
        worker.start();
    }

    // 한 번에 하나만 돈다 — 같은 사진을 두 번 올리지 않게
    synchronized void move() {
        int moved = 0;
        try {
            List<Long> photoIds = photos.idsInDatabase();
            List<Long> avatarIds = avatars.idsInDatabase();
            if (photoIds.isEmpty() && avatarIds.isEmpty()) return;
            log.info("사진을 R2로 옮깁니다: 후기 사진 {}장, 프로필 사진 {}장", photoIds.size(), avatarIds.size());
            for (Long id : photoIds) {
                // 엔티티를 고쳐 두면 트랜잭션이 끝날 때 저장된다. 그사이 지워졌거나 이미 옮겨졌으면 건너뛴다
                moved += tx.execute(s -> photos.findById(id).filter(p -> p.getStorageKey() == null).map(p -> {
                    p.movedTo(upload("reviews", p.getContentType(), p.getData()));
                    return 1;
                }).orElse(0));
            }
            for (Long id : avatarIds) {
                moved += tx.execute(s -> avatars.findById(id).filter(a -> a.getStorageKey() == null).map(a -> {
                    a.movedTo(upload("avatars", a.getContentType(), a.getData()));
                    return 1;
                }).orElse(0));
            }
            log.info("사진 {}장을 R2로 옮겼어요. DB에 남은 사진: {}장", moved,
                    photos.idsInDatabase().size() + avatars.idsInDatabase().size());
        } catch (RuntimeException e) {
            // R2나 DB가 잠깐 안 될 때 — 옮기지 못한 사진은 DB에 그대로 있고, 다음 시작 때 이어서 옮긴다
            log.warn("사진 옮기기 중단 ({}장 옮김): {}", moved, e.getMessage());
        }
    }

    // 올린 것을 다시 받아 원본과 같을 때만 위치를 돌려준다. DB의 바이트를 비우면 되돌릴 수 없어서 확인한다.
    // 실패하면 예외 — 트랜잭션이 되돌려지고(PhotoStore가 올린 것을 지운다) 옮기기를 멈춘다.
    private String upload(String folder, String contentType, byte[] data) {
        String key = store.save(folder, contentType, data);
        if (key == null) throw new IllegalStateException("R2에 올리지 못했어요");
        if (!Arrays.equals(data, store.load(key))) throw new IllegalStateException("R2에 올린 사진이 원본과 달라요");
        return key;
    }
}
