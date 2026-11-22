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
        String text = name == null ? "" : name.toLowerCase(Locale.ROOT).replaceAll("\\s+", "");
        String byName = byName(text, false);
        if (byName != null) return byName;
        Mapped sbiz = sbizCategory == null ? null : SBIZ.get(sbizCategory.trim());
        Mapped license = licenseCategory == null ? null : LICENSE.get(licenseCategory.trim());
        if (sbiz != null && !sbiz.vague()) return sbiz.cuisine();
        if (license != null && !license.vague()) return license.cuisine();
        String byWeakName = byName(text, true);
        if (byWeakName != null) return byWeakName;
        if (sbiz != null) return sbiz.cuisine();
        return license == null ? null : license.cuisine();
    }

    private static String byName(String text, boolean weak) {
        if (text.isEmpty()) return null;
        for (Words group : NAMES) {
            if (group.weak() != weak) continue;
            for (String word : group.words()) {
                if (text.contains(word)) return group.cuisine();
            }
        }
        return null;
    }
}
