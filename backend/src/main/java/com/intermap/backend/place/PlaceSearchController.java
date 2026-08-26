package com.intermap.backend.place;

import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
// https://localhost, capacitor://localhost 는 모바일 앱(Capacitor WebView)의 origin
@CrossOrigin(origins = {"http://localhost:5173", "http://localhost:5174", "https://localhost", "capacitor://localhost"})
public class PlaceSearchController {

    private final PlaceSearchService placeSearchService;

    public PlaceSearchController(PlaceSearchService placeSearchService) {
        this.placeSearchService = placeSearchService;
    }

    @GetMapping("/api/places/search")
    public List<PlaceSearchResult> search(@RequestParam String query) {
        return placeSearchService.search(query);
    }
}
