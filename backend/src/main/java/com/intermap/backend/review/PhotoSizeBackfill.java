package com.intermap.backend.review;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;

// 크기 컬럼이 생기기 전에 올라간 사진에 원본 크기를 채운다.
// 사진을 한 장씩 읽으므로 서버 시작을 막지 않게 뒤에서 돈다. 다 채워지면 매번 빈 목록만 보고 끝난다.
@Component
public class PhotoSizeBackfill implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(PhotoSizeBackfill.class);

    private final ReviewPhotoRepository photos;
    private final TransactionTemplate tx;

    public PhotoSizeBackfill(ReviewPhotoRepository photos, TransactionTemplate tx) {
        this.photos = photos;
        this.tx = tx;
    }

    @Override
    public void run(ApplicationArguments args) {
        Thread worker = new Thread(this::fill, "photo-size-backfill");
        worker.setDaemon(true);
        worker.start();
    }

    void fill() {
        try {
            List<Long> ids = photos.idsWithoutSize();
            for (Long id : ids) {
                // 엔티티를 고쳐 두면 트랜잭션이 끝날 때 저장된다
                tx.executeWithoutResult(s -> photos.findById(id).ifPresent(p -> p.setSize(PhotoSize.of(p.getData()))));
            }
            if (!ids.isEmpty()) log.info("사진 크기 {}장 채움", ids.size());
        } catch (RuntimeException e) {
            // 서버가 꺼지는 중이거나 DB가 잠깐 안 될 때 — 다음 시작 때 이어서 채운다
            log.warn("사진 크기 채우기 중단: {}", e.getMessage());
        }
    }
}
