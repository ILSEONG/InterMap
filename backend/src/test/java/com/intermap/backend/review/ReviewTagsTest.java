package com.intermap.backend.review;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

// 카페 후기의 꼬리표(작업·공부, 수다, 디저트, 커피 맛, 분위기): 아는 코드만 적고, 후기와 함께 오간다.
@SpringBootTest(properties = "admin.password=test-admin-password")
class ReviewTagsTest {

    @Autowired ReviewController controller;
    @Autowired AppUserRepository users;

    private final String tag = UUID.randomUUID().toString().substring(0, 8);
    private final List<Long> created = new ArrayList<>();
    private AppUser me;
    private String bearer;

    @BeforeEach
    void signIn() {
        me = users.save(new AppUser("tags" + tag + "@test.local", null, "꼬리표" + tag, null));
        String token = UUID.randomUUID().toString();
        me.issueToken(token);
        me = users.save(me);
        bearer = "Bearer " + token;
    }

    @AfterEach
    void cleanUp() {
        for (Long id : created) controller.delete(bearer, id);
        users.delete(me);
    }

    @Test
    void keepsOnlyKnownCodesInAFixedOrder() {
        assertEquals("WORK,MOOD", ReviewTags.store(Arrays.asList("MOOD", " WORK ", "없는것", null, "WORK")));
        assertNull(ReviewTags.store(List.of("없는것")));
        assertNull(ReviewTags.store(List.of()));
        assertNull(ReviewTags.store(null));
        assertEquals(List.of("WORK", "MOOD"), ReviewTags.read("WORK,MOOD"));
        assertEquals(List.of("TASTE"), ReviewTags.read(" TASTE ,지워진코드"));
        assertEquals(List.of(), ReviewTags.read(null));
    }

    private ReviewController.Item item(ResponseEntity<?> response) {
        assertEquals(HttpStatus.OK, response.getStatusCode());
        return (ReviewController.Item) response.getBody();
    }

    private List<String> listed(Long id) {
        return controller.list(bearer).stream().filter(i -> i.id().equals(id)).findFirst().orElseThrow().tags();
    }

    @Test
    void tagsTravelWithTheReview() throws Exception {
        ReviewController.Place cafe = new ReviewController.Place("모모커피 " + tag, "커피숍", "서울특별시 중구 꼬리표길 " + tag, null, null);
        ReviewController.Item made = item(controller.create(bearer,
                new ReviewController.CreateRequest(cafe, 4.5, "조용해서 일하기 좋아요", null, List.of("MOOD", "없는것", "WORK")), null));
        created.add(made.id());
        assertEquals(List.of("WORK", "MOOD"), made.tags());
        assertEquals(List.of("WORK", "MOOD"), listed(made.id()));

        // 꼬리표를 모르는 예전 앱이 고치면 그대로 둔다
        ReviewController.Item byOldApp = item(controller.update(bearer, made.id(),
                new ReviewController.UpdateRequest(4, "고친 후기", null, List.of()), null));
        assertEquals(List.of("WORK", "MOOD"), byOldApp.tags());

        ReviewController.Item changed = item(controller.update(bearer, made.id(),
                new ReviewController.UpdateRequest(4, "고친 후기", null, List.of(), List.of("TASTE")), null));
        assertEquals(List.of("TASTE"), changed.tags());

        ReviewController.Item cleared = item(controller.update(bearer, made.id(),
                new ReviewController.UpdateRequest(4, "고친 후기", null, List.of(), List.of()), null));
        assertEquals(List.of(), cleared.tags());
        assertEquals(List.of(), listed(made.id()));
    }

    @Test
    void aReviewWithoutTagsHasAnEmptyList() throws Exception {
        ReviewController.Place place = new ReviewController.Place("모모식당 " + tag, "한식", "서울특별시 중구 꼬리표길 " + tag + "-2", null, null);
        ReviewController.Item made = item(controller.create(bearer, new ReviewController.CreateRequest(place, 4, "맛있어요", null), null));
        created.add(made.id());
        assertEquals(List.of(), made.tags());
    }
}
