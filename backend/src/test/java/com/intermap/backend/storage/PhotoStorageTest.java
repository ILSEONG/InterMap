package com.intermap.backend.storage;

import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AppUserRepository;
import com.intermap.backend.auth.AvatarController;
import com.intermap.backend.auth.UserAvatar;
import com.intermap.backend.auth.UserAvatarRepository;
import com.intermap.backend.review.Review;
import com.intermap.backend.review.ReviewController;
import com.intermap.backend.review.ReviewPhoto;
import com.intermap.backend.review.ReviewPhotoRepository;
import com.intermap.backend.review.ReviewRepository;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.multipart.MultipartFile;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

// R2를 켰을 때: 사진 바이트는 R2에, DB에는 위치만. 사진 주소와 응답은 그대로.
// 커밋된 뒤에 R2에서 지우는 동작을 보려고 테스트를 트랜잭션으로 감싸지 않는다 — 만든 것은 끝에 직접 지운다.
@SpringBootTest(properties = "admin.password=test-admin-password")
class PhotoStorageTest {

    static final FakeS3 s3 = new FakeS3();

    @DynamicPropertySource
    static void r2(DynamicPropertyRegistry registry) {
        registry.add("r2.endpoint", s3::endpoint);
        registry.add("r2.bucket", () -> "photos");
        registry.add("r2.access-key-id", () -> "access");
        registry.add("r2.secret-access-key", () -> "secret");
    }

    @AfterAll
    static void stop() {
        s3.close();
    }

    @Autowired ReviewController reviewController;
    @Autowired AvatarController avatarController;
    @Autowired PhotoOffload offload;
    @Autowired PhotoStore store;
    @Autowired AppUserRepository users;
    @Autowired ReviewRepository reviews;
    @Autowired ReviewPhotoRepository photos;
    @Autowired UserAvatarRepository avatars;

    private AppUser me;
    private String bearer;
    private final List<Long> reviewIds = new ArrayList<>();

    @BeforeEach
    void signIn() {
        s3.down = false;
        // 서버 시작 때 뒤에서 도는 옮기기가 끝난 다음에 비운다
        offload.move();
        s3.objects.clear();
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        me = users.save(new AppUser("photo" + suffix + "@test.local", null, "photo" + suffix, null));
        String token = UUID.randomUUID().toString();
        me.issueToken(token);
        me = users.save(me);
        bearer = "Bearer " + token;
    }

    @AfterEach
    void cleanUp() {
        s3.down = false;
        for (Long id : reviewIds) reviewController.delete(bearer, id);
        reviewIds.clear();
        avatarController.delete(bearer);
        users.deleteById(me.getId());
    }

    // JPEG로 판별되는 바이트 (앞 3바이트가 FF D8 FF)
    private static byte[] jpeg(int seed) {
        byte[] data = new byte[2000];
        for (int i = 0; i < data.length; i++) data[i] = (byte) (seed + i);
        data[0] = (byte) 0xFF;
        data[1] = (byte) 0xD8;
        data[2] = (byte) 0xFF;
        return data;
    }

    private static MultipartFile file(String part, byte[] data) {
        return new MockMultipartFile(part, "photo.jpg", "image/jpeg", data);
    }

    private ReviewController.Item create(byte[]... photoBytes) throws Exception {
        List<MultipartFile> files = new ArrayList<>();
        for (byte[] data : photoBytes) files.add(file("photos", data));
        ResponseEntity<?> response = reviewController.create(bearer, new ReviewController.CreateRequest(
                new ReviewController.Place("사진 식당" + UUID.randomUUID(), "한식", "서울 중구 1", null, null),
                4, "후기", null), files);
        assertEquals(HttpStatus.OK, response.getStatusCode());
        ReviewController.Item item = (ReviewController.Item) response.getBody();
        reviewIds.add(item.id());
        return item;
    }

    // "/api/photos/{id}/{key}" 주소로 사진을 받는다
    private ResponseEntity<byte[]> fetch(String url) {
        String[] parts = url.split("/");
        return reviewController.photo(Long.valueOf(parts[3]), parts[4]);
    }

    @Test
    void uploadedPhotoBytesGoToR2AndTheAddressStillServesThem() throws Exception {
        byte[] first = jpeg(1);
        byte[] second = jpeg(2);
        ReviewController.Item item = create(first, second);

        assertEquals(2, s3.objects.size(), "두 장 모두 R2에");
        for (Long id : item.photoIds()) {
            ReviewPhoto row = photos.findById(id).orElseThrow();
            assertNotNull(row.getStorageKey());
            assertTrue(row.getStorageKey().startsWith("reviews/"));
            assertEquals(0, row.getData().length, "DB에는 바이트를 두지 않는다");
            assertTrue(s3.objects.containsKey("/photos/" + row.getStorageKey()));
        }
        ResponseEntity<byte[]> served = fetch(item.photoUrls().get(0));
        assertEquals(HttpStatus.OK, served.getStatusCode());
        assertArrayEquals(first, served.getBody());
        assertEquals("image/jpeg", served.getHeaders().getContentType().toString());
        assertArrayEquals(second, fetch(item.photoUrls().get(1)).getBody());
    }

    @Test
    void droppingAPhotoOrDeletingTheReviewRemovesItFromR2() throws Exception {
        ReviewController.Item item = create(jpeg(1), jpeg(2));
        Long kept = item.photoIds().get(0);
        String keptKey = photos.findById(kept).orElseThrow().getStorageKey();

        ResponseEntity<?> updated = reviewController.update(bearer, item.id(),
                new ReviewController.UpdateRequest(4, "고친 후기", null, List.of(kept)), null);
        assertEquals(HttpStatus.OK, updated.getStatusCode());
        assertEquals(java.util.Set.of("/photos/" + keptKey), s3.objects.keySet(), "뺀 사진만 R2에서 지워진다");

        reviewController.delete(bearer, item.id());
        reviewIds.clear();
        assertTrue(s3.objects.isEmpty(), "후기를 지우면 남은 사진도 R2에서 지워진다");
    }

    @Test
    void uploadStillWorksWhenR2IsDownAndThePhotoMovesLater() throws Exception {
        s3.down = true;
        byte[] photo = jpeg(3);
        ReviewController.Item item = create(photo);
        ReviewPhoto row = photos.findById(item.photoIds().get(0)).orElseThrow();
        assertNull(row.getStorageKey(), "R2가 안 되면 DB에 둔다");
        assertArrayEquals(photo, fetch(item.photoUrls().get(0)).getBody());

        s3.down = false;
        offload.move();

        row = photos.findById(row.getId()).orElseThrow();
        assertNotNull(row.getStorageKey(), "R2가 돌아오면 옮긴다");
        assertEquals(0, row.getData().length);
        assertArrayEquals(photo, s3.objects.get("/photos/" + row.getStorageKey()));
        assertArrayEquals(photo, fetch(item.photoUrls().get(0)).getBody(), "같은 주소로 같은 사진이 온다");
    }

    @Test
    void photosAlreadyInTheDatabaseMoveToR2() throws Exception {
        ReviewController.Item item = create();
        Review review = reviews.findById(item.id()).orElseThrow();
        byte[] old = jpeg(4);
        ReviewPhoto inDb = photos.save(new ReviewPhoto(review, "image/jpeg", old));
        byte[] oldAvatar = jpeg(5);
        avatars.save(new UserAvatar(me.getId(), "image/jpeg", oldAvatar));

        offload.move();

        ReviewPhoto moved = photos.findById(inDb.getId()).orElseThrow();
        assertEquals(0, moved.getData().length);
        assertArrayEquals(old, s3.objects.get("/photos/" + moved.getStorageKey()));
        assertEquals(inDb.getAccessKey(), moved.getAccessKey(), "사진 주소는 그대로");
        assertArrayEquals(old, reviewController.photo(moved.getId(), moved.getAccessKey()).getBody());

        UserAvatar avatar = avatars.findById(me.getId()).orElseThrow();
        assertEquals(0, avatar.getData().length);
        assertTrue(avatar.getStorageKey().startsWith("avatars/"));
        assertArrayEquals(oldAvatar, avatarController.photo(me.getId()).getBody());
        assertTrue(photos.idsInDatabase().stream().noneMatch(inDb.getId()::equals));
    }

    @Test
    void nothingIsErasedFromTheDatabaseWhenR2IsDown() throws Exception {
        ReviewController.Item item = create();
        byte[] old = jpeg(6);
        ReviewPhoto inDb = photos.save(new ReviewPhoto(reviews.findById(item.id()).orElseThrow(), "image/jpeg", old));
        s3.down = true;

        offload.move();

        ReviewPhoto still = photos.findById(inDb.getId()).orElseThrow();
        assertNull(still.getStorageKey());
        assertArrayEquals(old, still.getData(), "옮기지 못한 사진은 DB에 그대로 있다");
    }

    @Test
    void unreachableR2AnswersWithoutCaching() throws Exception {
        ReviewController.Item item = create(jpeg(7));
        s3.down = true;

        ResponseEntity<byte[]> served = fetch(item.photoUrls().get(0));

        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, served.getStatusCode());
        assertNull(served.getHeaders().getCacheControl(), "못 받은 응답이 1년 캐시되면 안 된다");
    }

    @Test
    void avatarBytesGoToR2AndTheOldOneIsRemovedOnReplace() throws Exception {
        byte[] first = jpeg(8);
        assertEquals(HttpStatus.OK, avatarController.upload(bearer, file("photo", first)).getStatusCode());
        String firstKey = avatars.findStorageKey(me.getId()).orElseThrow();
        assertArrayEquals(first, s3.objects.get("/photos/" + firstKey));
        assertArrayEquals(first, avatarController.photo(me.getId()).getBody());

        byte[] second = jpeg(9);
        avatarController.upload(bearer, file("photo", second));
        String secondKey = avatars.findStorageKey(me.getId()).orElseThrow();
        assertEquals(java.util.Set.of("/photos/" + secondKey), s3.objects.keySet(), "예전 프로필 사진은 지워진다");
        assertArrayEquals(second, avatarController.photo(me.getId()).getBody());

        avatarController.delete(bearer);
        assertTrue(s3.objects.isEmpty());
        assertEquals(HttpStatus.NOT_FOUND, avatarController.photo(me.getId()).getStatusCode());
    }

    @Test
    void storeIsOn() {
        assertTrue(store.enabled());
    }
}
