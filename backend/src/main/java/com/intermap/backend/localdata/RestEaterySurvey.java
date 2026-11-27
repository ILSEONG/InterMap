package com.intermap.backend.localdata;

import com.intermap.backend.restaurant.RestaurantRepository;
import com.intermap.backend.restaurant.SbizLookup;
import com.intermap.backend.state.ServerState;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;

/**
 * 휴게음식점 가운데 카페가 아니라서 받지 않는 가게가 얼마나, 어떤 곳인지 한 번 세어 본다 — 가게는 넣지 않고 로그만 남긴다.
 *
 * 휴게음식점에서는 카페만 받는다(CafeImport). 그런데 1인 샤브·분식·김밥·토스트 가게도 휴게음식점으로 등록하는 곳이 있어
 * 네이버에는 있는데 우리 목록에는 없는 가게가 생긴다. 업태("기타 휴게음식점", "일반조리판매")만으로 받으면 PC방·매점이 섞이므로,
 * "상가(상권)정보에 같은 건물·같은 이름의 음식점으로 잡힌 곳만 받는다"는 조건이면 몇 곳이 들어오는지 먼저 본다.
 *
 * 서버가 켜지고 10분 뒤에 한 번 돈다. 다 세면 끝났다고 적어 두고 다시 돌지 않는다. 숫자를 보고 규칙을 정하면 이 클래스는 지운다.
 */
@Service
public class RestEaterySurvey implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RestEaterySurvey.class);
    private static final String DONE_KEY = "v1";
    // 배포 직후의 업종 채우기(상가 파일을 같이 올린다)·카페 받아 오기와 겹치지 않게
    private static final Duration START_DELAY = Duration.ofMinutes(10);
    private static final Duration PAUSE = Duration.ofMinutes(30);
    private static final int TRIES = 6;
    private static final int FETCH_TRIES = 5;
    private static final Duration FETCH_PAUSE = Duration.ofSeconds(40);
    // 상가와 짝지어지면 받을 업태. 편의점·푸드트럭·키즈카페·철도역구내·극장·유원지는 짝이 있어도 받지 않는다
    static final Set<String> CANDIDATES = Set.of("기타 휴게음식점", "일반조리판매", "패스트푸드", "백화점");
    // 이 낱말이 든 가게는 어떻게 세어졌는지 따로 적는다 (빠진 걸 알게 된 가게)
    private static final String WATCH = "샤브토랑";
    private static final int SAMPLES_PER_GU = 2;

    /** 상가(상권)정보에서 짝을 찾는 일 — 테스트에서 바꿔 끼운다 */
    interface Matcher {
        String categoryOf(String name, String roadAddress, String lotAddress);
    }

    /** 세어 본 결과. 업태별 숫자는 [전체, 좌표 없음, 상가와 짝지음] */
    static final class Tally {
        int open, known, cafes;
        final Map<String, int[]> byCategory = new TreeMap<>();
        final Map<String, Integer> sbizOfMatched = new TreeMap<>();
        final List<String> matchedSamples = new ArrayList<>();
        final List<String> unmatchedSamples = new ArrayList<>();
        final List<String> watched = new ArrayList<>();

        int wouldAdd() {
            return byCategory.entrySet().stream().filter(e -> CANDIDATES.contains(e.getKey())).mapToInt(e -> e.getValue()[2]).sum();
        }
    }

    private final LocalDataClient client;
    private final RestaurantRepository repository;
    private final ServerState state;
    private final List<String> localCodes;

    public RestEaterySurvey(LocalDataClient client, RestaurantRepository repository, ServerState state,
                            @Value("${localdata.local-codes}") String localCodesCsv) {
        this.client = client;
        this.repository = repository;
        this.state = state;
        this.localCodes = List.of(localCodesCsv.split(",")).stream().map(String::trim).filter(c -> !c.isEmpty()).toList();
    }

    @Override
    public void run(ApplicationArguments args) {
        if (!client.isConfigured() || state.get("rest-survey", DONE_KEY).isPresent()) return;
        Thread worker = new Thread(() -> {
            try {
                Thread.sleep(START_DELAY.toMillis());
                for (int i = 1; i <= TRIES; i++) {
                    if (survey()) return;
                    Thread.sleep(PAUSE.toMillis());
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, "rest-survey");
        worker.setDaemon(true);
        worker.setPriority(Thread.MIN_PRIORITY);
        worker.start();
    }

    // 25개 구를 다 세면 true. 인허가 API를 못 부르면 false (나중에 처음부터 다시 센다 — 넣는 게 없으니 이어서 할 것도 없다)
    private boolean survey() {
        try {
            SbizLookup lookup = new SbizLookup();
            if (lookup.isEmpty()) {
                log.warn("휴게음식점 세어 보기: 상가 파일이 서버에 없어서 하지 않아요");
                return true;
            }
            Set<String> knownMgtNos = new HashSet<>();
            Set<String> knownNameAddrs = new HashSet<>();
            for (Object[] r : repository.findAllKeys()) {
                if (r[3] != null) knownMgtNos.add((String) r[3]);
                knownNameAddrs.add(RestaurantImportService.key((String) r[1], (String) r[2]));
            }
            Tally tally = new Tally();
            for (String code : localCodes) {
                count(fetch(code), knownMgtNos, knownNameAddrs, lookup::categoryOf, tally);
            }
            report(tally);
            state.put("rest-survey", DONE_KEY, "done", Duration.ofDays(3650));
            return true;
        } catch (RuntimeException e) {
            log.warn("휴게음식점 세어 보기를 못 끝냈어요 — {}분 뒤에 다시 해요: {}", PAUSE.toMinutes(), LocalDataClient.safe(e.toString()));
            return false;
        }
    }

    // 공공데이터포털은 응답이 자주 늦는다 — 구 하나가 늦었다고 25개 구를 처음부터 다시 받지 않게 그 구만 몇 번 더 불러 본다
    private List<LocalDataClient.Row> fetch(String code) {
        for (int i = 1; ; i++) {
            try {
                return client.fetchAllOpen(LocalDataClient.Service.REST_CAFE, code);
            } catch (RuntimeException e) {
                if (i == FETCH_TRIES) throw e;
                try {
                    Thread.sleep(FETCH_PAUSE.toMillis());
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw e;
                }
            }
        }
    }

    /** 구 하나의 영업중 휴게음식점을 센다. 아무것도 넣지 않는다 */
    static void count(List<LocalDataClient.Row> rows, Set<String> knownMgtNos, Set<String> knownNameAddrs, Matcher matcher, Tally tally) {
        int matchedHere = 0, unmatchedHere = 0;
        for (LocalDataClient.Row row : rows) {
            if (!row.isOpen()) continue;
            tally.open++;
            String name = row.bplcNm() == null ? "" : row.bplcNm().trim();
            String category = row.category() == null || row.category().isBlank() ? "(업태 없음)" : row.category().trim();
            String address = row.rdnWhlAddr() == null || row.rdnWhlAddr().isBlank() ? row.lotnoAddr() : row.rdnWhlAddr();
            boolean watch = name.contains(WATCH);
            if ((row.mgtNo() != null && knownMgtNos.contains(row.mgtNo())) || knownNameAddrs.contains(RestaurantImportService.key(row))) {
                tally.known++;
                if (watch) tally.watched.add(name + " | " + category + " | " + address + " | 이미 있음");
                continue;
            }
            if (RestaurantImportService.toCafe(LocalDataClient.Service.REST_CAFE, row) != null) {
                tally.cafes++;
                continue;
            }
            int[] n = tally.byCategory.computeIfAbsent(category, c -> new int[3]);
            n[0]++;
            if (RestaurantImportService.toRestaurant(row) == null) {
                n[1]++;
                if (watch) tally.watched.add(name + " | " + category + " | " + address + " | 좌표 없음");
                continue;
            }
            String sbiz = matcher.categoryOf(name, row.rdnWhlAddr(), row.lotnoAddr());
            if (watch) tally.watched.add(name + " | " + category + " | " + address + " | 상가 짝: " + (sbiz == null ? "없음" : sbiz));
            if (sbiz == null) {
                if (CANDIDATES.contains(category) && unmatchedHere++ < SAMPLES_PER_GU) tally.unmatchedSamples.add(name + "(" + category + ")");
                continue;
            }
            n[2]++;
            if (!CANDIDATES.contains(category)) continue;
            tally.sbizOfMatched.merge(sbiz, 1, Integer::sum);
            if (matchedHere++ < SAMPLES_PER_GU) tally.matchedSamples.add(name + "(" + category + "→" + sbiz + ")");
        }
    }

    private static void report(Tally t) {
        log.info("휴게음식점 세어 보기(넣지 않음): 영업중 {}건 — 이미 있는 가게 {}, 카페 규칙으로 들어올 곳 {}, 상가와 짝지어져 새로 받을 수 있는 곳 {}",
                t.open, t.known, t.cafes, t.wouldAdd());
        log.info("휴게음식점 세어 보기 업태별 (전체/좌표 없음/상가와 짝): {}", t.byCategory.entrySet().stream()
                .sorted((a, b) -> b.getValue()[0] - a.getValue()[0])
                .map(e -> e.getKey() + " " + e.getValue()[0] + "/" + e.getValue()[1] + "/" + e.getValue()[2])
                .collect(Collectors.joining(", ")));
        log.info("휴게음식점 세어 보기 새로 받을 곳의 상가 소분류: {}", t.sbizOfMatched.entrySet().stream()
                .sorted((a, b) -> b.getValue() - a.getValue())
                .map(e -> e.getKey() + " " + e.getValue()).collect(Collectors.joining(", ")));
        log.info("휴게음식점 세어 보기 새로 받을 곳 예: {}", String.join(", ", t.matchedSamples));
        log.info("휴게음식점 세어 보기 짝이 없어 안 받을 곳 예: {}", String.join(", ", t.unmatchedSamples));
        log.info("휴게음식점 세어 보기 '{}': {}", WATCH, t.watched.isEmpty() ? "휴게음식점에 없음" : String.join(" / ", t.watched));
    }
}
