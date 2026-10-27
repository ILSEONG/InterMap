package com.intermap.backend.review;

import com.intermap.backend.moderation.Report;
import com.intermap.backend.moderation.ReportRepository;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

// 후기·댓글을 지울 때 딸린 것(사진, 댓글, 대댓글)을 같이 정리하고, 걸려 있던 신고를 닫는다.
// 작성자 삭제, 운영자 삭제, 회원 탈퇴가 모두 이 경로를 탄다. 호출하는 쪽에서 트랜잭션을 연다.
@Component
public class ReviewCleanup {

    private final ReviewRepository reviews;
    private final ReviewPhotoRepository photos;
    private final ReviewCommentRepository comments;
    private final ReportRepository reports;

    public ReviewCleanup(ReviewRepository reviews, ReviewPhotoRepository photos, ReviewCommentRepository comments,
                         ReportRepository reports) {
        this.reviews = reviews;
        this.photos = photos;
        this.comments = comments;
        this.reports = reports;
    }

    // status: 이 후기에 걸린 신고를 어떤 상태로 닫을지 (작성자가 지움 = GONE, 운영자가 지움 = REMOVED)
    public void deleteReview(Review review, Report.Status status) {
        Long id = review.getId();
        List<Long> commentIds = comments.idsByReviewId(id);
        // 사진 먼저 지운다 (FK)
        photos.deleteAllByIdInBatch(photos.findRefsByReviewId(id).stream().map(ReviewPhotoRepository.Ref::getId).toList());
        comments.deleteAllByReviewId(id);
        reviews.delete(review);
        closeReports(Report.TargetType.REVIEW, List.of(id), status);
        closeReports(Report.TargetType.COMMENT, commentIds, Report.Status.GONE);
    }

    // 원댓글을 지우면 대댓글도 같이 지운다
    public void deleteComment(ReviewComment comment, Report.Status status) {
        List<Long> replyIds = new ArrayList<>();
        if (comment.getParentId() == null) {
            replyIds.addAll(comments.idsByParentId(comment.getId()));
            comments.deleteAllByParentId(comment.getId());
        }
        comments.delete(comment);
        closeReports(Report.TargetType.COMMENT, List.of(comment.getId()), status);
        closeReports(Report.TargetType.COMMENT, replyIds, Report.Status.GONE);
    }

    private void closeReports(Report.TargetType type, Collection<Long> targetIds, Report.Status status) {
        if (targetIds.isEmpty()) return;
        for (Report r : reports.findByTargetTypeAndTargetIdInAndStatus(type, targetIds, Report.Status.OPEN)) {
            r.resolve(status);
        }
    }
}
