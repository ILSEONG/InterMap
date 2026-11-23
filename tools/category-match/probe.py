"""공공데이터포털의 휴게음식점·제과점 인허가 API 명세(요청 주소·항목)를 본다. 인증키 없이 공개 문서만 읽는다."""
import json, re, urllib.request, urllib.error
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36'}
def fetch(url, n=60):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=n) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return 0, repr(e)
for pk in ['15154916', '15154921', '15155252']:
    code, html = fetch(f'https://www.data.go.kr/data/{pk}/openapi.do')
    print('==', pk, code, len(html))
    print('  주소:', sorted(set(re.findall(r'apis\.data\.go\.kr/[A-Za-z0-9_/\-]+', html)))[:10])
    for m in sorted(set(re.findall(r'(?:swaggerUrl|swaggerJson|oasUrl|apiDocs?Url|var\s+swagger\w*)\s*[=:]\s*[^\n;]{0,300}', html)))[:6]:
        print('  스웨거:', m[:400])
    i = html.find('swaggerJson')
    if i >= 0:
        j = html.find('`', i)
        k = html.find('`', j + 1)
        spec = html[j + 1:k] if 0 < j < k else ''
        print('  명세 길이', len(spec))
        try:
            d = json.loads(spec)
            print('  host', d.get('host'), 'basePath', d.get('basePath'), 'servers', d.get('servers'))
            for path, ops in d.get('paths', {}).items():
                for verb, op in ops.items():
                    print('  경로', verb, path, '|', op.get('summary'))
                    print('    요청:', [(p.get('name'), (p.get('description') or '')[:40]) for p in op.get('parameters', [])])
            defs = d.get('definitions') or d.get('components', {}).get('schemas', {})
            for name, sch in defs.items():
                props = sch.get('properties', {})
                if len(props) > 5:
                    print('  응답', name, [(k, (v.get('description') or '')[:24]) for k, v in props.items()])
        except Exception as e:
            print('  명세 해석 실패', repr(e), spec[:300])
# 인증키 없이 불러 보면 주소가 맞는지는 알 수 있다 (없는 서비스면 다른 오류)
for path in ['general_restaurants', 'rest_cafes', 'rest_restaurants', 'bakeries', 'no_such_service_zz']:
    code, body = fetch(f'https://apis.data.go.kr/1741000/{path}/info?pageNo=1&numOfRows=1&returnType=json', 30)
    print('호출', path, code, body[:160].replace('\n', ' '))
