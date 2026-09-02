package com.intermap.backend.review;

import com.intermap.backend.auth.AdminSeeder;
import com.intermap.backend.auth.AppUser;
import com.intermap.backend.auth.AuthController;
import com.intermap.backend.auth.UserAvatarRepository;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@RestController
@CrossOrigin(originPatterns = {"http://localhost:5173", "http://localhost:5174", "https://intermap.app:8443", "capacitor://intermap.app", "https://*.vercel.app"})
public class ReviewCommentController {

    public record CreateRequest(Long reviewId, String text, Long parentId) {
    }

    public record Item(Long id, Long reviewId, Long parentId, ReviewController.Author author, String text,
                       Instant createdAt) {
        static Item from(ReviewComment c, String avatar) {
            AppUser a = c.getAuthor();
            return new Item(c.getId(), c.getReview().getId(), c.getParentId(),
                    new ReviewController.Author(a.getId(), a.getNickname(), AdminSeeder.ADMIN_EMAIL.equals(a.getEmail()), avatar),
                    c.getText(), c.getCreatedAt());
        }
    }

    private final ReviewCommentRepository repository;
    private final ReviewRepository reviews;
    private final AuthController auth;
    private final UserAvatarRepository avatars;

    public ReviewCommentController(ReviewCommentRepository repository, ReviewRepository reviews, AuthController auth,
                                   UserAvatarRepository avatars) {
        this.repository = repository;
        this.reviews = reviews;
        this.auth = auth;
        this.avatars = avatars;
    }

    // 후기 목록처럼 전부 내려준다 — 프론트가 후기별로 나눈다.
    // ponytail: 댓글이 수천 건 넘으면 reviewId 파라미터로 잘라 받도록 바꿀 것
    @GetMapping("/api/comments")
    public List<Item> list() {
        Map<Long, String> avatarUrls = avatars.urlsByUserId();
        return repository.findAllByOrderByCreatedAtAsc().stream()
                .map(c -> Item.from(c, avatarUrls.get(c.getAuthor().getId())))
                .toList();
    }

    @PostMapping("/api/comments")
    @Transactional
    public ResponseEntity<?> create(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @RequestBody CreateRequest request) {
        AppUser user = auth.currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("로그인 후 댓글을 남길 수 있어요."));
        }
        String text = request.text() == null ? "" : request.text().trim();
        if (text.isEmpty() || text.length() > 500) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("댓글은 1~500자로 남겨주세요."));
        }
        Review review = request.reviewId() == null ? null : reviews.findById(request.reviewId()).orElse(null);
        if (review == null) {
            return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("댓글을 달 후기를 찾지 못했어요."));
        }
        // 대댓글이면 부모가 같은 후기의 원댓글이어야 한다 (대댓글에 또 답글은 없다)
        if (request.parentId() != null) {
            ReviewComment parent = repository.findById(request.parentId()).orElse(null);
            if (parent == null || !parent.getReview().getId().equals(review.getId()) || parent.getParentId() != null) {
                return ResponseEntity.badRequest().body(new AuthController.ErrorResponse("답글을 달 댓글을 찾지 못했어요."));
            }
        }
        ReviewComment saved = repository.save(new ReviewComment(review, user, request.parentId(), text));
        return ResponseEntity.ok(Item.from(saved, avatars.urlOf(user.getId())));
    }

    // 본인 댓글만. 원댓글을 지우면 대댓글도 같이 지운다.
    @DeleteMapping("/api/comments/{id}")
    @Transactional
    public ResponseEntity<?> delete(@RequestHeader(value = "Authorization", required = false) String authorization,
                                    @PathVariable Long id) {
        AppUser user = auth.currentUser(authorization);
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(new AuthController.ErrorResponse("다시 로그인해주세요."));
        }
        ReviewComment comment = repository.findById(id).orElse(null);
        if (comment == null || !comment.getAuthor().getId().equals(user.getId())) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(new AuthController.ErrorResponse("내가 쓴 댓글만 지울 수 있어요."));
        }
        if (comment.getParentId() == null) {
            repository.deleteAllByParentId(id);
        }
        repository.delete(comment);
        return ResponseEntity.noContent().build();
    }
}
