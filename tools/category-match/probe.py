"""운영 서버에 카페가 얼마나 들어 있는지 본다 (읽기만, 요청 몇 번)."""
import collections, json, time, urllib.request
API = 'https://intermap-be.onrender.com/api/restaurants'
def get(q):
    with urllib.request.urlopen(urllib.request.Request(API + q, headers={'User-Agent': 'intermap-probe'}), timeout=60) as r:
        return json.loads(r.read())
SEOUL = 'minLat=37.41&maxLat=37.72&minLng=126.76&maxLng=127.19'
total = sum(c['count'] for c in get(f'/summary?{SEOUL}&zoom=9'))
print('서울 전체 가게', total)
for cu in ['CAFE', 'KOREAN', 'BAR', 'JAPANESE']:
    time.sleep(1)
    n = sum(c['count'] for c in get(f'/summary?{SEOUL}&zoom=9&cuisine={cu}'))
    print(cu, n, f'({n * 100 / total:.1f}%)')
for name, q in [('연남·홍대', 'minLat=37.553&maxLat=37.567&minLng=126.917&maxLng=126.930'), ('성수', 'minLat=37.538&maxLat=37.550&minLng=127.040&maxLng=127.060'), ('강남역', 'minLat=37.494&maxLat=37.504&minLng=127.022&maxLng=127.032')]:
    time.sleep(1)
    rows = get('?' + q)
    cafes = [r for r in rows if r.get('cuisine') == 'CAFE']
    print(name, '가게', len(rows), '· 카페', len(cafes), '· 인허가 업태:', collections.Counter(r.get('category') for r in cafes).most_common(6))
    print('   예:', [r['name'] for r in cafes[:25]])
    for brand in ['스타벅스', '투썸', '메가', '이디야', '컴포즈', '파리바게', '뚜레쥬르']:
        print('   ', brand, sum(1 for r in rows if brand in r['name']), end='')
    print()
