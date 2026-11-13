package com.intermap.backend.review;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.moderation.UserBlock;
import com.intermap.backend.moderation.UserBlockRepository;
import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import com.intermap.backend.social.Follow;
import com.intermap.backend.social.FollowRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 후기 목록은 볼 수 있는 작성자의 후기만 DB에서 읽고, 사진·좌표를 그 후기들 것만 한 번에 붙인다.
// 전부 읽어 와 거르던 때와 결과가 같아야 한다 (공개 범위 자체는 ReviewVisibilityTest가 본다).
@SpringBootTest
@Transactional
class ReviewListQueryTest {

    @Autowired ReviewController reviewController;
    @Autowired AppUserRepository users;
    @Autowired ReviewRepository reviews;
    @Autowired ReviewPhotoRepository photos;
    @Autowired RestaurantRepository restaurants;
    @Autowired FollowRepository follows;
    @Autowired UserBlockRepository blocks;
    @Autowired JdbcTemplate jdbc;

    private AppUser user(String name) {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        return users.save(new AppUser(name + suffix + "@test.local", null, name + suffix, null));
    }

    private String bearer(AppUser u) {
        String token = UUID.randomUUID().toString();
        u.issueToken(token);
        users.save(u);
        return "Bearer " + token;
    }

    @Test
    void attachesCoordinatesAndPhotosOfVisibleReviewsOnly() {
        AppUser me = user("me");
        AppUser friend = user("friend");
        AppUser stranger = user("stranger");
        follows.save(new Follow(me, friend));

        String tag = UUID.randomUUID().toString().substring(0, 8);
        // 같은 상호의 다른 지점이 섞여 있어도 주소로 맞춘다
        restaurants.save(new Restaurant("도로명집" + tag, "한식", "서울 중구 길 1", "서울 중구 동 1-1", 37.11, 127.11));
        restaurants.save(new Restaurant("도로명집" + tag, "한식", "서울 중구 길 99", "서울 중구 동 99-9", 37.99, 127.99));
        restaurants.save(new Restaurant("지번집" + tag, "분식", "서울 중구 길 2", "서울 중구 동 2-2", 37.22, 127.22));
        Restaurant closed = new Restaurant("폐업집" + tag, "양식", "서울 중구 길 3", "서울 중구 동 3-3", 37.33, 127.33);
        closed.markStatus(Restaurant.Status.CLOSED, null);
        restaurants.save(closed);

        Review byRoad = reviews.save(new Review(me, "도로명집" + tag, "한식", "서울 중구 길 1", 5, "도로명 주소로 찾는다", null));
        Review byLot = reviews.save(new Review(friend, "지번집" + tag, "분식", "서울 중구 동 2-2", 4, "지번 주소로 찾는다", null));
        Review atClosed = reviews.save(new Review(friend, "폐업집" + tag, "양식", "서울 중구 길 3", 3, "폐업한 가게", null));
        Review unknown = reviews.save(new Review(me, "없는집" + tag, "기타", "서울 중구 길 4", 3, "목록에 없는 가게", null));
        Review hidden = reviews.save(new Review(stranger, "도로명집" + tag, "한식", "서울 중구 길 1", 1, "모르는 사람", null));
        photos.save(new ReviewPhoto(byLot, "image/jpeg", new byte[]{1, 2, 3}));
        photos.save(new ReviewPhoto(byLot, "image/jpeg", new byte[]{4, 5, 6}));
        photos.save(new ReviewPhoto(hidden, "image/jpeg", new byte[]{7, 8, 9}));

        Map<Long, ReviewController.Item> seen = reviewController.list(bearer(me)).stream()
                .collect(Collectors.toMap(ReviewController.Item::id, i -> i));
        assertFalse(seen.containsKey(hidden.getId()));

        assertEquals(37.11, seen.get(byRoad.getId()).restaurant().lat());
        assertEquals(127.11, seen.get(byRoad.getId()).restaurant().lng());
        assertEquals(37.22, seen.get(byLot.getId()).restaurant().lat());
        assertNull(seen.get(atClosed.getId()).restaurant().lat(), "폐업한 가게는 좌표를 주지 않는다");
        assertNull(seen.get(unknown.getId()).restaurant().lat());

        assertEquals(2, seen.get(byLot.getId()).photoUrls().size());
        assertTrue(seen.get(byRoad.getId()).photoUrls().isEmpty());

        // 차단하면 팔로우하던 사람 후기도 빠진다
        blocks.save(new UserBlock(me, friend));
        Set<Long> afterBlock = reviewController.list(bearer(me)).stream().map(ReviewController.Item::id).collect(Collectors.toSet());
        assertFalse(afterBlock.contains(byLot.getId()));
        assertTrue(afterBlock.contains(byRoad.getId()));
    }

    // 조회 경로용 인덱스가 실제로 만들어지는지 — 칸 이름을 잘못 적으면 Hibernate는 경고만 남기고 넘어가서 모르고 지나친다
    @Test
    void lookupIndexesExist() {
        Set<String> names = jdbc.queryForList("select index_name from information_schema.indexes", String.class).stream()
                .map(String::toLowerCase).collect(Collectors.toSet());
        for (String expected : List.of("idx_review_author_created", "idx_review_restaurant_name", "idx_review_photo_review",
                "idx_review_comment_review", "idx_review_comment_author", "idx_follow_followee",
                "idx_follow_request_target", "idx_push_token_user", "idx_favorite_user")) {
            assertTrue(names.contains(expected), expected + " 인덱스가 없다: " + names);
        }
    }
}
