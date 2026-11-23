# 카페 화면의 토끼 그림(src/assets/rabbit-*.png)을 만든다 — 거북이 그림과 같은 문법으로:
# 낮은 해상도 격자에 덩어리를 찍고 진갈색 테두리를 한 칸 두른 뒤, 얼굴·볼터치·반짝이·그림자는 곱게 얹는다.
# 격자 한 칸 = 그림 4px (거북이 그림의 한 칸 ≈ 3.5px와 비슷하게). 화면에는 한 칸이 1.89px이 되게 그린다 (TurtlePet.tsx의 ART).
#
#   python3 scripts/rabbit-art.py src/assets      (Pillow가 있어야 한다. 앱을 빌드할 때는 돌지 않는다)
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

OUT = (57, 47, 40, 255); BODY = (254, 248, 235, 255); INK = (36, 28, 24, 255)
EAR = (249, 190, 172, 255); BLUSH = (251, 196, 178); SPARK = (250, 184, 106, 255); HEART = (246, 160, 140, 255)
K = 4          # 내보낼 때 격자 한 칸의 px
S = 4          # 부드러운 요소를 그릴 때의 추가 배율 (그 뒤 줄여서 가장자리를 다듬는다)

class Canvas:
    def __init__(s, w, h): s.w = w; s.h = h; s.px = {}; s.soft = []
    def set(s, x, y, c):
        if 0 <= x < s.w and 0 <= y < s.h: s.px[(x, y)] = c
    def part(s, mask, fill=BODY, outline=OUT):
        # 테두리(바깥으로 한 칸) 먼저, 그다음 채움 — 뒤에 그린 덩어리가 앞 덩어리 위에 선을 남긴다
        for (x, y) in mask:
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if (x + dx, y + dy) not in mask: s.set(x + dx, y + dy, outline)
        for (x, y) in mask: s.set(x, y, fill)
    def dots(s, pts, c):
        for x, y in pts: s.set(x, y, c)

def ellipse(cx, cy, rx, ry):
    m = set()
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0: m.add((x, y))
    return m
def rect(x0, y0, x1, y1): return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}

def render(c, shadow=None, blush=(), sparks=(), heart=None, eyes=(), smiles=(), mouth=None):
    W, H = c.w * K * S, c.h * K * S
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    u = K * S
    if shadow:   # 발밑 그림자 — 어두운 지도 위에서도 뜨지 않게 검정을 옅게
        cx, cy, rx, ry = shadow
        sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse([(cx - rx) * u, (cy - ry) * u, (cx + rx) * u, (cy + ry) * u], fill=(20, 12, 6, 84))
        im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(u * 0.7)))
    px = Image.new('RGBA', (c.w, c.h), (0, 0, 0, 0))
    for (x, y), col in c.px.items(): px.putpixel((x, y), col)
    im = Image.alpha_composite(im, px.resize((W, H), Image.NEAREST))
    soft = Image.new('RGBA', (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(soft)
    for cx, cy, rx, ry in blush:
        sd.ellipse([(cx - rx) * u, (cy - ry) * u, (cx + rx) * u, (cy + ry) * u], fill=BLUSH + (240,))
    im = Image.alpha_composite(im, soft.filter(ImageFilter.GaussianBlur(u * 0.2)))
    d = ImageDraw.Draw(im)
    # 얼굴은 격자보다 곱게 그린다 (거북이 그림도 눈·입은 테두리보다 가늘다)
    for cx, cy in eyes:      # 뜬 눈 — 모서리가 둥근 점
        d.rounded_rectangle([(cx - 0.85) * u, (cy - 0.95) * u, (cx + 0.85) * u, (cy + 0.95) * u], radius=u * 0.45, fill=INK)
    for cx, cy in smiles:    # 웃는 눈 — 위로 굽은 호
        d.arc([(cx - 1.7) * u, (cy - 0.9) * u, (cx + 1.7) * u, (cy + 1.9) * u], start=200, end=340, fill=INK, width=int(u * 0.8))
        for ang in (200, 340):
            ex = cx * u + 1.7 * u * math.cos(math.radians(ang)); ey = (cy + 0.5) * u + 1.4 * u * math.sin(math.radians(ang))
            r = u * 0.36; d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=INK)
    if mouth:                # 입 — 아래로 불룩한 작은 반달
        cx, cy = mouth
        d.pieslice([(cx - 1.2) * u, (cy - 1.35) * u, (cx + 1.2) * u, (cy + 1.1) * u], start=0, end=180, fill=INK)
    for x0, y0, x1, y1 in sparks:   # 반짝이 — 끝이 둥근 짧은 선
        w = int(u * 1.15)
        d.line([x0 * u, y0 * u, x1 * u, y1 * u], fill=SPARK, width=w)
        for x, y in ((x0, y0), (x1, y1)): d.ellipse([x * u - w / 2, y * u - w / 2, x * u + w / 2, y * u + w / 2], fill=SPARK)
    if heart:
        hx, hy = heart
        rows = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"]
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch == '1': d.rectangle([(hx + i) * u, (hy + j) * u, (hx + i + 1) * u - 1, (hy + j + 1) * u - 1], fill=HEART)
    return im.resize((c.w * K, c.h * K), Image.LANCZOS)

def ear(c, x, top, base, lean=0):
    # 귀 하나: 너비 4칸, 끝이 둥글다. lean만큼 위쪽이 왼쪽으로 기운다. 안쪽은 분홍 두 칸
    mid = top + (base - top) // 2
    m = rect(x - lean, top + 1, x + 3 - lean, mid) | rect(x + 1 - lean, top, x + 2 - lean, top) | rect(x, mid, x + 3, base)
    c.part(m)
    c.dots([(x + 1 - lean, y) for y in range(top + 2, mid + 1)] + [(x + 2 - lean, y) for y in range(top + 2, mid + 1)], EAR)
    c.dots([(x + 1, y) for y in range(mid + 1, base - 1)] + [(x + 2, y) for y in range(mid + 1, base - 1)], EAR)

def ear_folded(c, x, top, base):
    # 앞으로 접힌 귀: 기둥 위에서 오른쪽으로 꺾여 끝이 아래로 떨어진다
    m = rect(x, top + 3, x + 3, base) | rect(x + 1, top + 2, x + 6, top + 4) | rect(x + 5, top + 4, x + 7, top + 7) | rect(x + 6, top + 8, x + 6, top + 8)
    c.part(m)
    c.dots([(x + 1, y) for y in range(top + 5, base - 1)] + [(x + 2, y) for y in range(top + 5, base - 1)], EAR)

HEAD = (17.5, 20.0, 9.0, 7.5)

def standing(pose='wave', sparks=()):
    c = Canvas(38, 38)
    hx, hy, rx, ry = HEAD
    # 꼬리 → 팔 → 귀 → 머리와 몸(한 덩어리) 순서. 머리와 몸 사이에는 선을 두지 않는다 (거북이처럼)
    c.part(ellipse(10.2, 30.6, 2.1, 2.1))
    if pose == 'wave':   # 흔드는 팔 — 몸 뒤에서 오른쪽 위로
        c.part(rect(22, 28, 24, 30) | rect(24, 26, 26, 28) | rect(26, 24, 28, 26) | rect(27, 22, 29, 24))
    ear(c, 11, 2, 15, lean=1)
    if pose == 'wave': ear(c, 19, 1, 15)
    else: ear_folded(c, 19, 0, 15)
    body = rect(12, 26, 22, 32) | rect(11, 29, 23, 32) | rect(11, 33, 15, 34) | rect(19, 33, 23, 34)
    c.part(ellipse(hx, hy, rx, ry) | body)
    fy = hy - 0.2
    kw = dict(mouth=(hx + 0.4, fy + 2.3), blush=[(hx - 5.4, fy + 2.7, 1.7, 1.05), (hx + 6.2, fy + 2.7, 1.7, 1.05)])
    if pose == 'wave': kw['eyes'] = [(hx - 3.2, fy), (hx + 4.0, fy)]
    else: kw['smiles'] = [(hx - 3.2, fy), (hx + 4.0, fy)]
    return render(c, shadow=(17, 35.2, 9.5, 1.4), sparks=sparks, **kw)

def resting():
    c = Canvas(44, 30)
    hx, hy, rx, ry = 28.5, 17.6, 9.0, 7.5
    c.part(ellipse(5.0, 20.6, 2.1, 2.1))
    body = {p for p in ellipse(15.5, 20.5, 10.0, 6.4) if p[1] <= 25}
    c.part(body)
    # 귀 — 뒤 귀는 비스듬히 뒤로 젖히고, 앞 귀는 등에 길게 눕힌다
    back = rect(21, 8, 25, 11) | rect(17, 6, 22, 9) | rect(14, 4, 18, 7) | rect(13, 4, 13, 5)
    c.part(back)
    c.dots([(15, 5), (16, 5), (17, 6), (18, 7), (19, 7), (20, 8), (21, 8), (16, 6), (19, 8), (22, 9), (21, 9)], EAR)
    c.part(rect(10, 11, 23, 14) | rect(9, 12, 9, 13))
    c.dots([(x, y) for x in range(11, 21) for y in (12, 13)], EAR)
    c.part(ellipse(hx, hy, rx, ry))
    # 앞발 — 턱 밑에 모은다
    c.part(rect(23, 24, 27, 25)); c.part(rect(30, 24, 34, 25))
    fy = hy + 0.3
    return render(c, shadow=(19, 26.4, 17, 1.4), heart=(37, 1), smiles=[(hx - 3.2, fy), (hx + 4.0, fy)], mouth=(hx + 0.4, fy + 2.3),
                  blush=[(hx - 5.4, fy + 2.7, 1.7, 1.05), (hx + 6.2, fy + 2.7, 1.7, 1.05)])

def avatar(size=168, fill=0.8):
    # 기본 프로필용 — 얼굴만 크게: 웃는 얼굴에 한쪽 귀를 접었다. 반짝이·그림자는 없다 (거북이 프로필 그림처럼).
    # 거북이 프로필 그림(168px 정사각, 가운데)과 같은 판에 얹고, 동그라미에 잘리지 않게 여백을 둔다
    c = Canvas(38, 30)
    hx, hy, rx, ry = HEAD
    ear(c, 11, 2, 15, lean=1)
    ear_folded(c, 19, 0, 15)
    c.part(ellipse(hx, hy, rx, ry - 0.1))   # 몸이 없으니 턱 끝에 한 칸 튀어나오지 않게 살짝 납작하게
    fy = hy - 0.2
    fig = render(c, smiles=[(hx - 3.2, fy), (hx + 4.0, fy)], mouth=(hx + 0.4, fy + 2.3),
                 blush=[(hx - 5.4, fy + 2.7, 1.7, 1.05), (hx + 6.2, fy + 2.7, 1.7, 1.05)])
    fig = trim(fig, pad=0)
    k = size * fill / max(fig.width, fig.height)
    fig = fig.resize((round(fig.width * k), round(fig.height * k)), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    # 귀 때문에 위로 길다 — 얼굴이 동그라미 가운데쯤 오게 조금 올려 둔다
    out.paste(fig, ((size - fig.width) // 2 - round(k * K * 0.5), (size - fig.height) // 2 - round(size * 0.02)), fig)
    return out

def trim(im, pad=2):
    # 빈 가장자리를 잘라 낸다 — 화면에서 거북이와 같은 자리에 서도록
    x0, y0, x1, y1 = im.getbbox()
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    items = {
        'rabbit-wave': standing('wave', sparks=[(32.2, 11.4, 33.0, 13.8), (34.2, 16.0, 36.0, 17.4), (34.0, 20.6, 36.4, 20.9)]),
        'rabbit-happy': standing('happy', sparks=[(30.4, 12.4, 31.4, 14.6), (32.4, 17.0, 34.4, 18.2), (32.2, 21.4, 34.6, 21.7)]),
        'rabbit-rest': resting(),
    }
    avatar().save(f'{out}/rabbit-avatar.png', optimize=True)
    for name, im in items.items():
        im = trim(im); im.save(f'{out}/{name}.png', optimize=True)
        # 화면에 그릴 크기: 격자 한 칸이 거북이와 같은 1.89px이 되게 (그림은 한 칸 4px)
        print(name, im.size, '→ 화면', round(im.width * 1.89 / K), 'x', round(im.height * 1.89 / K))
