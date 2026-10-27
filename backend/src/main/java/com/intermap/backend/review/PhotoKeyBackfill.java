package com.intermap.backend.review;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

// accessKey 컬럼이 생기기 전에 올라간 사진에 키를 채운다. 다 채워지면 매번 빈 목록만 보고 지나간다.
@Component
public class PhotoKeyBackfill implements ApplicationRunner {

    private final ReviewPhotoRepository photos;

    public PhotoKeyBackfill(ReviewPhotoRepository photos) {
        this.photos = photos;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        for (Long id : photos.idsWithoutKey()) {
            photos.setKey(id, ReviewPhoto.newKey());
        }
    }
}
