"""세 인허가 API(일반음식점·휴게음식점·제과점)의 명세가 같은 모양인지 본다. 인증키 없이 공개 문서만 읽는다."""
import json, re, urllib.request
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36'}
def spec(pk):
    with urllib.request.urlopen(urllib.request.Request(f'https://www.data.go.kr/data/{pk}/openapi.do', headers=UA), timeout=60) as r:
        html = r.read().decode('utf-8', 'replace')
    i = html.find('swaggerJson'); j = html.find('`', i); k = html.find('`', j + 1)
    return json.loads(html[j + 1:k])
def names(o, out):
    if isinstance(o, dict):
        if 'name' in o and 'in' in o: out['req'].add(o['name'])
        for k, v in o.items():
            if k == 'properties' and isinstance(v, dict):
                for p, d in v.items(): out['res'][p] = (d.get('description') or '')[:30] if isinstance(d, dict) else ''
            names(v, out)
    elif isinstance(o, list):
        for v in o: names(v, out)
base = None
for pk, label in [('15154916', '일반음식점'), ('15154921', '휴게음식점'), ('15155252', '제과점영업')]:
    d = spec(pk); out = {'req': set(), 'res': {}}; names(d, out)
    print('==', label, d.get('host'), list(d.get('paths', {}).keys()))
    if base is None:
        base = out
        print('  요청 변수:', sorted(out['req']))
        print('  응답 항목:', out['res'])
    else:
        print('  요청 변수 차이:', sorted(out['req'] ^ base['req']))
        print('  응답 항목 차이:', sorted(set(out['res']) ^ set(base['res'])))
        need = ['MNG_NO', 'BPLC_NM', 'ROAD_NM_ADDR', 'LOTNO_ADDR', 'BZSTAT_SE_NM', 'CRD_INFO_X', 'CRD_INFO_Y', 'SALS_STTS_CD', 'CLSBIZ_YMD']
        print('  우리가 쓰는 항목이 다 있나:', {n: n in out['res'] for n in need})
        print('  조건 변수:', [r for r in sorted(out['req']) if 'OPN_ATMY_GRP_CD' in r or 'DAT_UPDT_PNT' in r or 'SALS_STTS_CD' in r])
