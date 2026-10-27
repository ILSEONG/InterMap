package com.intermap.backend.review;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.social.Follow;
import com.intermap.backend.social.FollowRepository;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.Set;
import java.util.function.Predicate;

// 누구의 후기를 볼 수 있는지 (PRODUCT.md: 팔로우한 이웃의 후기만 — 모르는 사람 것은 서버가 아예 내려주지 않는다).
// 로그인 안 했으면 주인장 후기만, 로그인했으면 나 + 내가 팔로우한 사람 + 주인장. 댓글·사진도 이 기준을 따른다.
@Component
public class ReviewAudience {

    private final FollowRepository follows;

    public ReviewAudience(FollowRepository follows) {
        this.follows = follows;
    }

    // 후기 작성자를 받아 viewer가 볼 수 있으면 true
    public Predicate<AppUser> visibleAuthors(AppUser viewer) {
        Set<Long> ids = new HashSet<>();
        if (viewer != null) {
            ids.add(viewer.getId());
            for (Follow f : follows.findByFollowerOrderByCreatedAtDesc(viewer)) ids.add(f.getFollowee().getId());
        }
        return author -> ids.contains(author.getId()) || AdminSeeder.ADMIN_EMAIL.equals(author.getEmail());
    }
}
