# 카페 화면의 토끼 그림(src/assets/rabbit-*.png)을 거북이 원본 그림(src/assets/turtle-*.png)에서 만든다.
# 얼굴·테두리·자세·질감은 거북이 그림 그대로 두고:
#   1. 등딱지를 없앤다 — 색을 몸과 같은 크림색으로 바꾸고, 무늬와 몸 사이의 선을 지워 한 덩어리 몸통으로 만든다
#   2. 같은 격자로 귀 둘과 솜꼬리를 그려 뒤에 붙인다
#   3. 원본을 오려 낼 때 남은 흰 가장자리와 옅은 그림자를 지우고, 어두운 지도 위에서도 뜨지 않는 그림자를 새로 깐다
# 그래서 토끼는 거북이와 같은 그림체의 다른 캐릭터다. 거북이 그림을 바꾸면 이 스크립트를 다시 돌린다.
#
#   python3 scripts/rabbit-art.py        (numpy·scipy·Pillow가 있어야 한다. 앱을 빌드할 때는 돌지 않는다)
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi

T = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'assets')
OUT = (57, 47, 40); CREAM = (254, 248, 235); SHELL = (254, 197, 150); PINK = (249, 190, 170)
SS = 4   # 새로 그리는 부분은 4배로 그렸다가 줄여 원본처럼 가장자리를 부드럽게 한다

def recolor_shell(a):
    # 등딱지(가장 큰 주황 덩어리)와 그 테두리 쪽 번진 픽셀을 크림색으로 — 어두운 테두리는 그대로 둔다
    R, G, B, A = [a[..., i].astype(float) for i in range(4)]
    orange = (A > 200) & (R > 225) & (G > 140) & (G < 222) & (B < 190) & (R - B > 55)
    lab, k = ndi.label(orange)
    sizes = ndi.sum(orange, lab, range(1, k + 1))
    shell = lab == (int(np.argmax(sizes)) + 1)
    region = ndi.binary_dilation(shell, iterations=5)
    # 주황기가 도는 픽셀만 (크림색 몸·얼굴은 건드리지 않는다): 파랑이 초록보다 눈에 띄게 낮다
    tinted = region & (A > 0) & (G - B > 16)
    # 어두운 테두리 ↔ 주황 사이 어디쯤인지(빨강 채널로 잰다)를 그대로 테두리 ↔ 크림 사이로 옮긴다 — 색이 틀어지지 않는다
    out = a.astype(float).copy()
    tt = np.clip((R - OUT[0]) / (SHELL[0] - OUT[0]), 0, 1)
    for c, (dark, crm) in enumerate(zip(OUT, CREAM)):
        ch = out[..., c]; ch[tinted] = (dark + tt * (crm - dark))[tinted]
    # 등딱지의 무늬(진한 줄)는 남기지 않는다 — 몸과 똑같은 크림색으로 (테두리와 섞인 가장자리는 그대로)
    inner = tinted & (R >= 232)
    for c, crm in enumerate(CREAM):
        ch = out[..., c]; ch[inner] = crm
    return out.clip(0, 255).astype(np.uint8), shell, inner

def merge_back(a, shell, cell, head, keep_below=None, tone=None):
    # 등딱지였던 자리와 몸 사이의 선을 지워 한 덩어리 몸통으로 만든다 — 등에 따로 얹힌 조각으로 보이지 않게.
    # 지우는 선: 등딱지 자리에 붙은 어두운 선 가운데, 양쪽이 다 몸 색이고(바깥 윤곽이 아니고), 머리 둘레가 아닌 것.
    # keep_below: 이 y(px)보다 아래의 선은 둔다 (다리 위의 배 선)
    R, G, B, A = [a[..., i].astype(float) for i in range(4)]
    lum = 0.3 * R + 0.59 * G + 0.11 * B
    dark = (A > 128) & (lum < 150)
    r = max(2, int(round(cell * 1.45)))
    near_shell = ndi.binary_dilation(shell, iterations=r)
    clear = A < 60
    near_clear = ndi.binary_dilation(clear, iterations=r)
    H, W = A.shape
    yy, xx = np.mgrid[0:H, 0:W]
    hx, hy, rx, ry = head
    d = ((xx - hx) / rx) ** 2 + ((yy - hy) / ry) ** 2
    on_head = d < (1 + 1.3 * cell / min(rx, ry)) ** 2
    line = dark & near_shell & ~near_clear & ~on_head
    if keep_below is not None: line &= yy < keep_below
    # 선과, 선 옆에 붙어 있던 밝은 띠(원본은 테두리 안쪽이 살짝 밝다)까지 몸 색으로 덮는다 — 다른 선은 건드리지 않는다
    cover = line | (ndi.binary_dilation(line, iterations=3) & ~dark & (A > 128))
    if tone is not None:   # 조금 더 떨어진 곳에 남는 밝은 실선도 같이 덮는다
        cover |= ndi.binary_dilation(line, iterations=7) & (A > 128) & (lum > 0.3 * tone[0] + 0.59 * tone[1] + 0.11 * tone[2] + 4.5)
    out = a.copy()
    for c, crm in enumerate(CREAM): out[..., c][cover] = crm
    return out, cover

def body_tone(a, head):
    # 거북이 몸(얼굴 안쪽)의 크림색 — 평균과 얼룩의 세기. 새로 칠하는 곳을 이 색과 결로 맞춘다
    R, G, B, A = [a[..., i].astype(float) for i in range(4)]
    H, W = A.shape; yy, xx = np.mgrid[0:H, 0:W]
    hx, hy, rx, ry = head
    m = (((xx - hx) / rx) ** 2 + ((yy - hy) / ry) ** 2 < 0.62) & (A == 255) & (0.3 * R + 0.59 * G + 0.11 * B > 228) & (R - B < 34)
    px = a[m][:, :3].astype(float)
    return px.mean(axis=0), px.std(axis=0)

def fill_like_body(a, flat, std, seed=7):
    # 새로 칠할 자리(flat)를 둘레의 몸 색에서 이어 받아 채운다 — 가까운 몸 색을 끌어와 부드럽게 잇고, 옅은 결을 얹는다.
    # 평균색 하나로 칠하면 원본의 은은한 색 변화와 어긋나 얼룩처럼 보인다
    R, G, B, A = [a[..., i].astype(float) for i in range(4)]
    lum = 0.3 * R + 0.59 * G + 0.11 * B
    known = (A == 255) & (lum > 228) & (R - B < 34) & (G - B < 24) & ~flat
    idx = ndi.distance_transform_edt(~known, return_distances=False, return_indices=True)
    near = a[..., :3].astype(float)[idx[0], idx[1]]
    smooth = np.stack([ndi.gaussian_filter(near[..., c], 6) for c in range(3)], axis=2)
    rng = np.random.default_rng(seed)
    n = ndi.gaussian_filter(rng.standard_normal(flat.shape), 2.4); n /= max(1e-6, n.std())
    out = np.clip(smooth + n[..., None] * std[None, None, :] * 0.3, 0, 255)
    return out

def cells_layer(size, p, phase, parts):
    # parts: [(셀 집합, 채움색, 테두리 여부)] — 앞의 것부터 그리고, 덩어리마다 바깥으로 한 칸 테두리를 두른다
    W, H = size
    im = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    px, py = p if isinstance(p, tuple) else (p, p)
    def box(i, j): return [round((phase[0] + i * px) * SS), round((phase[1] + j * py) * SS), round((phase[0] + (i + 1) * px) * SS) - 1, round((phase[1] + (j + 1) * py) * SS) - 1]
    for cells, fill, outline in parts:
        if outline:
            for (i, j) in cells:
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if (i + di, j + dj) not in cells: d.rectangle(box(i + di, j + dj), fill=OUT + (255,))
        for (i, j) in cells: d.rectangle(box(i, j), fill=fill + (255,))
    return im.resize((W, H), Image.LANCZOS)

def capsule(p, phase, a, b, hw):
    # 선분 a→b에서 hw칸 안에 중심이 드는 셀들 (좌표는 px)
    px, py = p if isinstance(p, tuple) else (p, p)
    ax, ay = a; bx, by = b; out = set()
    i0 = int((min(ax, bx) - phase[0]) / px - hw - 2); i1 = int((max(ax, bx) - phase[0]) / px + hw + 2)
    j0 = int((min(ay, by) - phase[1]) / py - hw - 2); j1 = int((max(ay, by) - phase[1]) / py + hw + 2)
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            cx = phase[0] + (i + 0.5) * px; cy = phase[1] + (j + 0.5) * py
            t = ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / max(1e-6, (bx - ax) ** 2 + (by - ay) ** 2)
            t = min(1, max(0, t)); qx = ax + t * (bx - ax); qy = ay + t * (by - ay)
            if ((cx - qx) / px) ** 2 + ((cy - qy) / py) ** 2 <= hw * hw: out.add((i, j))
    return out

def disc(p, phase, c, r):
    return capsule(p, phase, c, c, r)

def blunt(cells):
    # 끝에 한 칸만 삐죽 나온 셀은 떼어 낸다 (귀 끝이 뾰족해지지 않게)
    out = set(cells)
    for _ in range(2):
        lone = {c for c in out if sum(((c[0] + di, c[1] + dj) in out) for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1))) <= 1}
        if not lone: break
        out -= lone
    return out

def defringe(a):
    # 원본을 오려 낼 때 남은 바깥쪽 흰 가장자리·자투리와 옅은 갈색 그림자를 지운다 — 어두운 지도 위에서 뜨기 때문에.
    # 바깥(투명)에서 어두운 테두리를 넘지 않고 닿는 픽셀만 본다. 반짝이·하트(색이 진하다)는 둔다
    R, G, B, A = [a[..., i].astype(float) for i in range(4)]
    lum = 0.3 * R + 0.59 * G + 0.11 * B
    barrier = (A > 128) & (lum < 150)
    lab, k = ndi.label(~barrier)   # 4방향 연결
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    outside = np.isin(lab, list(edge))
    sat = (np.maximum(np.maximum(R, G), B) - np.minimum(np.minimum(R, G), B)) / np.maximum(1, np.maximum(np.maximum(R, G), B))
    near = ndi.binary_dilation(barrier, iterations=1)
    # 흰 가장자리(밝고 색이 옅다) + 원본의 옅은 갈색 그림자(어둡다 — 테두리에 바로 붙은 번짐은 남겨 테두리가 거칠어지지 않게)
    kill = outside & (A > 0) & (((sat < 0.33) & (lum > 150)) | ((R < 130) & ~near))
    out = a.copy(); out[kill] = 0
    return out, int(kill.sum())

def shadow_layer(size, box, alpha=84):
    W, H = size
    sh = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([v * SS for v in box], fill=(20, 12, 6, alpha))
    return sh.filter(ImageFilter.GaussianBlur(SS * 2.4)).resize((W, H), Image.LANCZOS)

def build(name, p, phase, pad, ears, head, tail=None, shadow=None, keep_below=None, erase=()):
    src = Image.open(f'{T}/turtle-{name}.png').convert('RGBA')
    l, t, r, b = pad
    W, H = src.width + l + r, src.height + t + b
    a = np.zeros((H, W, 4), np.uint8); a[t:t + src.height, l:l + src.width] = np.array(src)
    a, removed = defringe(a)
    body, shell, flat = recolor_shell(a)
    cell = p if not isinstance(p, tuple) else p[0]
    hd = (head[0] + l, head[1] + t, head[2], head[3])
    mean, std = body_tone(a, hd)
    body, cover = merge_back(body, shell, cell, hd, None if keep_below is None else keep_below + t, tone=mean)
    merged = int(cover.sum())
    flat = flat | cover
    # 손으로 짚어 지우는 자투리 선 (원본 좌표 상자)
    lumb = 0.3 * body[..., 0].astype(float) + 0.59 * body[..., 1] + 0.11 * body[..., 2]
    for x0, y0, x1, y1 in erase:
        box = np.zeros(flat.shape, bool); box[y0 + t:y1 + t, x0 + l:x1 + l] = True
        flat |= box & (body[..., 3] > 128) & (lumb < 215)
    # 선을 지우고 남은 점 같은 자투리(몸 안에 홀로 떠 있는 작은 어두운 조각)도 지운다 — 눈·입은 훨씬 크다
    lumb = 0.3 * body[..., 0].astype(float) + 0.59 * body[..., 1] + 0.11 * body[..., 2]
    spot = (body[..., 3] > 128) & (lumb < 205) & ~flat
    lab, k = ndi.label(spot, structure=np.ones((3, 3)))
    near_edit = ndi.binary_dilation(flat, iterations=4)
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        m = lab[sl] == i
        if m.sum() <= 14 and near_edit[sl][m].any(): flat[sl] |= m
    tex = fill_like_body(body, flat, std)
    body[..., :3][flat] = tex[flat].astype(np.uint8)
    # 귀·꼬리는 몸 밖에 새로 그리는 것이라 몸의 평균색에 같은 결을 얹는다
    rng = np.random.default_rng(11)
    nz = ndi.gaussian_filter(rng.standard_normal(flat.shape), 2.4); nz /= max(1e-6, nz.std())
    tex = np.clip(mean[None, None, :] + nz[..., None] * std[None, None, :] * 0.3, 0, 255)
    ph = (phase[0] + l, phase[1] + t)
    px = p if not isinstance(p, tuple) else p[0]
    parts = []
    if tail: parts.append((disc(p, ph, (tail[0] + l, tail[1] + t), tail[2]), CREAM, True))
    for base, tip, hw, inner in ears:
        A_ = (base[0] + l, base[1] + t); B_ = (tip[0] + l, tip[1] + t)
        parts.append((blunt(capsule(p, ph, A_, B_, hw)), CREAM, True))
        # 귀 안쪽 분홍 — 끝에서 inner[0]칸 들이고, 굵기는 inner[1]칸, inner[2]칸만큼 옆으로 민다
        dx, dy = B_[0] - A_[0], B_[1] - A_[1]; L = (dx * dx + dy * dy) ** 0.5
        Bi = (B_[0] - dx / L * px * inner[0], B_[1] - dy / L * px * inner[0])
        parts.append((capsule(p, ph, (A_[0] + inner[2] * px, A_[1]), (Bi[0] + inner[2] * px, Bi[1]), inner[1]), PINK, False))
    out = cells_layer((W, H), p, ph, parts)
    # 새로 그린 귀·꼬리의 크림색도 몸과 같은 색·결로
    o = np.array(out); cm = (o[..., 3] > 0) & (np.abs(o[..., :3].astype(int) - np.array(CREAM)).sum(axis=2) < 60)
    k = (o[..., :3].astype(float) / np.array(CREAM, float)).clip(0, 1)   # 테두리와 섞인 가장자리는 그 비율을 지킨다
    o[..., :3][cm] = (tex * k)[cm].astype(np.uint8)
    out = Image.fromarray(o)
    if shadow: out = Image.alpha_composite(shadow_layer((W, H), [shadow[0] + l, shadow[1] + t, shadow[2] + l, shadow[3] + t]), out)
    out = Image.alpha_composite(out, Image.fromarray(body))
    return out, (removed, merged)

def trim(im, pad=1):
    x0, y0, x1, y1 = im.getbbox()
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))

def avatar_square(im, size=168, fill=0.86):
    # 기본 프로필 그림: 거북이 것과 같은 168px 정사각 판에, 동그라미에 잘리지 않게 여백을 두고 얹는다
    fig = trim(im, 0)
    k = size * fill / max(fig.width, fig.height)
    fig = fig.resize((round(fig.width * k), round(fig.height * k)), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(fig, ((size - fig.width) // 2, (size - fig.height) // 2), fig)
    return out

# 그림마다: 격자 한 칸(px), 격자 시작점, 덧댈 여백(왼·위·오른·아래), 귀(뿌리, 끝, 반폭 칸, 안쪽 분홍), 꼬리(가운데 x, y, 반지름 칸), 그림자(상자)
# 좌표는 거북이 원본 그림의 px
SPRITES = {
    'wave': dict(p=3.57, phase=(0.25, -0.29), pad=(10, 22, 0, 0),
                 ears=[((70, 31), (56, 2), 1.75, (1.7, 0.9, 0.0)), ((82, 30), (80, -8), 1.7, (1.7, 0.75, 0.0))],
                 tail=(8, 78, 2.6), shadow=(18, 100, 100, 110), head=(79, 42, 27, 21), keep_below=88),
    'happy': dict(p=4.53, phase=(1.91, 3.33), pad=(12, 56, 0, 0),
                  ears=[((86, 12), (64, -24), 1.7, (1.7, 0.9, 0.0)), ((101, 8), (95, -38), 1.7, (1.7, 0.75, 0.0))],
                  tail=(11, 73, 2.8), shadow=(16, 99, 118, 111), head=(100, 31, 39, 30), keep_below=86),
    'rest': dict(p=(4.47, 4.31), phase=(1.6, 1.4), pad=(14, 44, 0, 0),
                 ears=[((86, 26), (60, -8), 1.7, (1.7, 0.9, 0.0)), ((101, 22), (90, -26), 1.7, (1.7, 0.75, 0.0))],
                 tail=(3, 66, 2.8), shadow=(10, 95, 150, 107), head=(106, 46, 36, 31), keep_below=78, erase=[(58, 64, 74, 80)]),
    'avatar': dict(p=4.53, phase=(0.83, 2.7), pad=(12, 26, 0, 0),
                   ears=[((94, 43), (72, 7), 1.7, (1.7, 0.9, 0.0)), ((109, 39), (103, -7), 1.7, (1.7, 0.75, 0.0))],
                   tail=(19, 104, 2.8), head=(108, 62, 39, 30), keep_below=117),
}

# 화면에 그릴 크기를 정할 때 쓰는 비율 — 거북이 그림과 같은 배율로 그려야 격자 한 칸이 같은 크기로 보인다 (TurtlePet.tsx의 ART)
SCALE = {'wave': 66 / 122, 'happy': 78 / 180, 'rest': 76 / 175}

if __name__ == '__main__':
    for name, spec in SPRITES.items():
        im, _ = build(name, **spec)
        im = avatar_square(im) if name == 'avatar' else trim(im)
        im.save(os.path.join(T, f'rabbit-{name}.png'), optimize=True)
        print(name, im.size, ('→ 화면 %d x %d' % (round(im.width * SCALE[name]), round(im.height * SCALE[name]))) if name in SCALE else '')
