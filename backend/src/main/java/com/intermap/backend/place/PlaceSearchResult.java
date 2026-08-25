package com.intermap.backend.place;

public record PlaceSearchResult(
    String name,
    String category,
    String roadAddress,
    String address,
    double lat,
    double lng
) {
}
