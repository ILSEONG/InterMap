package com.intermap.backend.place;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.List;

@Service
public class PlaceSearchService {

    private final RestClient restClient;
    private final String clientId;
    private final String clientSecret;

    public PlaceSearchService(
        @Value("${naver.search.client-id}") String clientId,
        @Value("${naver.search.client-secret}") String clientSecret
    ) {
        this.restClient = RestClient.builder().baseUrl("https://openapi.naver.com/v1/search/local.json").build();
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    public List<PlaceSearchResult> search(String query) {
        if (clientId.isBlank() || clientSecret.isBlank()) {
            throw new IllegalStateException(
                "NAVER_SEARCH_CLIENT_ID / NAVER_SEARCH_CLIENT_SECRET 환경변수가 설정되지 않았습니다"
            );
        }

        NaverLocalSearchResponse response = restClient.get()
            .uri(uriBuilder -> uriBuilder.queryParam("query", query).queryParam("display", 5).build())
            .header("X-Naver-Client-Id", clientId)
            .header("X-Naver-Client-Secret", clientSecret)
            .retrieve()
            .body(NaverLocalSearchResponse.class);

        if (response == null || response.items() == null) return List.of();

        return response.items().stream().map(this::toResult).toList();
    }

    private PlaceSearchResult toResult(NaverLocalSearchResponse.Item item) {
        String name = item.title().replaceAll("<[^>]*>", "");
        // Naver local search returns mapx/mapy as WGS84 lng/lat * 10,000,000
        double lng = Long.parseLong(item.mapx()) / 10_000_000.0;
        double lat = Long.parseLong(item.mapy()) / 10_000_000.0;
        return new PlaceSearchResult(name, item.category(), item.roadAddress(), item.address(), lat, lng);
    }
}
