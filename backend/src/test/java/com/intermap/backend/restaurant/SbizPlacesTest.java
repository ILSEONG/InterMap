package com.intermap.backend.restaurant;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.GZIPOutputStream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 상가(상권)정보와 우리 가게 짝짓기 — 같은 건물에 같은 이름(또는 이름이 포함 관계)일 때만
class SbizPlacesTest {

    static SbizPlaces places(String... lines) {
        try {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (GZIPOutputStream gz = new GZIPOutputStream(bytes)) {
                gz.write(String.join("\n", lines).getBytes(StandardCharsets.UTF_8));
            }
            return SbizPlaces.read(new ByteArrayInputStream(bytes.toByteArray()));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private final SbizPlaces places = places(
            "타이엘리펀트,,베트남식 전문,서울특별시 강남구 강남대로84길 33,서울특별시 강남구 역삼동 824-25",
            "스타벅스,강남R점,카페,서울특별시 강남구 강남대로 390,서울특별시 강남구 역삼동 825-22",
            "오성해물탕,,국/탕/찌개류,서울특별시 영등포구 국회대로76길 18,서울특별시 영등포구 여의도동 44-3",
            "비노비타,공덕점,경양식,서울특별시 마포구 백범로 152,서울특별시 마포구 공덕동 467",
            "\"쉼표, 있는 집\",,백반/한정식,서울특별시 중구 을지로 100,서울특별시 중구 을지로2가 10");

    @Test
    void sameBuildingAndSameName() {
        assertEquals("베트남식 전문", places.categoryOf("타이엘리펀트",
                "서울특별시 강남구 강남대로84길 33, 2층 201호 (역삼동, 테스트빌딩)", "서울특별시 강남구 역삼동 824-25"));
        assertEquals("베트남식 전문", places.categoryOf("타이 엘리펀트(강남점)", "서울특별시 강남구 강남대로84길 33", null),
                "띄어쓰기와 괄호 속은 견주지 않는다");
    }

    @Test
    void theLotAddressAloneIsEnough() {
        assertEquals("베트남식 전문", places.categoryOf("타이엘리펀트", null, "서울특별시 강남구 역삼동 824-25번지 2층"));
        assertEquals("베트남식 전문", places.categoryOf("타이엘리펀트", "서울특별시 강남구 다른길 1", "서울특별시 강남구 역삼동 824-25"));
    }

    @Test
    void theBranchNameMayOrMayNotBeThere() {
        assertEquals("카페", places.categoryOf("스타벅스 강남R점", "서울특별시 강남구 강남대로 390", null));
        assertEquals("카페", places.categoryOf("스타벅스", "서울특별시 강남구 강남대로 390", null));
    }

    @Test
    void oneNameInsideTheOtherAlsoCounts() {
        assertEquals("국/탕/찌개류", places.categoryOf("오성해물탕별관", "서울특별시 영등포구 국회대로76길 18, 2층 208호 (여의도동)", null));
        assertEquals("카페", places.categoryOf("(주)스타벅스커피코리아 스타벅스 강남R점", "서울특별시 강남구 강남대로 390", null));
    }

    @Test
    void merelySimilarNamesAreNotMatched() {
        assertNull(places.categoryOf("비비큐공덕점", "서울특별시 마포구 백범로 152, 101동 1층 (공덕동)", "서울특별시 마포구 공덕동 467"));
    }

    @Test
    void theSameNameInAnotherBuildingIsNotMatched() {
        assertNull(places.categoryOf("타이엘리펀트", "서울특별시 강남구 강남대로84길 35", "서울특별시 강남구 역삼동 900"));
        assertNull(places.categoryOf("타이엘리펀트", null, null));
        assertNull(places.categoryOf("", "서울특별시 강남구 강남대로84길 33", null));
    }

    @Test
    void quotedCellsKeepTheirCommas() {
        assertEquals(List.of("쉼표, 있는 집", "", "따옴표 \" 하나"), SbizPlaces.fields("\"쉼표, 있는 집\",,\"따옴표 \"\" 하나\""));
        assertEquals("백반/한정식", places.categoryOf("쉼표 있는 집", "서울특별시 중구 을지로 100", null));
    }

    @Test
    void addressKeysIgnoreFloorsAndBracketedNeighborhoods() {
        assertEquals("서울|강남구|선릉로|660", AddressText.roadKey("서울특별시 강남구 선릉로 660, 지하1층 B110호,B111호 (삼성동, 브라운스톤 레전드)"));
        assertEquals("서울|영등포구|국제금융로8길|25", AddressText.roadKey("서울특별시 영등포구 국제금융로8길 25 (여의도동)"));
        assertEquals(AddressText.roadKey("서울특별시 중구 을지로 지하 12"), AddressText.roadKey("서울특별시 중구 을지로 지하12, B1"));
        assertNotEquals(AddressText.roadKey("서울특별시 중구 을지로 지하 12"), AddressText.roadKey("서울특별시 중구 을지로 12"));
        assertEquals("서울|종로구|창신동|703", AddressText.lotKey("서울특별시 종로구 창신동 703-0"), "번지 뒤의 -0은 뗀다");
        assertEquals("서울|종로구|종로1가|24", AddressText.lotKey("서울특별시 종로구 종로1가 24번지"));
        assertEquals("서울|중구|소공동|1", AddressText.lotKey("서울특별시 중구 소공동 1 (롯데백화점 지하1층)"));
        assertNull(AddressText.roadKey("주소 없음"));
        assertNull(AddressText.roadKey(null));
        assertNull(AddressText.lotKey(" "));
    }

    @Test
    void noFileMeansNoMatches() throws IOException {
        SbizPlaces none = SbizPlaces.read(null);
        assertTrue(none.isEmpty());
        assertNull(none.categoryOf("타이엘리펀트", "서울특별시 강남구 강남대로84길 33", null));
    }

    @Test
    void theBundledFileLoads() {
        SbizPlaces bundled = SbizPlaces.load();
        assertTrue(bundled.size() > 50_000, "서버에 실린 서울 음식 상가 파일: " + bundled.size() + "행");
        assertNotEquals("none", bundled.version());
    }
}
