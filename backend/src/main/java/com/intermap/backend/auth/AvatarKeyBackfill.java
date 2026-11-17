package com.intermap.backend.auth;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

// 키가 생기기 전에 올라온 프로필 사진에 키를 채운다 (review/PhotoKeyBackfill과 같은 일).
// 다 채워지면 빈 목록만 보고 끝난다.
@Component
public class AvatarKeyBackfill implements ApplicationRunner {

    private final UserAvatarRepository avatars;

    public AvatarKeyBackfill(UserAvatarRepository avatars) {
        this.avatars = avatars;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        for (Long userId : avatars.idsWithoutKey()) {
            avatars.setKey(userId, UserAvatar.newKey());
        }
    }
}
