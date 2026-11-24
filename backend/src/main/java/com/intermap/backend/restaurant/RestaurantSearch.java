package com.intermap.backend.restaurant;

import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

// 가게 검색 — 검색어를 띄어쓰기로 나눈 낱말마다 이름·업종·주소(지번·도로명) 어딘가에 들어 있어야 한다.
// "타마 여의도" → 여의도에 있는 타마. 낱말 순서는 상관없다. 영업 중인 가게만.
// 업종을 주면 그 업종의 가게 안에서만 찾는다 (카페 화면의 검색 — 상한 50건을 카페로만 채운다).
@Component
public class RestaurantSearch {

    // 이보다 뒤의 낱말은 보지 않는다 (낱말마다 가게 표 전체를 한 번씩 견준다)
    static final int MAX_WORDS = 4;

    // 낱말을 찾아보는 글 — 이름·업종·지번 주소·도로명 주소를 이어 붙인 것
    private static final String TEXT = "upper(concat(coalesce(r.name, ''), ' ', coalesce(r.category, ''), ' ',"
            + " coalesce(r.address, ''), ' ', coalesce(r.roadAddress, '')))";

    private final EntityManager em;

    public RestaurantSearch(EntityManager em) {
        this.em = em;
    }

    public List<Restaurant> find(String q, int limit) {
        return find(q, limit, null, null);
    }

    /**
     * @param cuisine 이 업종의 가게만 (Cuisine 코드). null이면 전부
     * @param exceptCuisine 이 업종의 가게는 뺀다 (업종이 안 정해진 가게는 남는다). null이면 빼지 않는다
     */
    public List<Restaurant> find(String q, int limit, String cuisine, String exceptCuisine) {
        List<String> words = words(q);
        if (words.isEmpty()) return List.of();
        StringBuilder everywhere = new StringBuilder();
        StringBuilder inName = new StringBuilder();
        for (int i = 0; i < words.size(); i++) {
            everywhere.append(" and ").append(TEXT).append(" like :w").append(i).append(" escape '!'");
            inName.append(i == 0 ? "" : " and ").append("upper(r.name) like :w").append(i).append(" escape '!'");
        }
        // 낱말이 전부 이름에 든 가게를 앞에 — 주소에 "여의도"가 든 수천 곳이 이름이 "여의도…"인 가게를 밀어내지 않게
        TypedQuery<Restaurant> query = em.createQuery("select r from Restaurant r where r.status = :status"
                + (cuisine == null ? "" : " and r.cuisine = :cuisine")
                + (exceptCuisine == null ? "" : " and (r.cuisine is null or r.cuisine <> :except)") + everywhere
                + " order by case when " + inName + " then 0 else 1 end, r.id", Restaurant.class);
        query.setParameter("status", Restaurant.Status.OPEN);
        if (cuisine != null) query.setParameter("cuisine", cuisine);
        if (exceptCuisine != null) query.setParameter("except", exceptCuisine);
        for (int i = 0; i < words.size(); i++) {
            query.setParameter("w" + i, "%" + words.get(i) + "%");
        }
        return query.setMaxResults(limit).getResultList();
    }

    // 검색어 → 낱말들. 대소문자를 가리지 않게 대문자로, %와 _는 글자 그대로 찾게 '!'로 막는다 (like … escape '!')
    static List<String> words(String q) {
        List<String> words = new ArrayList<>();
        if (q == null) return words;
        for (String word : q.trim().split("\\s+")) {
            if (word.isEmpty() || words.size() == MAX_WORDS) continue;
            words.add(word.toUpperCase(Locale.ROOT).replace("!", "!!").replace("%", "!%").replace("_", "!_"));
        }
        return words;
    }
}
