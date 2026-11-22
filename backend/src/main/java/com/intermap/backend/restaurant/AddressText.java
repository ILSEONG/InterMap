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

    private static final Pattern NUMBER = Pattern.compile("(산)?\\d+(-\\d+)?(번지)?");

    /**
     * 도로명 주소 → 건물 하나를 가리키는 키 ("서울|강남구|선릉로|660"). 층·호·괄호 속 동 이름은 버린다. 못 읽으면 null.
     * 같은 건물에 있는지 견줄 때 쓴다 (SbizPlaces) — 주소 글이 조금 달라도 건물 번호까지만 같으면 같은 키가 나온다
     */
    public static String roadKey(String road) {
        return key(road, "로", "길");
    }

    /** 지번 주소 → 필지 하나를 가리키는 키 ("서울|강남구|역삼동|824-25"). 못 읽으면 null */
    public static String lotKey(String lot) {
        return key(lot, "동", "가", "리");
    }

    // 시·도(앞 두 글자), 구·군, 이름이 endings로 끝나는 낱말과 바로 뒤의 번호. 번호의 "-0"과 "번지"는 뗀다
    private static String key(String address, String... endings) {
        if (address == null || address.isBlank()) return null;
        String[] toks = address.trim().split("\\s+");
        for (int i = 0; i < toks.length; i++) toks[i] = toks[i].replace(",", "");
        for (int i = 1; i + 1 < toks.length; i++) {
            String t = toks[i];
            boolean named = false;
            for (String ending : endings) named |= t.endsWith(ending);
            if (!named) continue;
            String next = toks[i + 1];
            String prefix = "";
            if (next.equals("지하") && i + 2 < toks.length) {
                next = toks[i + 2];
                prefix = "지하";
            } else if (next.startsWith("지하") && next.length() > 2) {
                next = next.substring(2);
                prefix = "지하";
            }
            if (!NUMBER.matcher(next).matches()) continue;
            String number = next.replace("번지", "");
            if (number.endsWith("-0")) number = number.substring(0, number.length() - 2);
            String district = "";
            for (int j = 1; j < i; j++) {
                if (toks[j].endsWith("구") || toks[j].endsWith("군")) {
                    district = toks[j];
                    break;
                }
            }
            String region = toks[0].length() > 2 ? toks[0].substring(0, 2) : toks[0];
            return region + "|" + district + "|" + t + "|" + prefix + number;
        }
        return null;
    }

    /** 띄어쓰기를 뺀 비교용 문자열 ("을지로 지하 12"와 "을지로 지하12"를 같게 본다) */
    static String squash(String s) {
        return s == null ? "" : s.replaceAll("\\s+", "");
    }
}
