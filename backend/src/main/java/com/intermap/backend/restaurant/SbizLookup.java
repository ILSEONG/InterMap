package com.intermap.backend.restaurant;

/**
 * 상가(상권)정보 짝짓기(SbizPlaces)를 다른 패키지에서 쓰는 창구.
 * 만들 때 상가 파일(13만 행)을 메모리에 올린다 — 쓰고 나면 놓아 줄 것.
 */
public final class SbizLookup {

    private final SbizPlaces places = SbizPlaces.load();

    /** 상가 파일이 서버에 실려 있지 않으면 true */
    public boolean isEmpty() {
        return places.isEmpty();
    }

    /** 같은 건물에 같은 이름으로 있는 상가의 소분류 ("김밥/만두/분식"). 짝이 없으면 null */
    public String categoryOf(String name, String roadAddress, String lotAddress) {
        return places.categoryOf(name, roadAddress, lotAddress);
    }
}
