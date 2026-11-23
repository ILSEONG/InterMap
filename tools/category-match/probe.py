"""운영 서버가 가게 업종을 채웠는지 본다 (읽기만)."""
import collections, json, urllib.request
API = 'https://intermap-be.onrender.com/api/restaurants'
def get(q):
    with urllib.request.urlopen(urllib.request.Request(API + q, headers={'User-Agent': 'intermap-probe'}), timeout=60) as r:
        return json.loads(r.read())
for name, q in [('여의도', '?minLat=37.52&maxLat=37.54&minLng=126.92&maxLng=126.94'), ('강남역', '?minLat=37.49&maxLat=37.51&minLng=127.02&maxLng=127.04')]:
    rows = get(q)
    c = collections.Counter(('cuisine' in r, r.get('cuisine')) for r in rows)
    has_field = sum(v for (f, _), v in c.items() if f)
    print(name, len(rows), '곳 · cuisine 칸 있음', has_field, '· 값 있음', sum(v for (f, cu), v in c.items() if cu))
    print('  ', collections.Counter(r.get('cuisine') for r in rows).most_common())
for z, cu in [(15, None), (15, 'JAPANESE'), (15, 'JAPANESE,CAFE')]:
    cells = get(f'/summary?minLat=37.50&maxLat=37.56&minLng=126.90&maxLng=126.96&zoom={z}' + (f'&cuisine={cu}' if cu else ''))
    print('요약', z, cu, '→ 셀', len(cells), '· 가게', sum(x['count'] for x in cells))
print('검색 "타마 여의도":', [(r['name'], r.get('cuisine'), r.get('address')) for r in get('?q=%ED%83%80%EB%A7%88%20%EC%97%AC%EC%9D%98%EB%8F%84')][:5])
