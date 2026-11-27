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

    // 음료는 팔지만 카페를 찾는 사람이 가려는 곳은 아닌 가게들
    @Test
    void placesThatOnlyServeDrinksOnTheSideAreNotCafes() {
        assertNull(Cuisine.of("홈즈앤루팡 보드게임카페", null, "기타"));
        assertNull(Cuisine.of("작심 스터디카페", "카페", "까페"), "상가 소분류와 인허가 업종이 카페라고 해도");
        assertNull(Cuisine.of("놀숲 만화카페", null, "커피숍"));
        assertEquals("CAFE", Cuisine.of("북카페 파오", null, "기타"), "책 읽는 카페는 카페");
        assertEquals("CAFE", Cuisine.of("빽다방 방학역점", null, "기타"), "낱말이 우연히 겹친 것은 그대로 카페");
        assertEquals("CHICKEN", Cuisine.of("보드게임카페 치킨", null, "기타"), "카페만 빼고 다른 업종은 그대로 본다");
    }

    @Test
    void theNewLicenseCategoriesAreCafes() {
        assertEquals("CAFE", Cuisine.of("성심당", null, "제과점"));
        assertEquals("CAFE", Cuisine.of("모모", null, "아이스크림"));
        assertEquals("CAFE", Cuisine.of("모모", null, "과자점"));
        assertNull(Cuisine.of("모모", null, "편의점"));
        assertNull(Cuisine.of("모모", null, "기타 휴게음식점"));
    }

    // 카페의 종류: 이름 낱말(베이커리 → 디저트 → 카페) → 상가 소분류 → 인허가 업종 → 카페
    @Test
    void cafesSplitIntoCoffeeBakeryAndDessert() {
        assertEquals(java.util.List.of("COFFEE", "BAKERY", "DESSERT"), Cuisine.cafeKinds());
        assertEquals("BAKERY", Cuisine.cafeKind("CAFE", "파리바게뜨 신촌점", "카페", "기타"));
        assertEquals("BAKERY", Cuisine.cafeKind("CAFE", "오월의 베이커리 카페", null, "커피숍"), "빵집 낱말이 카페 낱말보다 앞선다");
        assertEquals("DESSERT", Cuisine.cafeKind("CAFE", "설빙 홍대점", "카페", "기타"));
        assertEquals("DESSERT", Cuisine.cafeKind("CAFE", "누니 케이크", "빵/도넛", "제과점"), "케이크 가게는 빵집이 아니라 디저트");
        assertEquals("COFFEE", Cuisine.cafeKind("CAFE", "Star Coffee 여의도점", "빵/도넛", "기타"), "이름이 커피면 소분류를 따르지 않는다");
        assertEquals("BAKERY", Cuisine.cafeKind("CAFE", "성심당", "빵/도넛", "기타"), "이름에 단서가 없으면 상가 소분류");
        assertEquals("DESSERT", Cuisine.cafeKind("CAFE", "모모", "아이스크림/빙수", "기타"));
        assertEquals("BAKERY", Cuisine.cafeKind("CAFE", "성심당", null, "제과점"), "그다음은 인허가 업종");
        assertEquals("DESSERT", Cuisine.cafeKind("CAFE", "모모", null, "아이스크림"));
        assertEquals("COFFEE", Cuisine.cafeKind("CAFE", "모모", null, "까페"), "어디에도 안 걸리면 카페");
        assertNull(Cuisine.cafeKind("KOREAN", "빵굽는 한식당", null, "한식"), "카페가 아니면 종류도 없다");
        assertNull(Cuisine.cafeKind(null, "모모", null, "기타"));
        assertTrue(Cuisine.isCafeKind("BAKERY"));
        assertFalse(Cuisine.isCafeKind("CAFE"));
    }

    // 휴게음식점으로 등록한 식당들 — 상가 소분류가 '그 외 기타 간이 음식점'이라 이름으로 잡아야 한다
    @Test
    void lightMealsAreFiled() {
        assertEquals("KOREAN", Cuisine.of("샤브토랑 대학로점", "그 외 기타 간이 음식점", "기타 휴게음식점"));
        assertEquals("CHINESE", Cuisine.of("용가회전 훠궈 샤브샤브", null, "기타"), "'샤브'는 약한 낱말이라 훠궈를 못 이긴다");
        assertEquals("NOODLE", Cuisine.of("등촌샤브칼국수", "그 외 기타 간이 음식점", "기타 휴게음식점"));
        assertEquals("SNACK", Cuisine.of("이삭토스트 종각역점", "토스트/샌드위치/샐러드", "기타 휴게음식점"));
        assertEquals("SNACK", Cuisine.of("써브웨이 답십리역점", "피자", "패스트푸드"));
        assertEquals("CAFE", Cuisine.of("카페 샌드위치하우스", null, "기타 휴게음식점"), "카페가 먼저 걸린다");
        assertEquals("WESTERN", Cuisine.of("샐러디 강남점", "피자", "기타 휴게음식점"), "샐러드·포케는 양식에 둔다");
        assertEquals("WESTERN", Cuisine.of("포케올데이", "토스트/샌드위치/샐러드", "일반조리판매"));
        assertEquals("WESTERN", Cuisine.of("슬로우캘리", "토스트/샌드위치/샐러드", "일반조리판매"), "이름에 낱말이 없으면 상가 소분류로");
        assertEquals("PIZZA_BURGER", Cuisine.of("번패티번", "버거", "패스트푸드"));
        assertEquals("PIZZA_BURGER", Cuisine.of("타마", "피자", "기타 휴게음식점"));
        assertEquals("CAFE", Cuisine.of("서울호떡", "그 외 기타 간이 음식점", "일반조리판매"));
        assertEquals("CHINESE", Cuisine.of("오한수 우육면가", "분류 안된 외국식 음식점", "한식"));
        assertNull(Cuisine.of("가로판매점", "그 외 기타 간이 음식점", "기타 휴게음식점"));
    }
}
