package com.intermap.backend.restaurant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 가게의 필터용 업종 (한식·고기·국탕·면·회해산물·중식·일식·양식·아시안·분식·치킨·피자버거·카페·술집).
 * 인허가 업종은 "한식"·"기타"·"경양식"처럼 거칠어서 그대로는 필터로 못 쓴다 — 세 가지 근거를 섞어 정한다
 * (규칙은 resources/cuisine/rules.json, 순서도 거기 적혀 있다):
 *   가게 이름의 낱말("○○칼국수") · 상가(상권)정보의 소분류(SbizPlaces로 짝지은 것) · 인허가 업종
 * 어느 근거로도 정할 수 없으면 null — 그런 가게는 업종을 고르지 않았을 때만 보인다.
 *
 * 카페로 정해진 가게는 한 번 더 카페·베이커리·디저트로 가른다 (cafeKind) — 카페 화면의 종류 필터에 쓴다.
 */
public final class Cuisine {

    private record Words(String cuisine, boolean weak, List<String> words) {
    }

    private record Mapped(String cuisine, boolean vague) {
    }

    private static final List<String> CODES = new ArrayList<>();
    private static final List<Words> NAMES = new ArrayList<>();
    private static final Map<String, Mapped> SBIZ = new HashMap<>();
    private static final Map<String, Mapped> LICENSE = new HashMap<>();
    // 이름에 이 낱말이 있으면 카페로 치지 않는다 (보드게임카페·스터디카페 …)
    private static final List<String> NOT_CAFE = new ArrayList<>();
    private static final String CAFE = "CAFE";
    // 카페의 종류: 이름 낱말(위에서부터) → 상가 소분류 → 인허가 업종 → 어디에도 안 걸리면 맨 앞의 것(카페)
    private static final List<String> CAFE_KINDS = new ArrayList<>();
    private static final List<Words> CAFE_KIND_NAMES = new ArrayList<>();
    private static final Map<String, String> CAFE_KIND_SBIZ = new HashMap<>();
    private static final Map<String, String> CAFE_KIND_LICENSE = new HashMap<>();
    private static final String VERSION;

    static {
        try (InputStream in = Cuisine.class.getResourceAsStream("/cuisine/rules.json")) {
            if (in == null) throw new IllegalStateException("cuisine/rules.json이 없다");
            byte[] bytes = in.readAllBytes();
            JsonNode root = new ObjectMapper().readTree(bytes);
            root.get("cuisines").forEach(c -> CODES.add(c.asText()));
            for (JsonNode group : root.get("names")) {
                List<String> words = new ArrayList<>();
                group.get("words").forEach(w -> words.add(w.asText()));
                NAMES.add(new Words(known(group.get("cuisine").asText()), group.path("weak").asBoolean(false), words));
            }
            read(root.get("sbiz"), SBIZ);
            read(root.get("license"), LICENSE);
            root.get("notCafe").forEach(w -> NOT_CAFE.add(w.asText()));
            JsonNode kinds = root.get("cafeKinds");
            kinds.get("kinds").forEach(k -> CAFE_KINDS.add(k.asText()));
            for (JsonNode group : kinds.get("names")) {
                List<String> words = new ArrayList<>();
                group.get("words").forEach(w -> words.add(w.asText()));
                CAFE_KIND_NAMES.add(new Words(knownKind(group.get("kind").asText()), false, words));
            }
            kinds.get("sbiz").fields().forEachRemaining(e -> CAFE_KIND_SBIZ.put(e.getKey(), knownKind(e.getValue().asText())));
            kinds.get("license").fields().forEachRemaining(e -> CAFE_KIND_LICENSE.put(e.getKey(), knownKind(e.getValue().asText())));
            VERSION = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)).substring(0, 16);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private Cuisine() {
    }

    private static void read(JsonNode node, Map<String, Mapped> into) {
        node.fields().forEachRemaining(e -> into.put(e.getKey(),
                new Mapped(known(e.getValue().get("cuisine").asText()), e.getValue().path("vague").asBoolean(false))));
    }

    private static String known(String code) {
        if (!CODES.contains(code)) throw new IllegalStateException("rules.json에 없는 업종: " + code);
        return code;
    }

    private static String knownKind(String kind) {
        if (!CAFE_KINDS.contains(kind)) throw new IllegalStateException("rules.json에 없는 카페 종류: " + kind);
        return kind;
    }

    /** 업종 코드 전부 (필터에 보이는 순서) */
    public static List<String> codes() {
        return List.copyOf(CODES);
    }

    public static boolean isCode(String code) {
        return CODES.contains(code);
    }

    /** 규칙 파일이 바뀌면 달라지는 값 — 달라졌으면 가게 업종을 다시 채운다 (CuisineBackfill) */
    public static String version() {
        return VERSION;
    }

    /**
     * @param name            가게 이름
     * @param sbizCategory    상가(상권)정보 소분류 (짝지은 것이 없으면 null)
     * @param licenseCategory 인허가 업종 (Restaurant.category)
     * @return 업종 코드, 정할 수 없으면 null
     */
    public static String of(String name, String sbizCategory, String licenseCategory) {
        String text = normalize(name);
        boolean notCafe = contains(text, NOT_CAFE);
        String found = decide(text, sbizCategory, licenseCategory, notCafe);
        // 상가 소분류나 인허가 업종이 카페라고 해도, 이름이 보드게임카페면 카페로 찾는 곳이 아니다
        return notCafe && CAFE.equals(found) ? null : found;
    }

    private static String decide(String text, String sbizCategory, String licenseCategory, boolean notCafe) {
        String byName = byName(text, false, notCafe);
        if (byName != null) return byName;
        Mapped sbiz = sbizCategory == null ? null : SBIZ.get(sbizCategory.trim());
        Mapped license = licenseCategory == null ? null : LICENSE.get(licenseCategory.trim());
        if (sbiz != null && !sbiz.vague()) return sbiz.cuisine();
        if (license != null && !license.vague()) return license.cuisine();
        String byWeakName = byName(text, true, notCafe);
        if (byWeakName != null) return byWeakName;
        if (sbiz != null) return sbiz.cuisine();
        return license == null ? null : license.cuisine();
    }

    /** 카페 종류 코드 전부 — 맨 앞이 기본(카페) */
    public static List<String> cafeKinds() {
        return List.copyOf(CAFE_KINDS);
    }

    public static boolean isCafeKind(String kind) {
        return CAFE_KINDS.contains(kind);
    }

    /**
     * 카페의 종류 — 카페(COFFEE)·베이커리(BAKERY)·디저트(DESSERT).
     * @param cuisine 이 가게의 업종 (of의 결과). 카페가 아니면 종류도 없다
     * @return 종류 코드, 카페가 아니면 null
     */
    public static String cafeKind(String cuisine, String name, String sbizCategory, String licenseCategory) {
        if (!CAFE.equals(cuisine)) return null;
        String text = normalize(name);
        for (Words group : CAFE_KIND_NAMES) {
            if (contains(text, group.words())) return group.cuisine();
        }
        String bySbiz = sbizCategory == null ? null : CAFE_KIND_SBIZ.get(sbizCategory.trim());
        if (bySbiz != null) return bySbiz;
        String byLicense = licenseCategory == null ? null : CAFE_KIND_LICENSE.get(licenseCategory.trim());
        return byLicense != null ? byLicense : CAFE_KINDS.get(0);
    }

    private static String normalize(String name) {
        return name == null ? "" : name.toLowerCase(Locale.ROOT).replaceAll("\\s+", "");
    }

    private static boolean contains(String text, List<String> words) {
        if (text.isEmpty()) return false;
        for (String word : words) {
            if (text.contains(word)) return true;
        }
        return false;
    }

    private static String byName(String text, boolean weak, boolean notCafe) {
        if (text.isEmpty()) return null;
        for (Words group : NAMES) {
            if (group.weak() != weak) continue;
            if (notCafe && CAFE.equals(group.cuisine())) continue;
            if (contains(text, group.words())) return group.cuisine();
        }
        return null;
    }
}
