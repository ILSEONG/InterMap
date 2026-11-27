package com.intermap.backend.localdata;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 휴게음식점 세어 보기: 이미 있는 가게·카페는 빼고, 나머지를 업태별로 세며 상가와 짝지어지는 후보만 "받을 곳"으로 친다
class RestEaterySurveyTest {

    // 실제 인허가 좌표 샘플 (서울 마포구 서교동)
    private static final String X = "192882.950546117";
    private static final String Y = "449785.876729486";

    private static LocalDataClient.Row row(String mgtNo, String name, String category, String x) {
        return new LocalDataClient.Row(mgtNo, name, "서울특별시 종로구 대명길 23, 1층 (명륜4가)", "서울특별시 종로구 명륜4가 47-2",
                category, x, x == null ? null : Y, "01", null);
    }

    @Test
    void countsWhatWouldComeIn() {
        List<LocalDataClient.Row> rows = List.of(
                row("m1", "이미있는분식", "기타 휴게음식점", X),
                row("m2", "샤브토랑 대학로점", "기타 휴게음식점", X),
                row("m3", "별빛피씨방", "기타 휴게음식점", X),
                row("m4", "좌표없는김밥", "일반조리판매", null),
                row("m5", "씨유 명륜점", "편의점", X),
                new LocalDataClient.Row("m6", "문닫은토스트", "서울 종로구 대명길 1", "서울 종로구 명륜4가 1", "일반조리판매", X, Y, "03", null));
        Set<String> knownMgtNos = new HashSet<>(Set.of("m1"));
        RestEaterySurvey.Matcher matcher = (name, road, lot) ->
                name.startsWith("샤브토랑") ? "그 외 기타 간이 음식점" : name.startsWith("씨유") ? "김밥/만두/분식" : null;

        RestEaterySurvey.Tally tally = new RestEaterySurvey.Tally();
        RestEaterySurvey.count(rows, knownMgtNos, new HashSet<>(), matcher, tally);

        assertEquals(5, tally.open, "폐업한 행은 세지 않는다");
        assertEquals(1, tally.known);
        assertArrayEquals(new int[]{2, 0, 1}, tally.byCategory.get("기타 휴게음식점"));
        assertArrayEquals(new int[]{1, 1, 0}, tally.byCategory.get("일반조리판매"));
        assertArrayEquals(new int[]{1, 0, 1}, tally.byCategory.get("편의점"));
        assertEquals(1, tally.wouldAdd(), "편의점은 상가와 짝지어져도 받지 않는다");
        assertEquals(1, tally.sbizOfMatched.get("그 외 기타 간이 음식점"));
        assertTrue(tally.unmatchedSamples.get(0).startsWith("별빛피씨방"));
        assertTrue(tally.watched.get(0).contains("상가 짝: 그 외 기타 간이 음식점"));
    }
}
