# 홍보영상·스토어 스크린샷용 화면을 찍는다.
# 진짜 앱 화면(웹 빌드)을 띄우고, 서버 응답만 지어낸 예시 데이터로 갈아 끼운다 — 운영 서버·운영 DB에는 아무것도 보내지 않는다.
#   BASE      앱 주소 (기본: 로컬 미리보기)
#   API       앱이 부르는 서버 주소 — 이 주소로 가는 요청을 모두 가로챈다
#   FAKE_MAP  1이면 지도를 가짜로 (로컬에서 흐름만 볼 때). 없으면 진짜 네이버 지도
#   OUT       결과 폴더.  ONLY=stills|video 로 한쪽만
import base64, json, os, re, subprocess, sys, time, datetime, urllib.parse
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:4173')
API = os.environ.get('API', 'http://localhost:8080')
FAKE = os.environ.get('FAKE_MAP') == '1'
OUT = os.environ.get('OUT', 'out')
DIST = os.environ.get('DIST', '')   # 있으면 BASE 주소의 화면을 이 폴더의 빌드로 대신 내준다 (최신 코드를 진짜 지도와 함께 찍기 위해)
ONLY = os.environ.get('ONLY', '')
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)

now = lambda: datetime.datetime.now(datetime.timezone.utc)
iso = lambda **ago: (now() - datetime.timedelta(**ago)).isoformat().replace('+00:00', 'Z')
C_LAT, C_LNG = 37.5605, 126.92

# ---- 지어낸 예시 데이터 (실제 가게·사람이 아니다) ----
ME = {'id': 4, 'token': 'demo', 'email': 'demo@example.com', 'nickname': '지우', 'avatar': None, 'admin': False}
def person(i, name, follows_me=True): return {'id': i, 'nickname': name, 'alias': None, 'following': True, 'followsMe': follows_me, 'avatar': None}
HANEUL, DOYUN, SEOA, MINJAE = person(7, '하늘'), person(8, '도윤'), person(9, '서아', False), person(10, '민재')

ZOOM = int(os.environ.get('ZOOM', '17' if FAKE else '16'))   # 진짜 지도는 한 단계가 더 깊다 (512px 조각)
def place(i, name, category, cuisine, x, y, kind=None):
    """x, y: 기본 화면(가운데 기준, CSS px)에서 핀이 놓일 자리 — 좌표로 바꿔 둔다"""
    return {'id': i, 'name': name, 'category': category, 'roadAddress': f'서울특별시 마포구 예시로 {i * 3}', 'address': f'서울특별시 마포구 예시동 {i}',
            'lat': C_LAT - y / 117200, 'lng': C_LNG + x / 93100, 'cuisine': cuisine, 'cafeKind': kind}
PLACES = [
    place(1, '온기식당', '한식', 'KOREAN', -100, -95), place(2, '스시 담', '일식', 'JAPANESE', 55, -15),
    place(3, '라멘 고요', '일식', 'JAPANESE', -15, 110), place(4, '화로 한 점', '고기', 'MEAT', 125, 85),
    place(5, '파스타 온', '양식', 'WESTERN', 110, -150), place(6, '마라 한 그릇', '중식', 'CHINESE', -55, 200),
    place(7, '골목 분식', '분식', 'SNACK', -135, 45), place(8, '바다 한 접시', '회·해산물', 'SEAFOOD', 140, 210),
    place(9, '든든국밥', '한식', 'SOUP', 40, 285), place(10, '타코 수요일', '아시안', 'ASIAN', -140, 170),
    place(21, '느린 오후', '커피숍', 'CAFE', 35, -45, 'COFFEE'), place(22, '달 아래 커피', '커피숍', 'CAFE', -115, 50, 'COFFEE'),
    place(23, '소금빵 연구소', '제과점', 'CAFE', 125, 110, 'BAKERY'), place(24, '겨울 디저트', '디저트', 'CAFE', -95, -130, 'DESSERT'),
    place(25, '창가 자리', '커피숍', 'CAFE', -40, 205, 'COFFEE'), place(26, '오늘의 원두', '커피숍', 'CAFE', 120, -140, 'COFFEE'),
    place(27, '모퉁이 베이커리', '제과점', 'CAFE', 45, 280, 'BAKERY'), place(28, '밤 산책', '커피숍', 'CAFE', -130, -20, 'COFFEE'),
]
BY = {p['name']: p for p in PLACES}

def review(rid, name, who, rating, text, tags=None, hours=30, menu=None):
    p = BY[name]
    return {'id': rid, 'restaurant': {'name': p['name'], 'category': p['category'], 'address': p['roadAddress'], 'lat': p['lat'], 'lng': p['lng'], 'cuisine': p['cuisine'], 'cafeKind': p['cafeKind']},
            'author': {'id': who['id'], 'name': who['nickname'], 'owner': False, 'avatar': None}, 'rating': rating, 'text': text, 'menu': menu,
            'tags': tags or [], 'createdAt': iso(hours=hours), 'photoIds': [], 'photoUrls': [], 'photoRatios': []}

def new_state():
    return {'reviews': [
        review(501, '스시 담', HANEUL, 4.8, '초밥이 두툼하고 밥이 따뜻해요. 점심 특선이 알차요.', ['SMALL'], 3, '점심 특선'),
        review(502, '스시 담', DOYUN, 4.5, '조용해서 둘이 가기 좋았어요. 예약하고 가세요.', ['SMALL'], 52, '모둠 초밥'),
        review(503, '스시 담', ME, 4.6, '계란말이가 정말 맛있어요.', ['SOLO'], 120),
        review(504, '온기식당', SEOA, 4.4, '집밥이 생각날 때 가는 곳. 반찬이 매일 바뀌어요.', ['SOLO'], 20, '오늘의 백반'),
        review(505, '화로 한 점', MINJAE, 4.7, '회식 장소로 딱이에요. 여섯 명 자리도 넉넉해요.', ['LARGE'], 70, '모둠 구이'),
        review(506, '파스타 온', HANEUL, 4.2, '크림 파스타가 꾸덕해요. 창가 자리 추천.', ['SMALL'], 96),
        review(507, '마라 한 그릇', DOYUN, 4.0, '맵기를 고를 수 있어서 좋아요.', ['SOLO'], 140),
        review(508, '골목 분식', ME, 4.3, '떡볶이는 여기가 제일이에요.', ['SMALL'], 200),
        review(509, '든든국밥', MINJAE, 4.5, '해장은 여기서. 아침 일찍 열어요.', ['SOLO'], 30),
        review(521, '느린 오후', SEOA, 4.7, '콘센트 자리가 많아서 작업하기 좋아요.', ['WORK', 'SOLO'], 6),
        review(522, '느린 오후', HANEUL, 4.5, '라테가 고소해요. 오후엔 자리가 금방 차요.', ['TASTE'], 60),
        review(523, '소금빵 연구소', DOYUN, 4.6, '갓 나온 소금빵은 꼭 드세요.', ['SWEETS', 'SMALL'], 28),
        review(524, '달 아래 커피', ME, 4.4, '늦게까지 열어서 밤에 가기 좋아요.', ['MOOD'], 80),
        review(525, '겨울 디저트', MINJAE, 4.3, '여럿이 수다 떨기 좋은 넓은 자리.', ['TALK', 'LARGE'], 100),
        review(526, '창가 자리', HANEUL, 4.5, '창밖을 보면서 쉬기 좋아요.', ['MOOD', 'SOLO'], 110),
        review(527, '오늘의 원두', DOYUN, 4.8, '원두를 고를 수 있어요. 드립 커피 추천.', ['TASTE'], 130),
        review(528, '모퉁이 베이커리', MINJAE, 4.2, '크루아상이 바삭해요.', ['SWEETS'], 150),
    ], 'comments': [
        {'id': 1, 'reviewId': 501, 'parentId': None, 'author': {'id': 8, 'name': '도윤', 'owner': False, 'avatar': None}, 'text': '이번 주말에 같이 가요!', 'createdAt': iso(hours=2)},
    ], 'posts': [], 'votes': {1: ['하늘', '도윤'], 2: ['서아'], 3: []}, 'mine': []}

POLL_OPTS = [(1, '스시 담', '일식', 4.6, 3), (2, '화로 한 점', '고기', 4.7, 1), (3, '파스타 온', '양식', 4.2, 1)]
def poll_view(state):
    opts = [{'id': i, 'name': n, 'category': c, 'address': BY[n]['roadAddress'], 'note': None, 'votes': len(state['votes'][i]), 'voters': state['votes'][i], 'rating': r, 'reviewCount': k}
            for i, n, c, r, k in POLL_OPTS]
    people = {v for vs in state['votes'].values() for v in vs}
    return {'token': 'demo-poll', 'title': '금요일 저녁 어디 갈래?', 'creator': {'id': 4, 'name': '지우'}, 'createdAt': iso(hours=5), 'closesAt': iso(hours=-19), 'closed': False,
            'mine': True, 'options': opts, 'myChoices': state['mine'], 'myName': '지우', 'voterCount': len(people), 'winnerIds': []}
def recap():
    month = (now() + datetime.timedelta(hours=9)).strftime('%Y-%m')
    lst = [{'name': '스시 담', 'category': '일식', 'rating': 4.6}, {'name': '골목 분식', 'category': '분식', 'rating': 4.3}, {'name': '온기식당', 'category': '한식', 'rating': 4.4},
           {'name': '라멘 고요', 'category': '일식', 'rating': 4.5}, {'name': '파스타 온', 'category': '양식', 'rating': 4.0}, {'name': '든든국밥', 'category': '한식', 'rating': 4.2},
           {'name': '화로 한 점', 'category': '고기', 'rating': 4.7}, {'name': '바다 한 접시', 'category': '회·해산물', 'rating': 4.1}, {'name': '타코 수요일', 'category': '아시안', 'rating': 4.0}]
    return {'month': month, 'places': 9, 'photos': 14, 'avgRating': 4.3, 'topCategory': {'name': '일식', 'count': 3}, 'topArea': {'name': '연남동', 'count': 5},
            'best': lst[6], 'commentsReceived': 12, 'topFan': {'id': 7, 'name': '하늘', 'count': 5}, 'newFollowing': 2, 'list': sorted(lst, key=lambda x: -x['rating']),
            'months': [month], 'fans': [{'id': 7, 'name': '하늘', 'count': 5}, {'id': 8, 'name': '도윤', 'count': 4}, {'id': 10, 'name': '민재', 'count': 3}], 'fanTotal': 4,
            'categories': [{'name': '일식', 'count': 3}, {'name': '한식', 'count': 3}, {'name': '양식', 'count': 1}], 'areas': [{'name': '연남동', 'count': 5}, {'name': '서교동', 'count': 3}], 'scope': 'food'}

def body_of(route):
    try: return json.loads(route.request.post_data or 'null')
    except Exception:
        m = re.search(rb'name="review"[^\r\n]*\r\n(?:[^\r\n]+\r\n)*\r\n(\{.*?\})\r\n--', route.request.post_data_buffer or b'', re.S)
        return json.loads(m.group(1).decode()) if m else None

def make_handler(state):
    def ok(route, body, status=200): route.fulfill(status=status, content_type='application/json', headers={'access-control-allow-origin': '*'}, body=json.dumps(body, ensure_ascii=False))
    def handle(route):
        req = route.request; url = urllib.parse.urlparse(req.url); path = url.path; q = urllib.parse.parse_qs(url.query); m = req.method
        if m == 'OPTIONS': return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
        split = lambda k: q[k][0].split(',') if q.get(k) else []
        if path == '/api/auth/me': return ok(route, ME)
        if path == '/api/restaurants/summary':
            rows = [p for p in PLACES if (not split('cuisine') or p['cuisine'] in split('cuisine')) and p['cuisine'] not in split('exceptCuisine') and (not split('cafeKind') or p['cafeKind'] in split('cafeKind'))]
            return ok(route, [{'lat': p['lat'], 'lng': p['lng'], 'count': 1} for p in rows])
        if path == '/api/restaurants':
            if q.get('q'): return ok(route, [p for p in PLACES if q['q'][0] in p['name']])
            box = {k: float(q[k][0]) for k in ('minLat', 'maxLat', 'minLng', 'maxLng') if k in q}
            return ok(route, [p for p in PLACES if not box or (box['minLat'] <= p['lat'] <= box['maxLat'] and box['minLng'] <= p['lng'] <= box['maxLng'])])
        if path == '/api/reviews' and m == 'GET': return ok(route, state['reviews'])
        if path == '/api/reviews' and m == 'POST':
            d = body_of(route); p = BY.get(d['restaurant']['name'])
            made = {'id': 700 + len(state['posts']), 'restaurant': {**d['restaurant'], 'lat': p['lat'], 'lng': p['lng'], 'cuisine': p['cuisine'], 'cafeKind': p['cafeKind']},
                    'author': {'id': 4, 'name': '지우', 'owner': False, 'avatar': None}, 'rating': d['rating'], 'text': d['text'], 'menu': d.get('menu'), 'tags': d.get('tags') or [],
                    'createdAt': iso(), 'photoIds': [], 'photoUrls': [], 'photoRatios': []}
            state['posts'].append(d); state['reviews'].insert(0, made); return ok(route, made)
        if path == '/api/comments' and m == 'GET': return ok(route, state['comments'])
        if path == '/api/me/social': return ok(route, {'following': [HANEUL, DOYUN, SEOA, MINJAE], 'followers': [HANEUL, DOYUN, MINJAE], 'requests': [], 'requested': [], 'manualApproval': False})
        if path == '/api/me/notifications': return ok(route, {'items': [], 'unread': 0})
        if path == '/api/me/polls': return ok(route, [{'token': 'demo-poll', 'title': '금요일 저녁 어디 갈래?', 'createdAt': iso(hours=5), 'closesAt': iso(hours=-19), 'closed': False, 'mine': True,
                                                       'voterCount': 3, 'leader': '스시 담', 'cafe': False}])
        if path == '/api/me/recap': return ok(route, recap())
        if path.startswith('/api/polls/'):
            if m == 'POST' and path.endswith('/votes'):
                d = body_of(route) or {}
                for i in state['votes']: state['votes'][i] = [v for v in state['votes'][i] if v != '지우']
                for i in d.get('optionIds', []): state['votes'][i].append('지우')
                state['mine'] = d.get('optionIds', [])
            return ok(route, poll_view(state))
        if re.match(r'/api/users/\d+$', path): return ok(route, {**HANEUL, 'followingCount': 12, 'followerCount': 9, 'blocked': False, 'reviewCount': 8, 'cafeReviewCount': 3})
        return ok(route, [] if m == 'GET' else {})
    return handle

WRAP = ";(function(){function w(){try{var M=naver.maps.Map;if(!M||M.__w)return !!M;var W=function(a,b){var m=new M(a,b);window.__map=m;return m};W.prototype=M.prototype;for(var k in M){try{W[k]=M[k]}catch(e){}}W.__w=1;naver.maps.Map=W;return true}catch(e){return false}}if(!w()){var t=setInterval(function(){if(w())clearInterval(t)},1)}})();"
TOUCH = """
window.__touch = (x, y) => { const d = document.createElement('div');
  d.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(20,20,22,.22);border:2px solid rgba(255,255,255,.75);z-index:99999;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out;transform:scale(.55);opacity:1`;
  document.body.appendChild(d); requestAnimationFrame(() => { d.style.transform = 'scale(1.25)'; d.style.opacity = '0' }); setTimeout(() => d.remove(), 600) }
"""

def open_app(p, scale, vclock=False):
    br = p.chromium.launch(args=['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'])
    ctx = br.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, device_scale_factor=scale, locale='ko-KR', timezone_id='Asia/Seoul',
                         service_workers='block', user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
    ctx.add_init_script("localStorage.setItem('intermap.session', JSON.stringify(%s));" % json.dumps(ME) + TOUCH)
    if vclock: ctx.add_init_script(open(os.path.join(HERE, 'vclock.js'), encoding='utf-8').read())
    pg = ctx.new_page(); state = new_state(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)[:200]))
    def other(route):
        host = urllib.parse.urlparse(route.request.url).hostname or ''
        if host.endswith(('naver.com', 'pstatic.net', 'naver.net')) or route.request.url.startswith(BASE): return route.continue_()
        route.abort()   # 그 밖의 주소로는 아무것도 내보내지 않는다
    pg.route('**/*', other)
    if DIST:
        def site(route):
            f = os.path.join(DIST, urllib.parse.urlparse(route.request.url).path.lstrip('/'))
            route.fulfill(path=f if os.path.isfile(f) else os.path.join(DIST, 'index.html'))
        pg.route(BASE + '/**', site)
    pg.route(API + '/**', make_handler(state))
    if FAKE:
        pg.route('**/oapi.map.naver.com/**', lambda r: r.fulfill(status=200, content_type='application/javascript', body=open(os.path.join(HERE, 'fake_naver.js')).read()))
    else:
        def maps(route):
            resp = route.fetch()
            route.fulfill(response=resp, body=resp.text() + WRAP)
        pg.route(re.compile(r'https://oapi\.map\.naver\.com/openapi/v3/maps\.js.*'), maps)
    pg.goto(BASE + '/')
    pg.wait_for_function('() => !!window.__map', timeout=40000); pg.wait_for_timeout(2500 if FAKE else 6000)
    return br, pg, state, errors

class App:
    def __init__(self, pg): self.pg = pg; self.cdp = pg.context.new_cdp_session(pg); self.rec = None
    def wait(self, ms):
        if self.rec and self.rec.on: self.rec.frames(round(ms * 30 / 1000))
        else: self.pg.wait_for_timeout(ms)
    def swipe(self, x0, y0, x1, y1, ms=420, hold=0, after=300):
        """손가락으로 쓸기 (실제 터치 이벤트). 끝에서 잠깐 멈췄다 떼면 관성이 붙지 않는다"""
        steps = max(4, round(ms * 30 / 1000)); pt = lambda x, y: {'touchPoints': [{'x': round(x), 'y': round(y)}]}
        self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', **pt(x0, y0)})
        for i in range(1, steps + 1):
            self.wait(ms / steps); k = i / steps; k = k * k * (3 - 2 * k)   # 천천히 시작해 천천히 멈춘다
            self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', **pt(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k)})
        if hold: self.wait(hold)
        self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); self.wait(after)
    def tap(self, loc, after=600):
        loc = loc.first; loc.scroll_into_view_if_needed(); b = loc.bounding_box()
        x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
        self.pg.evaluate('([x, y]) => window.__touch(x, y)', [x, y]); self.wait(133); loc.click(); self.wait(after)
    def type(self, text):
        for i, ch in enumerate(text): self.pg.keyboard.insert_text(ch); self.wait(67 if i % 2 else 33)
    def pin(self, name): return self.pg.locator(f'button.map-pin[aria-label^="{name}"]')
    def view(self, lat, lng, zoom, wait=1600):
        self.pg.evaluate("([lat, lng, z]) => window.__map.morph(new naver.maps.LatLng(lat, lng), z)", [lat, lng, zoom]); self.wait(wait)
    def mode(self, label): self.tap(self.pg.locator('.topbar__mode', has_text=label), 1200)
    def sheet(self): return self.pg.locator('.restaurant-sheet-overlay--open')
    def close_sheet(self): self.tap(self.sheet().get_by_role('button', name='닫기'), 700)
    def close_pet(self):
        if self.pg.locator('.pet__close').count(): self.pg.locator('.pet__close').first.click(); self.wait(400)
    def open_filter(self): self.tap(self.pg.locator('.topbar__chip--filter'), 700)
    def chip(self, title, label):
        return self.pg.locator('.filter-sheet__section', has=self.pg.locator('.filter-sheet__label', has_text=title)).locator('.filter-sheet__chip, .filter-sheet__segment, .filter-sheet__tile', has_text=label)

class Rec:
    """화면 속 시계를 1/30초씩 넘기며 한 장씩 찍는다 (vclock.js) — 그리는 데 얼마가 걸리든 매 프레임이 온전히 남는다"""
    def __init__(self, pg): self.pg = pg; self.cdp = pg.context.new_cdp_session(pg); self.on = False
    def start(self, name):
        self.name = name; self.n = 0; self.t = time.time(); self.dir = os.path.join(OUT, 'frames_' + name); os.makedirs(self.dir, exist_ok=True)
        self.pg.evaluate('window.__vt.manual(true)'); self.on = True
    def frames(self, n):
        for _ in range(max(1, n)):
            self.pg.evaluate('window.__vt.step(1000 / 30)')
            data = self.cdp.send('Page.captureScreenshot', {'format': 'jpeg', 'quality': 93, 'optimizeForSpeed': True})['data']
            open(os.path.join(self.dir, f'{self.n:05d}.jpg'), 'wb').write(base64.b64decode(data)); self.n += 1
    def stop(self):
        self.on = False; self.pg.evaluate('window.__vt.manual(false)')
        print(f'{self.name}: {self.n} frames = {self.n / 30:.2f}s (찍는 데 {time.time() - self.t:.0f}s)'); sys.stdout.flush()
        out = os.path.join(OUT, self.name + '.mp4')
        r = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', os.path.join(self.dir, '%05d.jpg'), '-vf', 'scale=780:1688:flags=lanczos,format=yuv420p',
                            '-c:v', 'libx264', '-crf', '14', '-preset', 'veryfast', '-movflags', '+faststart', out + '.part.mp4'])
        if r.returncode == 0: os.replace(out + '.part.mp4', out)
        subprocess.run(['rm', '-rf', self.dir])

def ready(a, warm=False):
    a.close_pet()
    if warm:   # 영상에서 처음 보이는 화면이 비어 있지 않도록, 쓸 지도 조각을 미리 한 번씩 받아 둔다
        a.view(C_LAT, C_LNG, ZOOM - 1, 2500)
        a.pg.locator('.topbar__mode', has_text='카페').click(); a.wait(3000); a.close_pet(); a.view(C_LAT, C_LNG, ZOOM - 1, 2000); a.view(C_LAT, C_LNG, ZOOM, 2000)
        a.pg.locator('.topbar__mode', has_text='맛집').click(); a.wait(1500); a.close_pet()
    a.view(C_LAT, C_LNG, ZOOM, 2200)

def stills(p):
    br, pg, state, errors = open_app(p, 3); a = App(pg); shot = lambda n: (pg.wait_for_timeout(500), pg.screenshot(path=os.path.join(OUT, n + '.png')))
    ready(a); shot('s1_map')
    a.pin('스시 담').first.click(); a.wait(1500); shot('s2_sheet'); a.sheet().get_by_role('button', name='닫기').first.click(); a.wait(700); a.view(C_LAT, C_LNG, ZOOM, 1500)
    pg.locator('.topbar__chip--filter').click(); a.wait(700); a.chip('업종', '일식').click(); a.chip('규모', '2~5인').click(); a.wait(300); shot('s3_filter')
    pg.locator('.filter-sheet__reset').click(); pg.locator('.filter-sheet__apply').click(); a.wait(800)
    pg.locator('.topbar__mode', has_text='카페').click(); a.wait(1500); a.close_pet(); a.view(C_LAT, C_LNG, ZOOM, 1800); shot('s4_cafe')
    a.pin('느린 오후').first.click(); a.wait(1500); shot('s4b_cafe_sheet'); a.sheet().get_by_role('button', name='닫기').first.click(); a.wait(700)
    pg.locator('.topbar__mode', has_text='맛집').click(); a.wait(1200)
    pg.locator('.topbar__me').click(); a.wait(900); pg.get_by_role('tab', name=re.compile('어디 갈래')).click(); a.wait(500)
    pg.locator('.my-page__poll').first.click(); a.wait(1500); shot('s5_poll')
    pg.locator('.poll-sheet').get_by_role('button', name='닫기').first.click(); a.wait(700)
    pg.get_by_role('tab', name=re.compile('이 달의 결산')).click(); a.wait(500); pg.locator('.my-page__row--recap').click(); a.wait(2600); shot('s6_recap')
    # 후기 쓰기 화면 (등록은 하지 않는다)
    pg.locator('.recap-sheet').get_by_role('button', name='닫기').first.click(); a.wait(800); pg.locator('.my-page__close').first.click(); a.wait(900)
    a.view(C_LAT, C_LNG, ZOOM, 1500); a.pin('온기식당').first.click(); a.wait(1300); a.sheet().get_by_role('button', name='후기 쓰기').first.click(); a.wait(900)
    a.sheet().locator('.review-form__text').click(); pg.keyboard.type('반찬이 정갈하고 밥이 맛있어요'); a.wait(200)
    a.sheet().locator('.review-form__tags[aria-labelledby$="-party"] .review-form__tag', has_text='혼밥').first.click(); a.wait(300)
    pg.evaluate("document.activeElement && document.activeElement.blur()"); a.wait(400); shot('s7_review')
    print('stills errors', errors); br.close()

def video(p):
    br, pg, state, errors = open_app(p, 2, vclock=True); a = App(pg); rec = Rec(pg); a.rec = rec
    ready(a, warm=True); home = lambda: a.view(C_LAT, C_LNG, ZOOM, 1500)
    def scene(name, run):
        try:
            rec.start(name); run(); rec.stop()
        except Exception as e:
            print('SCENE FAILED', name, str(e)[:300]); sys.stdout.flush(); rec.on = False; pg.screenshot(path=os.path.join(OUT, 'fail_' + name + '.png'))
            try: pg.evaluate('window.__vt.manual(false)')
            except Exception: pass
    # 장면 길이는 compose.py의 SCENES와 맞춘다 (끝에 여유 프레임을 조금 더 찍는다)
    # 1. 지도 — 이웃이 다녀온 곳 (조금 비켜난 자리에서 시작해 지도를 밀어 본다) · 3.2초
    a.view(C_LAT - 14 / 117200, C_LNG - 26 / 93100, ZOOM, 1800)
    def s1(): a.wait(800); (a.wait(800) if FAKE else a.swipe(250, 560, 198, 532, 700, hold=170, after=100)); a.wait(1700)
    scene('v1_map', s1)
    home()
    # 2. 가게 시트 — 별점과 후기 (손잡이를 올려 펼친다) · 4.3초
    def s2():
        a.wait(500); a.tap(a.pin('스시 담'), 1150); g = a.sheet().locator('.restaurant-sheet__grab').first.bounding_box()
        a.swipe(195, g['y'] + g['height'] / 2, 195, g['y'] - 330, 400, after=100); a.wait(2300)
    scene('v2_sheet', s2)
    a.close_sheet(); home()
    # 3. 필터 — 업종·규모 · 3.7초
    def s3(): a.wait(400); a.tap(pg.locator('.topbar__chip--filter'), 700); a.tap(a.chip('업종', '일식'), 400); a.tap(a.chip('규모', '2~5인'), 470); a.tap(pg.locator('.filter-sheet__apply'), 1500)
    scene('v3_filter', s3)
    a.open_filter(); pg.locator('.filter-sheet__reset').click(); pg.locator('.filter-sheet__apply').click(); a.wait(900); home()
    # 4. 후기 쓰기 — 이웃 후기는 있고 내 후기는 아직 없는 가게 · 4.4초
    a.pin('온기식당').first.click(); a.wait(1300)
    def s4():
        a.wait(400); a.tap(a.sheet().get_by_role('button', name='후기 쓰기'), 730)
        a.sheet().locator('.review-form__text').click(); a.wait(100); a.type('반찬이 정갈하고 밥이 맛있어요'); a.wait(200)
        a.tap(a.sheet().locator('.review-form__tags[aria-labelledby$="-party"] .review-form__tag', has_text='혼밥'), 400)
        a.tap(a.sheet().locator('.review-form__submit'), 1600)
    scene('v4_review', s4)
    a.close_sheet(); home()
    # 5. 카페 — 밤의 지도 · 3.9초
    def s5(): a.wait(400); a.tap(pg.locator('.topbar__mode', has_text='카페'), 1400); a.tap(a.pin('느린 오후'), 2000)
    scene('v5_cafe', s5)
    a.close_sheet(); a.mode('맛집')
    # 6. 어디 갈래? — 투표 · 3.9초
    pg.locator('.topbar__me').click(); a.wait(900); pg.get_by_role('tab', name=re.compile('어디 갈래')).click(); a.wait(500)
    def s6(): a.wait(330); a.tap(pg.locator('.my-page__poll'), 1000); a.tap(pg.locator('.poll-option__pick').nth(0), 530); a.tap(pg.locator('.poll-sheet .modal-sheet__btn--primary'), 1800)
    scene('v6_poll', s6)
    pg.locator('.poll-sheet').get_by_role('button', name='닫기').first.click(); a.wait(700)
    # 7. 월간 결산 카드 · 4.3초
    pg.get_by_role('tab', name=re.compile('이 달의 결산')).click(); a.wait(500)
    def s7(): a.wait(330); a.tap(pg.locator('.my-page__row--recap'), 1500); a.tap(pg.locator('.recap-flip:not(.recap-flip--loading)'), 2500)
    scene('v7_recap', s7)
    print('video errors', errors); br.close()

with sync_playwright() as p:
    if ONLY != 'video': stills(p)
    if ONLY != 'stills': video(p)
