package com.intermap.backend.restaurant;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

// 필터용 업종을 정하는 순서 (resources/cuisine/rules.json) — Cuisine.of(가게 이름, 상가 소분류, 인허가 업종)
class CuisineTest {

    @Test
    void aWordInTheNameWinsOverBothCategories() {
        assertEquals("CHINESE", Cuisine.of("교동짬뽕", "백반/한정식", "한식"));
        assertEquals("CAFE", Cuisine.of("Star Coffee 여의도점", "요리 주점", "경양식"), "대소문자와 띄어쓰기는 가리지 않는다");
        assertEquals("CHICKEN", Cuisine.of("BHC 봉천스타점", null, "호프/통닭"));
    }

    @Test
    void whenSeveralWordsFitTheMoreTellingOneWins() {
        assertEquals("CHICKEN", Cuisine.of("치킨호프", null, "기타"));
        assertEquals("ASIAN", Cuisine.of("하노이 쌀국수", null, "한식"), "쌀국수는 면집이 아니라 아시안");
        assertEquals("SOUP", Cuisine.of("갈비탕 명가", null, "한식"), "갈비탕은 고깃집이 아니라 국·탕");
        assertEquals("SOUP", Cuisine.of("할매순대국", null, "분식"));
        assertEquals("NOODLE", Cuisine.of("해물칼국수", null, "한식"));
        assertEquals("SNACK", Cuisine.of("청년다방 신촌점", null, "기타"), "떡볶이집이지 찻집이 아니다");
    }

    @Test
    void aClearSbizCategoryBeatsTheLicenseCategory() {
        assertEquals("JAPANESE", Cuisine.of("타마", "일식 회/초밥", "한식"));
        assertEquals("MEAT", Cuisine.of("타마", "돼지고기 구이/찜", "분식"));
    }

    @Test
    void aClearLicenseCategoryBeatsAVagueSbizCategory() {
        assertEquals("JAPANESE", Cuisine.of("타마", "백반/한정식", "일식"));
        assertEquals("CHINESE", Cuisine.of("타마", "요리 주점", "중국식"));
    }

    @Test
    void weakWordsCountOnlyWhenNothingClearIsKnown() {
        assertEquals("KOREAN", Cuisine.of("제일식당", null, "기타"));
        assertEquals("MEAT", Cuisine.of("제일식당", "돼지고기 구이/찜", "한식"), "'식당'은 뚜렷한 소분류를 못 이긴다");
        assertEquals("SEAFOOD", Cuisine.of("별이네 포차", "횟집", "한식"));
        assertEquals("BAR", Cuisine.of("별이네 포차", "요리 주점", "한식"));
        assertEquals("KOREAN", Cuisine.of("한양식당", "경양식", "경양식"), "약한 낱말이라도 뭉뚱그린 분류보다는 앞선다");
        assertEquals("BAR", Cuisine.of("퀸스바(Queens Bar)", null, "경양식"));
    }

    @Test
    void vagueCategoriesAreTheLastResort() {
        assertEquals("WESTERN", Cuisine.of("타마", "경양식", "한식"), "뭉뚱그린 것끼리는 상가 소분류가 먼저");
        assertEquals("KOREAN", Cuisine.of("타마", null, "한식"));
        assertEquals("BAR", Cuisine.of("타마", null, "호프/통닭"));
    }

    @Test
    void namesThatOnlyLookLikeACuisineAreNotFooled() {
        assertEquals("KOREAN", Cuisine.of("통일식당", null, "한식"), "'일식'이 들어 있지만 일식집이 아니다");
        assertEquals("KOREAN", Cuisine.of("한양식당", null, "한식"), "'양식'이 들어 있지만 양식집이 아니다");
        assertEquals("SOUP", Cuisine.of("이태리부대찌개", null, "한식"));
    }

    @Test
    void nothingToGoOnMeansNoCuisine() {
        assertNull(Cuisine.of("타마", null, "기타"));
        assertNull(Cuisine.of("타마", "구내식당", "뷔페식"));
        assertNull(Cuisine.of(null, null, null));
        assertNull(Cuisine.of("", " ", ""));
    }

    @Test
    void codesAreTheFourteenFilterChoices() {
        assertEquals(14, Cuisine.codes().size());
        assertTrue(Cuisine.isCode("PIZZA_BURGER"));
        assertFalse(Cuisine.isCode("기타"));
        assertFalse(Cuisine.isCode(null));
    }
}
