package com.intermap.backend.restaurant;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 인허가 주소 문자열을 주소 검색에 넣을 수 있게 다듬는다. */
public final class AddressText {

    private AddressText() {
    }

    // 인허가 도로명 주소엔 "서울특별시 마포구 와우산로 21, 2층 (서교동)"처럼 층·호·동 이름이 붙는다.
    // 주소 검색은 건물까지만 알면 되고 꼬리가 붙으면 못 찾는 경우가 있어 쉼표·괄호 뒤를 자른다.
    public static String cleanRoad(String road) {
        if (road == null) return null;
        String s = road.replaceAll("\\(.*?\\)", " ");
        int comma = s.indexOf(',');
        if (comma >= 0) s = s.substring(0, comma);
        s = s.replaceAll("\\s+", " ").trim();
        return s.isEmpty() ? null : s;
    }

    // 지번 주소는 "서울특별시 마포구 서교동 395-17 2층"처럼 번지 뒤에 층·호가 붙는다 — 번지까지만.
    private static final Pattern LOT = Pattern.compile("^(.*?\\s(?:산\\s?)?\\d+(?:-\\d+)?)(?:\\s|,|$)");

    public static String cleanLot(String lot) {
        if (lot == null || lot.isBlank()) return null;
        Matcher m = LOT.matcher(lot.trim());
        return m.find() ? m.group(1).trim() : lot.trim();
    }

    /** 띄어쓰기를 뺀 비교용 문자열 ("을지로 지하 12"와 "을지로 지하12"를 같게 본다) */
    static String squash(String s) {
        return s == null ? "" : s.replaceAll("\\s+", "");
    }
}
