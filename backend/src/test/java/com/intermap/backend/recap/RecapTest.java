package com.intermap.backend.recap;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import com.intermap.backend.review.Review;
import com.intermap.backend.review.ReviewComment;
import com.intermap.backend.review.ReviewCommentRepository;
import com.intermap.backend.review.ReviewRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

// 월간 결산 — 그 달(KST)에 후기 남긴 가게로 장르·동네·별점·댓글 단짝을 센다
@SpringBootTest(properties = "admin.password=test-admin-password")
@Transactional
class RecapTest {

    @Autowired RecapController controller;
    @Autowired AppUserRepository users;
    @Autowired ReviewRepository reviews;
    @Autowired ReviewCommentRepository comments;
    @Autowired RestaurantRepository restaurants;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManager em;

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

    // 후기 작성 시각은 엔티티가 now로 찍으므로 DB에서 직접 옮긴다
    private Review review(AppUser author, String name, String category, String road, double rating, LocalDateTime kst) {
        Review r = reviews.saveAndFlush(new Review(author, name, category, road, rating, "맛있어요", null));
        jdbc.update("update review set created_at = ? where id = ?", Timestamp.from(kst.atZone(ZoneId.of("Asia/Seoul")).toInstant()), r.getId());
        return r;
    }

    @Test
    void countsMonthByKoreanTime() {
        AppUser me = user("me");
        AppUser fan = user("fan");
        String suffix = UUID.randomUUID().toString().substring(0, 6);
        restaurants.save(new Restaurant("라멘A" + suffix, "일식>라멘", "서울특별시 마포구 포은로 1", "서울특별시 마포구 망원동 1-1", 37.55, 126.90));
        restaurants.save(new Restaurant("라멘B" + suffix, "일식>라멘", "서울특별시 마포구 포은로 2", "서울특별시 마포구 망원동 2-2", 37.55, 126.90));
        Review a = review(me, "라멘A" + suffix, "일식>라멘", "서울특별시 마포구 포은로 1", 4.0, LocalDateTime.of(2026, 11, 1, 0, 30));
        review(me, "라멘B" + suffix, "일식>라멘", "서울특별시 마포구 포은로 2", 5.0, LocalDateTime.of(2026, 11, 20, 19, 0));
        review(me, "국밥" + suffix, "음식점>한식", "서울특별시 성동구 왕십리로 3", 3.0, LocalDateTime.of(2026, 11, 30, 23, 59));
        // KST로 10월 31일 밤 — 11월이 아니다
        review(me, "지난달" + suffix, "한식", "서울특별시 중구 을지로 4", 1.0, LocalDateTime.of(2026, 10, 31, 23, 50));
        comments.saveAndFlush(new ReviewComment(a, fan, null, "여기 어디예요?"));
        comments.saveAndFlush(new ReviewComment(a, fan, null, "저도 갈래요"));
        comments.saveAndFlush(new ReviewComment(a, me, null, "내 댓글은 안 센다"));
        jdbc.update("update review_comment set created_at = ? where review_id = ?",
                Timestamp.from(LocalDateTime.of(2026, 11, 2, 12, 0).atZone(ZoneId.of("Asia/Seoul")).toInstant()), a.getId());
        // JDBC로 옮긴 작성 시각이 보이도록 1차 캐시를 비운다 (안 비우면 now로 찍힌 엔티티가 그대로 나온다)
        em.flush();
        em.clear();

        var res = controller.recap(bearer(me), "2026-11");
        assertEquals(HttpStatus.OK, res.getStatusCode());
        var recap = (RecapController.Recap) res.getBody();
        assertEquals(3, recap.places());
        assertEquals(new RecapController.Stat("라멘", 2), recap.topCategory());
        assertEquals(new RecapController.Stat("망원동", 2), recap.topArea());
        assertEquals(4.0, recap.avgRating());
        assertEquals("라멘B" + suffix, recap.best().name());
        assertEquals(2, recap.commentsReceived());
        assertEquals(fan.getId(), recap.topFan().id());
        assertEquals(List.of("2026-11", "2026-10"), recap.months());

        var empty = (RecapController.Recap) controller.recap(bearer(me), "2026-09").getBody();
        assertEquals(0, empty.places());
        assertNull(empty.avgRating());
        assertNull(empty.topCategory());
        assertEquals(HttpStatus.BAD_REQUEST, controller.recap(bearer(me), "11월").getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED, controller.recap(null, null).getStatusCode());
    }

    @Test
    void namesCategoryAndArea() {
        assertEquals("한식", RecapController.categoryOf("음식점>한식"));
        assertEquals("라멘", RecapController.categoryOf("일식>라멘,우동"));
        assertNull(RecapController.categoryOf("음식점"));
        assertNull(RecapController.categoryOf("기타"));
        assertEquals("망원동", RecapController.areaOf("서울특별시 마포구 망원동 415-3", "서울특별시 마포구 포은로 2"));
        assertEquals("성수동1가", RecapController.areaOf("서울특별시 성동구 성수동1가 1-1", null));
        assertEquals("망원동", RecapController.areaOf(null, "서울특별시 마포구 포은로 2 (망원동)"));
        assertEquals("마포구", RecapController.areaOf(null, "서울특별시 마포구 포은로 2"));
        assertEquals("수원시", RecapController.areaOf(null, "경기도 수원시 팔달로 1"));
        assertNull(RecapController.areaOf(null, null));
    }
}
