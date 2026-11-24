"""카페 받아 오기가 얼마나 진행됐는지 본다 — 운영 서버의 공개 요약 API만 읽는다 (쓰지 않는다, 천천히). 다시 확인 (완료 여부)."""
import json, time, urllib.request, urllib.parse
BASE = 'https://intermap-be.onrender.com/api/restaurants/summary'
SEOUL = dict(minLat=37.41, maxLat=37.72, minLng=126.76, maxLng=127.19, zoom=9)
def total(**extra):
    q = urllib.parse.urlencode({**SEOUL, **extra})
    try:
        with urllib.request.urlopen(urllib.request.Request(f'{BASE}?{q}', headers={'User-Agent': 'intermap-probe'}), timeout=90) as r:
            return sum(c['count'] for c in json.loads(r.read().decode()))
    except Exception as e:
        return f'실패: {type(e).__name__} {getattr(e, "code", "")}'
for i in range(1):
    row = {
        '전체': total(),
        '카페': total(cuisine='CAFE'),
        '카페만 뺀 것(새 서버만 앎)': total(exceptCuisine='CAFE'),
        '종류 COFFEE': total(cafeKind='COFFEE'),
        '종류 BAKERY': total(cafeKind='BAKERY'),
        '종류 DESSERT': total(cafeKind='DESSERT'),
    }
    print(time.strftime('%H:%M:%S', time.gmtime()), 'UTC', json.dumps(row, ensure_ascii=False), flush=True)
    pass
# 확인 05:52
