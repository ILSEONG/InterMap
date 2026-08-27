package com.intermap.backend.localdata;

import com.intermap.backend.restaurant.Restaurant;
import com.intermap.backend.restaurant.RestaurantRepository;
import org.locationtech.proj4j.CRSFactory;
import org.locationtech.proj4j.CoordinateTransform;
import org.locationtech.proj4j.CoordinateTransformFactory;
import org.locationtech.proj4j.ProjCoordinate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.intermap.backend.localdata.StatusSyncService.normalize;

/**
 * 지자체 인허가 데이터(영업중 일반음식점 전량)를 받아 신규 가게를 등록하는 백필 서비스.
 * 이미 있는 가게는 관리번호(mgtNo)만 채워 이후 폐업 동기화의 정확 매칭을 돕는다.
 */
@Service
public class RestaurantImportService {

    private static final Logger log = LoggerFactory.getLogger(RestaurantImportService.class);

    // 인허가 좌표는 보정 중부원점 TM(EPSG:5174). 앱은 WGS84(lat/lng)를 쓴다.
    private static final CoordinateTransform TM_TO_WGS84;

    static {
        CRSFactory factory = new CRSFactory();
        TM_TO_WGS84 = new CoordinateTransformFactory().createTransform(
            factory.createFromParameters("EPSG:5174",
                "+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000"
                    + " +ellps=bessel +units=m +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43"),
            factory.createFromParameters("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs"));
    }

    public record Result(int fetched, int created, int matched, int skipped) {
    }

    private final LocalDataClient client;
    private final RestaurantRepository repository;

    public RestaurantImportService(LocalDataClient client, RestaurantRepository repository) {
        this.client = client;
        this.repository = repository;
    }

    public Result importOpenRestaurants(String localCode) {
        if (!client.isConfigured()) {
            throw new IllegalStateException("LOCALDATA_AUTH_KEY 환경변수가 설정되지 않았습니다");
        }

        List<LocalDataClient.Row> rows = client.fetchAllOpen(localCode);

        List<Restaurant> existing = repository.findAll();
        Set<String> knownMgtNos = new HashSet<>();
        Map<String, Restaurant> byNameAddr = new HashMap<>();
        for (Restaurant r : existing) {
            if (r.getLocalDataMgtNo() != null) knownMgtNos.add(r.getLocalDataMgtNo());
            byNameAddr.put(key(r.getName(), r.getRoadAddress()), r);
        }

        List<Restaurant> toSave = new ArrayList<>();
        int created = 0, matched = 0, skipped = 0;

        for (LocalDataClient.Row row : rows) {
            if (row.mgtNo() != null && knownMgtNos.contains(row.mgtNo())) {
                matched++;
                continue;
            }

            String roadAddr = blankToNull(row.rdnWhlAddr()) != null ? row.rdnWhlAddr() : row.lotnoAddr();
            Restaurant found = byNameAddr.get(key(row.bplcNm(), roadAddr));
            if (found != null) {
                // 기존 가게 — 관리번호 백필 (이후 동기화가 문자열 매칭 없이 정확 매칭됨)
                if (found.getLocalDataMgtNo() == null) {
                    found.markStatus(Restaurant.Status.OPEN, row.mgtNo());
                    toSave.add(found);
                }
                matched++;
                continue;
            }

            double[] latLng = toLatLng(row.crdX(), row.crdY());
            if (latLng == null) {
                skipped++;
                continue;
            }

            Restaurant restaurant = new Restaurant(
                row.bplcNm(),
                blankToNull(row.category()) != null ? row.category() : "음식점",
                row.rdnWhlAddr(),
                row.lotnoAddr(),
                latLng[0],
                latLng[1]
            );
            restaurant.markStatus(Restaurant.Status.OPEN, row.mgtNo());
            toSave.add(restaurant);
            byNameAddr.put(key(row.bplcNm(), roadAddr), restaurant);
            created++;
        }

        repository.saveAll(toSave);
        log.info("LOCALDATA {} 백필: 조회 {}건, 신규 {}건, 기존 {}건, 좌표없음 {}건",
            localCode, rows.size(), created, matched, skipped);
        return new Result(rows.size(), created, matched, skipped);
    }

    private static String key(String name, String roadAddr) {
        return normalize(name) + "|" + normalize(roadAddr);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    /** TM 좌표 문자열을 WGS84 [lat, lng]로. 비어있거나 한국 범위를 벗어나면 null */
    static double[] toLatLng(String x, String y) {
        if (x == null || y == null || x.isBlank() || y.isBlank()) return null;
        try {
            ProjCoordinate out = new ProjCoordinate();
            TM_TO_WGS84.transform(new ProjCoordinate(Double.parseDouble(x), Double.parseDouble(y)), out);
            double lat = out.y, lng = out.x;
            if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return null;
            return new double[] {lat, lng};
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
