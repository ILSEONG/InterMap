package com.intermap.backend.localdata;

import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

/**
 * 등록된 음식점의 영업/폐업 상태를 LOCALDATA 변경분과 대조해 갱신.
 * 폐업은 반드시 데이터 변경으로 기록되므로 주간 델타 조회만으로 잡힌다.
 */
@Service
public class StatusSyncService {

    private static final Logger log = LoggerFactory.getLogger(StatusSyncService.class);

    private final LocalDataClient client;
    private final RestaurantRepository repository;
    private final List<String> localCodes;

    public StatusSyncService(
        LocalDataClient client,
        RestaurantRepository repository,
        @Value("${localdata.local-codes}") String localCodesCsv
    ) {
        this.client = client;
        this.repository = repository;
        this.localCodes = List.of(localCodesCsv.split(","));
    }

    /** 매주 월요일 04:00 */
    @Scheduled(cron = "0 0 4 * * MON")
    public void weeklySync() {
        syncOnce(8); // 여유있게 최근 8일 변경분
    }

    public int syncOnce(int daysBack) {
        if (!client.isConfigured()) {
            throw new IllegalStateException("LOCALDATA_AUTH_KEY 환경변수가 설정되지 않았습니다");
        }

        List<Restaurant> restaurants = repository.findAll();
        if (restaurants.isEmpty()) return 0;

        LocalDate to = LocalDate.now();
        LocalDate from = to.minusDays(daysBack);
        int updated = 0;

        for (String localCode : localCodes) {
            List<LocalDataClient.Row> rows = client.fetchChangedSince(localCode.trim(), from, to);
            log.info("LOCALDATA {} 변경분 {}건", localCode, rows.size());

            for (LocalDataClient.Row row : rows) {
                for (Restaurant restaurant : restaurants) {
                    if (matches(restaurant, row)) {
                        Restaurant.Status status = row.isClosed() ? Restaurant.Status.CLOSED : Restaurant.Status.OPEN;
                        restaurant.markStatus(status, row.mgtNo());
                        repository.save(restaurant);
                        updated++;
                        log.info("상태 갱신: {} -> {}", restaurant.getName(), status);
                    }
                }
            }
        }
        return updated;
    }

    // ponytail: 상호+도로명주소 문자열 매칭 — 오탈자/표기차이엔 약함, 오매칭 사례 생기면 좌표 근접 검증 추가
    static boolean matches(Restaurant restaurant, LocalDataClient.Row row) {
        if (restaurant.getLocalDataMgtNo() != null && restaurant.getLocalDataMgtNo().equals(row.mgtNo())) {
            return true;
        }
        if (row.bplcNm() == null || row.rdnWhlAddr() == null) return false;
        String rowName = normalize(row.bplcNm());
        String ourName = normalize(restaurant.getName());
        if (!rowName.equals(ourName)) return false;
        String rowAddr = normalize(row.rdnWhlAddr());
        String ourAddr = normalize(restaurant.getRoadAddress());
        return rowAddr.startsWith(ourAddr) || ourAddr.startsWith(rowAddr);
    }

    static String normalize(String s) {
        return s == null ? "" : s.replaceAll("\\s+", "");
    }
}
