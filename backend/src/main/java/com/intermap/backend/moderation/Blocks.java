package com.intermap.backend.moderation;

import com.intermap.backend.auth.AppUser;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.Set;

// 차단 관계 조회. 차단은 양방향으로 작동한다 — 내가 막았든 상대가 나를 막았든 서로의 글이 안 보인다.
@Component
public class Blocks {

    private final UserBlockRepository blocks;

    public Blocks(UserBlockRepository blocks) {
        this.blocks = blocks;
    }

    // viewer에게 숨길 작성자 id. 로그인 안 했으면 빈 집합
    public Set<Long> hiddenFor(AppUser viewer) {
        if (viewer == null) return Set.of();
        Set<Long> ids = new HashSet<>(blocks.blockedIdsOf(viewer));
        ids.addAll(blocks.blockerIdsOf(viewer));
        return ids;
    }

    public boolean between(AppUser a, AppUser b) {
        if (a == null || b == null) return false;
        return blocks.findByBlockerAndBlocked(a, b).isPresent() || blocks.findByBlockerAndBlocked(b, a).isPresent();
    }

    public boolean blockedBy(AppUser blocker, AppUser target) {
        return blocks.findByBlockerAndBlocked(blocker, target).isPresent();
    }
}
