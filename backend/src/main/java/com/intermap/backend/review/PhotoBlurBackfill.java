package com.intermap.backend.review;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;

// blurhash 컬럼이 생기기 전에 올라간 사진에 흐린 미리보기 코드를 채운다.
// 사진을 한 장씩 읽어 계산하므로 서버 시작을 막지 않게 뒤에서 돈다. 다 채워지면 매번 빈 목록만 보고 끝난다.
@Component
public class PhotoBlurBackfill implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(PhotoBlurBackfill.class);

    private final ReviewPhotoRepository photos;
    private final TransactionTemplate tx;

    public PhotoBlurBackfill(ReviewPhotoRepository photos, TransactionTemplate tx) {
        this.photos = photos;
        this.tx = tx;
    }

    @Override
    public void run(ApplicationArguments args) {
        Thread worker = new Thread(this::fill, "photo-blur-backfill");
        worker.setDaemon(true);
        worker.start();
    }

    void fill() {
        try {
            List<Long> ids = photos.idsWithoutBlurhash();
            for (Long id : ids) {
                tx.executeWithoutResult(s -> photos.findById(id)
                        .ifPresent(p -> photos.setBlurhash(id, BlurHash.of(p.getData()))));
            }
            if (!ids.isEmpty()) log.info("흐린 미리보기 코드 {}장 채움", ids.size());
        } catch (RuntimeException e) {
            // 서버가 꺼지는 중이거나 DB가 잠깐 안 될 때 — 다음 시작 때 이어서 채운다
            log.warn("흐린 미리보기 코드 채우기 중단: {}", e.getMessage());
        }
    }
}
