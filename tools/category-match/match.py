"""소상공인시장진흥공단 상가(상권)정보의 업종을 인터맵 가게에 덧입힐 수 있는지 재 본다 (실험용 — 운영 코드 아님).

- 상가(상권)정보 파일(공공데이터포털 15083033)에서 서울 파일을 읽는다.
- 인터맵 운영 서버의 공개 목록 API에서 서울 몇 동네의 가게를 읽는다 (읽기만, 천천히).
- 주소(도로명 건물번호 / 지번)와 상호로 짝을 지어 보고, 몇 %가 맞는지와 업종이 어떻게 나뉘는지 찍는다.
"""
import collections, csv, difflib, http.cookiejar, io, json, math, os, random, re, sys, time, urllib.parse, urllib.request, zipfile

PAGE = 'https://www.data.go.kr/data/15083033/fileData.do'
API = 'https://intermap-be.onrender.com/api/restaurants'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
# 동네 중심 (0.02도 격자 2x2칸씩) — 업무지구·번화가·주거지를 섞었다
AREAS = {'여의도': (37.52, 126.92), '강남역': (37.50, 127.02), '홍대': (37.54, 126.92), '종로': (37.56, 126.98),
         '노원': (37.64, 127.06), '신림': (37.48, 126.92), '잠실': (37.50, 127.08), '화곡': (37.54, 126.84)}

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
opener.addheaders = [('User-Agent', UA), ('Accept-Language', 'ko-KR,ko;q=0.9')]


def get(url, referer=None, timeout=120):
    req = urllib.request.Request(url)
    if referer: req.add_header('Referer', referer)
    return opener.open(req, timeout=timeout)


def download_zip(path):
    html = get(PAGE).read().decode('utf-8', 'replace')
    print('안내 페이지', len(html), '자')
    for m in list(re.finditer(r'[^\n]{0,100}(?:fileDataDown|atchFileId|selectFileDataDownload|uddi:)[^\n]{0,160}', html))[:12]:
        print('  단서:', m.group(0).strip()[:260])
    uddi = re.search(r'uddi:[0-9a-fA-F-]{20,}(?:_\d+)?', html)
    atch = re.search(r'atchFileId[\'"=:\s]+(FILE_\d+)', html)
    info = {}
    if uddi:
        q = urllib.parse.urlencode({'recommendDataYn': 'Y', 'publicDataPk': '15083033', 'publicDataDetailPk': uddi.group(0)})
        try:
            raw = get('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?' + q, referer=PAGE).read().decode('utf-8', 'replace')
            print('  내려받기 정보:', raw[:600])
            info = json.loads(raw)
        except Exception as e:
            print('  내려받기 정보 실패:', repr(e))
    file_id = info.get('atchFileId') or (atch and atch.group(1))
    if not file_id: sys.exit('파일 id를 못 찾음')
    q = urllib.parse.urlencode({'atchFileId': file_id, 'fileDetailSn': info.get('fileDetailSn') or 1})
    res = get('https://www.data.go.kr/cmm/cmm/fileDownload.do?' + q, referer=PAGE, timeout=600)
    print('  응답:', res.status, res.headers.get('Content-Type'), res.headers.get('Content-Length'), res.headers.get('Content-Disposition'))
    with open(path, 'wb') as f:
        while True:
            chunk = res.read(1 << 20)
            if not chunk: break
            f.write(chunk)
    print('  받은 크기:', os.path.getsize(path) // (1 << 20), 'MB')


def zip_name(info):
    return info.filename if info.flag_bits & 0x800 else info.filename.encode('cp437').decode('cp949', 'replace')


def read_seoul(path):
    with open(path, 'rb') as f: head = f.read(4)
    if head[:2] != b'PK':
        print('zip이 아님. 앞부분:', open(path, 'rb').read(300)); sys.exit(1)
    z = zipfile.ZipFile(path)
    names = [(zip_name(i), i) for i in z.infolist()]
    print('파일 목록:', [(n, i.file_size // (1 << 20)) for n, i in names])
    seoul = [i for n, i in names if '서울' in n]
    if not seoul: sys.exit('서울 파일 없음')
    raw = z.read(seoul[0])
    for enc in ('utf-8-sig', 'cp949'):
        try:
            text = raw.decode(enc); break
        except UnicodeDecodeError:
            continue
    rows = list(csv.DictReader(io.StringIO(text)))
    print('서울 상가 행:', len(rows), '· 열:', list(rows[0].keys()))
    return rows


def fetch_ours():
    ours = {}
    for area, (lat, lng) in AREAS.items():
        n0 = len(ours)
        for dy in (0, 1):
            for dx in (0, 1):
                a, b = round(lat + dy * 0.02, 2), round(lng + dx * 0.02, 2)
                q = urllib.parse.urlencode({'minLat': a, 'maxLat': round(a + 0.02, 2), 'minLng': b, 'maxLng': round(b + 0.02, 2)})
                for r in json.loads(get(API + '?' + q).read()):
                    r['area'] = area
                    ours[r['id']] = r
                time.sleep(0.7)
        print('  인터맵', area, len(ours) - n0, '곳')
    return list(ours.values())


def norm(s):
    s = re.sub(r'\(.*?\)', '', (s or '').lower())
    return re.sub(r'[^0-9a-z가-힣]', '', s)


def keys(addr):
    """주소 → (도로명 건물 키, 지번 키). 못 읽으면 None"""
    toks = [t.strip(',') for t in (addr or '').split()]
    road = lot = None
    for i, t in enumerate(toks[:-1]):
        nxt = toks[i + 1]
        if not re.fullmatch(r'(산)?\d+(-\d+)?(번지)?', nxt): continue
        num = nxt.replace('번지', '')
        gu = next((x for x in toks[:i] if x.endswith(('구', '군'))), '')
        if road is None and re.search(r'(로|길)$', t): road = f'{gu}|{t}|{num}'
        elif lot is None and re.search(r'(동|가|리)$', t): lot = f'{gu}|{t}|{num}'
    return road, lot


def meters(a, b):
    return math.hypot((a[0] - b[0]) * 111_000, (a[1] - b[1]) * 88_000)


def main():
    zpath = os.path.join(os.environ.get('RUNNER_TEMP', '/tmp'), 'sangga.zip')
    if not os.path.exists(zpath): download_zip(zpath)
    rows = read_seoul(zpath)
    ours = fetch_ours()
    print('인터맵 표본:', len(ours), '곳')

    col = lambda *names: next(c for c in rows[0].keys() if any(n in c for n in names))
    C_NAME, C_BRANCH = col('상호명'), col('지점명')
    C_BIG, C_MID, C_SMALL = col('대분류명'), col('중분류명'), col('소분류명')
    C_ROAD, C_LOT, C_LNG, C_LAT = col('도로명주소'), col('지번주소'), col('경도'), col('위도')

    food = [r for r in rows if '음식' in r[C_BIG]]
    print(f'\n== 서울 상가 대분류 ==')
    for k, v in collections.Counter(r[C_BIG] for r in rows).most_common(): print(f'  {k}: {v}')
    print(f'\n== 서울 "음식" 중분류 > 소분류 ({len(food)}곳) ==')
    tree = collections.defaultdict(collections.Counter)
    for r in food: tree[r[C_MID]][r[C_SMALL]] += 1
    for mid, smalls in sorted(tree.items(), key=lambda kv: -sum(kv[1].values())):
        print(f'  {mid} {sum(smalls.values())}: ' + ', '.join(f'{k} {v}' for k, v in smalls.most_common()))

    by_road, by_lot, grid = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(list)
    for r in rows:
        r['_n'] = norm(r[C_NAME]); r['_nb'] = norm(r[C_NAME] + r[C_BRANCH])
        road, _ = keys(r[C_ROAD]); _, lot = keys(r[C_LOT])
        if road: by_road[road].append(r)
        if lot: by_lot[lot].append(r)
        try:
            r['_p'] = (float(r[C_LAT]), float(r[C_LNG]))
            grid[(round(r['_p'][0], 3), round(r['_p'][1], 3))].append(r)
        except ValueError:
            r['_p'] = None

    def judge(o):
        n = norm(o['name'])
        road, _ = keys(o.get('roadAddress')); _, lot = keys(o.get('address'))
        cands = {id(c): c for c in by_road.get(road, []) + by_lot.get(lot, [])}.values() if (road or lot) else []
        best = ('주소 안 맞음' if not cands else '주소만 맞음', None, 0.0)
        rank = {'같은 이름': 3, '이름 포함': 2, '이름 비슷': 1}
        for c in cands:
            if n and n in (c['_n'], c['_nb']): got = ('같은 이름', c, 1.0)
            elif len(n) >= 2 and len(c['_n']) >= 2 and (n in c['_nb'] or c['_n'] in n): got = ('이름 포함', c, 0.9)
            else:
                ratio = max(difflib.SequenceMatcher(None, n, c['_n']).ratio(), difflib.SequenceMatcher(None, n, c['_nb']).ratio())
                got = ('이름 비슷', c, ratio) if ratio >= 0.6 else None
            if got and (rank[got[0]], got[2]) > (rank.get(best[0], 0), best[2]): best = got
        if best[1] is None and n:
            p = (o['lat'], o['lng']); cell = (round(p[0], 3), round(p[1], 3))
            for dy in (-0.001, 0, 0.001):
                for dx in (-0.001, 0, 0.001):
                    for c in grid.get((round(cell[0] + dy, 3), round(cell[1] + dx, 3)), []):
                        if n in (c['_n'], c['_nb']) and meters(p, c['_p']) <= 150:
                            return ('가까운 곳에 같은 이름', c, 1.0), len(cands)
        return best, len(cands)

    random.seed(7)
    results = [(o, *judge(o)) for o in ours]
    kinds = ['같은 이름', '이름 포함', '이름 비슷', '가까운 곳에 같은 이름', '주소만 맞음', '주소 안 맞음']
    total = len(results)
    cnt = collections.Counter(r[1][0] for r in results)
    print(f'\n== 짝짓기 결과 (인터맵 {total}곳) ==')
    acc = 0
    for k in kinds:
        acc += cnt[k]
        print(f'  {k}: {cnt[k]} ({cnt[k] / total:.1%})' + (f'  ← 여기까지 누적 {acc / total:.1%}' if k in kinds[:4] else ''))
    sure = [r for r in results if r[1][0] in kinds[:2]]

    # ---- 업종 규칙 검증 ----
    rules = json.load(open('backend/src/main/resources/cuisine/rules.json', encoding='utf-8'))

    def by_name(name):
        n = re.sub(r'\s+', '', (name or '').lower())
        for group in rules['names']:
            for w in group['words']:
                if w in n: return group['cuisine'], w
        return None, None

    def decide(name, small, lic):
        c, w = by_name(name)
        if c: return c, '이름'
        sb, li = rules['sbiz'].get(small or ''), rules['license'].get(lic or '')
        if sb and not sb.get('vague'): return sb['cuisine'], '상가(뚜렷)'
        if li and not li.get('vague'): return li['cuisine'], '인허가(뚜렷)'
        if sb: return sb['cuisine'], '상가(뭉뚱)'
        if li: return li['cuisine'], '인허가(뭉뚱)'
        return None, '없음'

    print('\n== 이름 낱말 규칙이 상가의 뚜렷한 소분류와 맞는 정도 (확실한 짝만) ==')
    per_word = collections.defaultdict(lambda: [0, 0, collections.Counter()])
    agree = total_w = 0
    for o, (k, c, _), _n in sure:
        sb = rules['sbiz'].get(c[C_SMALL])
        if not sb or sb.get('vague'): continue
        cu, w = by_name(o['name'])
        if not cu: continue
        total_w += 1
        ok = cu == sb['cuisine']
        agree += ok
        st = per_word[(cu, w)]; st[0] += 1; st[1] += ok
        if not ok: st[2][sb['cuisine']] += 1
    print(f'  전체: {agree}/{total_w} = {agree / max(total_w, 1):.1%}')
    for (cu, w), (n, ok, miss) in sorted(per_word.items(), key=lambda kv: kv[1][1] / kv[1][0]):
        if n >= 8 and ok / n < 0.8: print(f'  {cu} "{w}": {ok}/{n} = {ok / n:.0%} · 어긋난 쪽 {miss.most_common(4)}')
    print('  -- 낱말 묶음별 --')
    per_group = collections.defaultdict(lambda: [0, 0])
    for (cu, w), (n, ok, miss) in per_word.items(): per_group[cu][0] += n; per_group[cu][1] += ok
    for cu, (n, ok) in per_group.items(): print(f'  {cu}: {ok}/{n} = {ok / n:.0%}')

    print('\n== 인허가 업종이 상가의 뚜렷한 소분류와 맞는 정도 ==')
    per_lic = collections.defaultdict(lambda: [0, 0])
    for o, (k, c, _), _n in sure:
        sb, li = rules['sbiz'].get(c[C_SMALL]), rules['license'].get(o.get('category') or '')
        if not sb or sb.get('vague') or not li: continue
        per_lic[o['category']][0] += 1; per_lic[o['category']][1] += li['cuisine'] == sb['cuisine']
    for lic, (n, ok) in sorted(per_lic.items(), key=lambda kv: -kv[1][0]): print(f'  {lic}: {ok}/{n} = {ok / n:.0%}')

    print('\n== 최종 업종 (표본 전체) ==')
    final = [(o, *decide(o['name'], c[C_SMALL] if k in kinds[:2] else None, o.get('category'))) for o, (k, c, _), _n in results]
    src = collections.Counter(f[2] for f in final)
    print('  정한 근거:', ', '.join(f'{k} {v} ({v / total:.1%})' for k, v in src.most_common()))
    cu = collections.Counter(f[1] or '(없음)' for f in final)
    print('  업종 분포:', ', '.join(f'{k} {v} ({v / total:.1%})' for k, v in cu.most_common()))
    etc = [f for f in final if (f[0].get('category') or '') in ('기타', '')]
    print(f'  인허가 "기타" {len(etc)}곳 중 업종이 정해진 곳: {sum(1 for f in etc if f[1]) / max(len(etc), 1):.1%}')
    print('\n== 업종별 무작위 12곳 ==')
    for code in rules['cuisines'] + [None]:
        rs = [f for f in final if f[1] == code]
        print(f'  [{code}] ' + ' / '.join(f"{f[0]['name']}({f[2][:2]})" for f in random.sample(rs, min(12, len(rs)))))

    # ---- 서버에 실을 서울 음식 상가 파일 크기 ----
    import gzip
    out = io.StringIO(); w = csv.writer(out, lineterminator='\n')
    for r in sorted(food, key=lambda r: (r[C_ROAD], r[C_NAME])): w.writerow([r[C_NAME], r[C_BRANCH], r[C_SMALL], r[C_ROAD], r[C_LOT]])
    raw = out.getvalue().encode('utf-8')
    print(f'\n== 서울 음식 상가 파일: {len(food)}행 · {len(raw) / 1e6:.1f}MB · gzip {len(gzip.compress(raw, 9)) / 1e6:.1f}MB ==')
    print('  예:', out.getvalue().splitlines()[1000:1003])


main()
