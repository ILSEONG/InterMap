package com.intermap.backend.moderation;

import com.intermap.backend.auth.AppUser;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ReportRepository extends JpaRepository<Report, Long> {

    Optional<Report> findByReporterAndTargetTypeAndTargetId(AppUser reporter, Report.TargetType targetType, Long targetId);

    // 내가 신고한 대상 — 신고하면 그 후기·댓글은 나에게서 바로 숨긴다
    @Query("select r.targetId from Report r where r.reporter = :reporter and r.targetType = :type")
    List<Long> targetIdsReportedBy(AppUser reporter, Report.TargetType type);

    // 운영자 화면 — 상태별, 최신순
    @EntityGraph(attributePaths = "reporter")
    List<Report> findByStatusOrderByCreatedAtDesc(Report.Status status);

    List<Report> findByTargetTypeAndTargetIdInAndStatus(Report.TargetType targetType, Collection<Long> targetIds,
                                                         Report.Status status);

    // 탈퇴한 사람이 낸 신고는 지운다 (신고 사본은 남지 않아도 되는 쪽)
    @Modifying
    @Query("delete from Report r where r.reporter = :reporter")
    void deleteAllByReporter(AppUser reporter);
}
