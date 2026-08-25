package com.intermap.backend.place;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public record NaverLocalSearchResponse(List<Item> items) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Item(
        String title,
        String category,
        String address,
        String roadAddress,
        String mapx,
        String mapy
    ) {
    }
}
