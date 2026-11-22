package com.intermap.backend.restaurant;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.GZIPInputStream;

/**
 * 소상공인시장진흥공단 상가(상권)정보의 서울 음식점 (resources/cuisine/seoul-food.csv.gz — tools/sbiz/build.py가 만든다).
 * 인허가 업종보다 잘게 나뉜 소분류("돼지고기 구이/찜", "카페", "마라탕/훠궈")를 우리 가게에 덧입히려고 쓴다.
 *
 * 짝짓는 법: 같은 건물(도로명 건물번호가 같거나 지번이 같다)에 있고 이름이 같은 곳. 없으면 이름이 포함 관계인 곳
 * ("오성해물탕별관" ↔ "오성해물탕"). 서울 3만 8천 곳으로 재 보니 70%가 이렇게 짝지어졌다. 이름이 "비슷한" 정도로는
 * 짝짓지 않는다 — 열에 넷이 틀렸다.
 *
 * 13만 행을 통째로 들고 있으면 작은 서버(힙 256MB)에 부담이라 줄여서 든다 — 이름은 견줄 수 있게 글로,
 * 주소 키는 해시로만 (행 번호와 한 long에 묶어 정렬해 두고 이진 탐색).
 */
final class SbizPlaces {

    private static final String RESOURCE = "/cuisine/seoul-food.csv.gz";
    // 한 long = 주소 키 해시의 위 44비트 + 행 번호 20비트
    private static final int ROW_BITS = 20;
    private static final long ROW_MASK = (1L << ROW_BITS) - 1;

    private final String[] names;
    // 이름+지점명 ("스타벅스"+"강남점"). 지점명이 없으면 names와 같은 글
    private final String[] fullNames;
    private final short[] categoryOf;
    private final List<String> categories;
    private final long[] byRoad;
    private final long[] byLot;
    private final String version;

    private SbizPlaces(String[] names, String[] fullNames, short[] categoryOf, List<String> categories,
                       long[] byRoad, long[] byLot, String version) {
        this.names = names;
        this.fullNames = fullNames;
        this.categoryOf = categoryOf;
        this.categories = categories;
        this.byRoad = byRoad;
        this.byLot = byLot;
        this.version = version;
    }

    /** 서버에 실린 파일을 읽는다. 파일이 없으면 빈 것 (isEmpty) */
    static SbizPlaces load() {
        try (InputStream in = SbizPlaces.class.getResourceAsStream(RESOURCE)) {
            if (in == null) return read(null);
            return read(in);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** gzip으로 묶은 CSV(상호, 지점, 소분류, 도로명주소, 지번주소)를 읽는다. null이면 빈 것 */
    static SbizPlaces read(InputStream gzipped) throws IOException {
        List<String> names = new ArrayList<>();
        List<String> fullNames = new ArrayList<>();
        List<Short> categoryOf = new ArrayList<>();
        List<String> categories = new ArrayList<>();
        Map<String, Short> categoryIndex = new HashMap<>();
        List<Long> road = new ArrayList<>();
        List<Long> lot = new ArrayList<>();
        String version = "none";
        if (gzipped != null) {
            MessageDigest digest = sha256();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    new GZIPInputStream(new DigestInputStream(gzipped, digest)), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    List<String> f = fields(line);
                    if (f.size() < 5) continue;
                    String name = normalize(f.get(0));
                    if (name.isEmpty()) continue;
                    int row = names.size();
                    if (row > ROW_MASK) throw new IllegalStateException("상가 파일이 너무 크다 (행 번호가 20비트를 넘는다)");
                    names.add(name);
                    String branch = normalize(f.get(1));
                    fullNames.add(branch.isEmpty() ? name : name + branch);
                    categoryOf.add(categoryIndex.computeIfAbsent(f.get(2).trim(), c -> {
                        categories.add(c);
                        return (short) (categories.size() - 1);
                    }));
                    String roadKey = AddressText.roadKey(f.get(3));
                    String lotKey = AddressText.lotKey(f.get(4));
                    if (roadKey != null) road.add(pack(roadKey, row));
                    if (lotKey != null) lot.add(pack(lotKey, row));
                }
            }
            version = HexFormat.of().formatHex(digest.digest()).substring(0, 16);
        }
        short[] cats = new short[categoryOf.size()];
        for (int i = 0; i < cats.length; i++) cats[i] = categoryOf.get(i);
        return new SbizPlaces(names.toArray(String[]::new), fullNames.toArray(String[]::new), cats, categories,
                sorted(road), sorted(lot), version);
    }

    boolean isEmpty() {
        return names.length == 0;
    }

    int size() {
        return names.length;
    }

    /** 파일 내용이 바뀌면 달라지는 값 */
    String version() {
        return version;
    }

    /** 이 가게와 짝지어지는 상가의 소분류. 짝이 없으면 null */
    String categoryOf(String name, String roadAddress, String lotAddress) {
        String wanted = normalize(name);
        if (wanted.isEmpty() || isEmpty()) return null;
        int[] rows = merge(rowsAt(byRoad, AddressText.roadKey(roadAddress)), rowsAt(byLot, AddressText.lotKey(lotAddress)));
        for (int row : rows) {
            if (wanted.equals(names[row]) || wanted.equals(fullNames[row])) return categories.get(categoryOf[row]);
        }
        if (wanted.length() < 2) return null;
        for (int row : rows) {
            if (names[row].length() >= 2 && (fullNames[row].contains(wanted) || wanted.contains(names[row]))) {
                return categories.get(categoryOf[row]);
            }
        }
        return null;
    }

    // ---- 견주기 ----

    /** 견줄 수 있게 다듬은 이름 — 소문자, 괄호 속과 띄어쓰기·기호를 뺀다 ("가장맛있는 족발(동묘점)" → "가장맛있는족발") */
    static String normalize(String name) {
        if (name == null) return "";
        return name.toLowerCase(Locale.ROOT).replaceAll("\\(.*?\\)", "").replaceAll("[^0-9a-z가-힣]", "");
    }

    private static long pack(String key, int row) {
        return (hash(key) & ~ROW_MASK) | row;
    }

    // FNV-1a 64비트 — 주소 키 30만 개를 44비트로 줄여도 서로 겹칠 일은 사실상 없고, 겹쳐도 이름을 한 번 더 견준다
    private static long hash(String key) {
        long h = 0xcbf29ce484222325L;
        for (int i = 0; i < key.length(); i++) {
            h ^= key.charAt(i);
            h *= 0x100000001b3L;
        }
        // 아래 비트는 버리므로 위쪽으로 섞어 올린다
        return h ^ (h << 21) ^ (h >>> 17);
    }

    private static long[] sorted(List<Long> packed) {
        long[] out = new long[packed.size()];
        for (int i = 0; i < out.length; i++) out[i] = packed.get(i);
        Arrays.sort(out);
        return out;
    }

    private static final int[] NONE = {};

    // 정렬된 묶음에서 이 키의 행 번호들 (행 번호 오름차순)
    private static int[] rowsAt(long[] index, String key) {
        if (key == null || index.length == 0) return NONE;
        long want = hash(key) & ~ROW_MASK;
        int lo = 0, hi = index.length;
        while (lo < hi) {
            int mid = (lo + hi) >>> 1;
            if (index[mid] < want) lo = mid + 1;
            else hi = mid;
        }
        int end = lo;
        while (end < index.length && (index[end] & ~ROW_MASK) == want) end++;
        int[] rows = new int[end - lo];
        for (int i = lo; i < end; i++) rows[i - lo] = (int) (index[i] & ROW_MASK);
        return rows;
    }

    private static int[] merge(int[] a, int[] b) {
        if (b.length == 0) return a;
        if (a.length == 0) return b;
        int[] out = Arrays.copyOf(a, a.length + b.length);
        int n = a.length;
        for (int row : b) {
            boolean seen = false;
            for (int i = 0; i < a.length && !seen; i++) seen = a[i] == row;
            if (!seen) out[n++] = row;
        }
        return Arrays.copyOf(out, n);
    }

    // CSV 한 줄 → 칸들 (큰따옴표로 감싼 칸과 그 안의 쉼표·"" 처리)
    static List<String> fields(String line) {
        List<String> out = new ArrayList<>(5);
        StringBuilder cell = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (quoted) {
                if (c == '"' && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    cell.append('"');
                    i++;
                } else if (c == '"') quoted = false;
                else cell.append(c);
            } else if (c == '"') quoted = true;
            else if (c == ',') {
                out.add(cell.toString());
                cell.setLength(0);
            } else cell.append(c);
        }
        out.add(cell.toString());
        return out;
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
