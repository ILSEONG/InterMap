"""서버에 싣는 "서울 음식 상가" 파일을 만든다 — 가게 업종(필터)을 채우는 데 쓴다 (CuisineBackfill).

소상공인시장진흥공단 상가(상권)정보(공공데이터포털 15083033, 이용허락범위 제한 없음, 분기 갱신)에서
서울 · 대분류 "음식" 행만 뽑아 상호·지점·소분류·도로명주소·지번주소 다섯 열로 줄인다.
결과: backend/src/main/resources/cuisine/seoul-food.csv.gz (+ 기준월과 행 수를 적은 seoul-food.version)

공공데이터포털은 깃허브 러너에서만 닿으므로 워크플로(sbiz-data.yml)가 돌리고 결과를 커밋한다.
"""
import collections, csv, gzip, http.cookiejar, io, json, os, re, sys, urllib.parse, urllib.request, zipfile

PAGE = 'https://www.data.go.kr/data/15083033/fileData.do'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
REGION = '서울'
OUT = 'backend/src/main/resources/cuisine'

opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
opener.addheaders = [('User-Agent', UA), ('Accept-Language', 'ko-KR,ko;q=0.9')]


def get(url, timeout=120):
    req = urllib.request.Request(url)
    req.add_header('Referer', PAGE)
    return opener.open(req, timeout=timeout)


def download(path):
    """안내 페이지에서 파일 번호를 찾아 전국 zip을 받는다"""
    html = get(PAGE).read().decode('utf-8', 'replace')
    uddi = re.search(r'uddi:[0-9a-fA-F-]{20,}(?:_\d+)?', html)
    if not uddi: sys.exit('안내 페이지에서 파일 번호(uddi)를 못 찾음 — 페이지 구조가 바뀌었는지 확인')
    q = urllib.parse.urlencode({'recommendDataYn': 'Y', 'publicDataPk': '15083033', 'publicDataDetailPk': uddi.group(0)})
    info = json.loads(get('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do?' + q).read())
    if not info.get('atchFileId'): sys.exit('내려받기 정보에 atchFileId가 없음: ' + json.dumps(info, ensure_ascii=False)[:400])
    q = urllib.parse.urlencode({'atchFileId': info['atchFileId'], 'fileDetailSn': info.get('fileDetailSn') or 1})
    res = get('https://www.data.go.kr/cmm/cmm/fileDownload.do?' + q, timeout=900)
    with open(path, 'wb') as f:
        while chunk := res.read(1 << 20): f.write(chunk)
    print('받은 파일:', os.path.getsize(path) // (1 << 20), 'MB')


def read_region(path):
    z = zipfile.ZipFile(path)
    for info in z.infolist():
        name = info.filename if info.flag_bits & 0x800 else info.filename.encode('cp437').decode('cp949', 'replace')
        if REGION not in name or not name.endswith('.csv'): continue
        raw = z.read(info)
        for enc in ('utf-8-sig', 'cp949'):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        month = re.search(r'_(\d{6})\.csv$', name)
        print('읽는 파일:', name, '·', enc)
        return list(csv.DictReader(io.StringIO(text))), (month.group(1) if month else 'unknown')
    sys.exit(REGION + ' 파일이 zip에 없음')


def main():
    zpath = os.path.join(os.environ.get('RUNNER_TEMP', '/tmp'), 'sangga.zip')
    if not os.path.exists(zpath): download(zpath)
    rows, month = read_region(zpath)
    col = lambda part: next(c for c in rows[0].keys() if part in c)
    name, branch, big, small, road, lot = col('상호명'), col('지점명'), col('대분류명'), col('소분류명'), col('도로명주소'), col('지번주소')
    food = sorted((r for r in rows if '음식' in r[big]), key=lambda r: (r[road], r[lot], r[name], r[branch], r[small]))
    if len(food) < 50_000: sys.exit(f'음식 행이 {len(food)}개뿐 — 파일이 이상하다')

    out = io.StringIO()
    w = csv.writer(out, lineterminator='\n')
    for r in food: w.writerow([r[name].strip(), r[branch].strip(), r[small].strip(), r[road].strip(), r[lot].strip()])
    os.makedirs(OUT, exist_ok=True)
    with open(f'{OUT}/seoul-food.csv.gz', 'wb') as f:
        # mtime=0 — 내용이 같으면 파일도 같게 (쓸데없는 커밋이 생기지 않게)
        with gzip.GzipFile(fileobj=f, mode='wb', compresslevel=9, mtime=0) as g: g.write(out.getvalue().encode('utf-8'))
    with open(f'{OUT}/seoul-food.version', 'w', encoding='utf-8') as f: f.write(f'{month} {len(food)}\n')
    print(f'{REGION} 음식 {len(food)}행 (기준 {month}) → {os.path.getsize(OUT + "/seoul-food.csv.gz") / 1e6:.1f}MB')

    # 규칙 파일이 모르는 소분류가 생겼으면 알려 준다 (분류 체계가 바뀌면 rules.json의 sbiz를 고쳐야 한다)
    rules = json.load(open(f'{OUT}/rules.json', encoding='utf-8'))
    counts = collections.Counter(r[small].strip() for r in food)
    for k, v in counts.most_common():
        print(f'  {k}: {v}' + ('' if k in rules['sbiz'] else '  ← 규칙에 없음(업종을 정하는 데 안 씀)'))
    with open(os.environ.get('GITHUB_OUTPUT', os.devnull), 'a') as f: f.write(f'month={month}\n')


main()
