# 찍어 온 화면(v*.mp4, s*.png)에 문구·도입부·배경음악을 얹어 홍보영상과 스토어 스크린샷을 만든다.
#   python3 compose.py <찍은 폴더> <결과 폴더> [stills|video]
# 영상은 음악 박자(100BPM, 1박 = 0.6초)에 맞춰 자른다 — 장면이 바뀌는 순간이 박에 떨어진다.
import os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import music

SRC, DST = sys.argv[1], sys.argv[2]
ONLY = sys.argv[3] if len(sys.argv) > 3 else ''
TMP = os.path.join(DST, '_tmp'); os.makedirs(TMP, exist_ok=True)
FRONT = os.environ.get('FRONTEND') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'frontend')   # 앱 글꼴(Pretendard)과 아이콘을 그대로 쓴다
FONTS = os.path.join(FRONT, 'node_modules/pretendard/dist/public/static/')
ICON = os.path.join(FRONT, 'public/icon-512.png')
BG, INK, SOFT = (254, 245, 234), (28, 28, 30), (107, 107, 112)   # 배경은 앱 아이콘의 바탕색
font = lambda w, px: ImageFont.truetype(FONTS + f'Pretendard-{w}.otf', px)
BEAT = music.BEAT

# 도입부 — 왜 이 앱인가 (문구는 정해 준 그대로). 어두운 화면 셋 → 밝은 화면으로 넘어가며 답을 준다
HOOK = ['소중한 기념일날,\n별점 4.9 믿고 갔는데', '알고 보니 광고였다....']
ASK = '이런 경험 한번씩은 있으시죠?'
ANSWER = '이제 인터맵에서\n내가 믿을 수 있는 이웃의 후기만 봐요'
INTRO_STEPS = {'full': (4, 4, 4, 4), 'preview': (3, 2, 3, 4)}   # 편집별로 네 화면의 길이(박)
END_BEATS = 4
# 장면: (찍은 영상, 문구, 스크린샷, 홍보영상에서의 길이(박), 앱 미리보기에서의 길이(박) — 0이면 뺀다)
SCENES = [
    ('v1_map', '이웃이 다녀온 맛집을\n지도에서 한눈에 봐요', 's1_map', 5, 5),
    ('v2_sheet', '이웃이 남긴 별점과 후기를\n바로 확인해요', 's2_sheet', 7, 7),
    ('v3_filter', '업종과 인원에 맞는 곳만\n골라서 봐요', 's3_filter', 6, 0),
    ('v4_review', '다녀온 곳은\n후기로 남겨요', 's7_review', 7, 0),
    ('v5_cafe', '맛집과 카페는\n탭으로 나눠서 봐요', 's4_cafe', 6, 6),
    ('v6_poll', '어디 갈지 고민될 땐\n투표로 같이 정해요', 's5_poll', 6, 6),
    ('v7_recap', '한 달의 맛집 기록을\n결산 카드로 돌아봐요', 's6_recap', 7, 8),
]
TAGLINE, NAME = '이웃과 함께 만드는 맛집 지도', '인터맵'
LOUDNESS = -16.0   # 배경음악 크기(LUFS)

def caption(size, text, px, top=None):
    """투명 바탕에 가운데 정렬 문구 (top이 없으면 화면 한가운데)"""
    im = Image.new('RGBA', size, (0, 0, 0, 0)); d = ImageDraw.Draw(im); f = font('Bold', px); lines = text.split('\n'); lh = round(px * 1.36)
    y = top if top is not None else (size[1] - lh * len(lines)) // 2 - round(px * 0.6)
    for line in lines:
        w = d.textlength(line, font=f, features=['kern']); d.text(((size[0] - w) / 2, y), line, font=f, fill=INK + (255,)); y += lh
    return im

def rounded(size, r):
    m = Image.new('L', (size[0] * 4, size[1] * 4), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] * 4 - 1, size[1] * 4 - 1], r * 4, fill=255)
    return m.resize(size, Image.LANCZOS)

def base(size, box, r):
    """배경 + 화면이 놓일 자리의 그림자·테두리"""
    x, y, w, h = box; im = Image.new('RGB', size, BG)
    sh = Image.new('RGBA', size, (0, 0, 0, 0)); k = size[0] / 1080
    ImageDraw.Draw(sh).rounded_rectangle([x, y + round(20 * k), x + w, y + h + round(20 * k)], r, fill=(60, 40, 20, 62))
    sh = sh.filter(ImageFilter.GaussianBlur(34 * k)); im.paste(sh, (0, 0), sh)
    ImageDraw.Draw(im).rounded_rectangle([x - 2, y - 2, x + w + 1, y + h + 1], r + 2, fill=(226, 216, 203))
    return im

LAYOUT = {   # 크기: (문구 글자 크기, 문구 위치, 화면 상자, 모서리)
    (1080, 1920): (62, 92, (177, 300, 725, 1570), 46),
    (1290, 2796): (88, 176, (140, 540, 1010, 2186), 64),
}

def still(size, text, shot, out):
    px, top, box, r = LAYOUT[size]; im = base(size, box, r); x, y, w, h = box
    im.paste(Image.open(shot).convert('RGB').resize((w, h), Image.LANCZOS), (x, y), rounded((w, h), r))
    cap = caption(size, text, px, top); im.paste(cap, (0, 0), cap); im.save(out, optimize=True)

def end_card(size):
    im = Image.new('RGB', size, BG); cx = size[0] // 2; n = 280; x, y = cx - n // 2, 650
    sh = Image.new('RGBA', size, (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle([x, y + 14, x + n, y + n + 14], 64, fill=(60, 40, 20, 56))
    sh = sh.filter(ImageFilter.GaussianBlur(26)); im.paste(sh, (0, 0), sh)
    ImageDraw.Draw(im).rounded_rectangle([x - 2, y - 2, x + n + 1, y + n + 1], 66, fill=(232, 221, 207))      # 앱 아이콘 타일
    im.paste(Image.open(ICON).convert('RGB').resize((n, n), Image.LANCZOS), (x, y), rounded((n, n), 64))
    for text, f, ty, col in ((NAME, font('ExtraBold', 96), 990, INK), (TAGLINE, font('Medium', 50), 1126, SOFT)):
        d = ImageDraw.Draw(im); d.text((cx - d.textlength(text, font=f) / 2, ty), text, font=f, fill=col)
    return im

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print(r.stderr[-1500:]); sys.exit(1)
    return r

ENC = ['-r', '30', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-video_track_timescale', '15360', '-an']
def dur(f): return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout)
def part(name, build):
    """한 조각을 만든다 (이미 있으면 다시 만들지 않는다)"""
    out = os.path.join(TMP, name + '.mp4')
    if not os.path.exists(out): build(out + '.part.mp4'); os.replace(out + '.part.mp4', out)
    return out

SIZE = (1080, 1920); BGC = '0x%02x%02x%02x' % BG
DARK, STAR, DIM = (28, 28, 30), (255, 159, 10), (86, 86, 92)
def star_row(d, cx, cy, r, color, k):
    """별 다섯 개 (k배로 크게 그린 뒤 줄여서 가장자리를 매끈하게)"""
    import math
    for i in range(5):
        x0 = cx + (i - 2) * r * 2.5
        pts = [(k * (x0 + (r if j % 2 == 0 else r * 0.46) * math.sin(j * math.pi / 5)), k * (cy - (r if j % 2 == 0 else r * 0.46) * math.cos(j * math.pi / 5))) for j in range(10)]
        d.polygon(pts, fill=color)

def hook_card(step):
    """어두운 도입 화면. 0: 별점과 첫 문장 / 1: 별이 꺼지고 둘째 문장 / 2: 되묻는 문장만"""
    k = 3; im = Image.new('RGB', (SIZE[0] * k, SIZE[1] * k), DARK); d = ImageDraw.Draw(im)
    if step < 2: star_row(d, SIZE[0] / 2, 690, 36, STAR if step == 0 else DIM, k)
    im = im.resize(SIZE, Image.LANCZOS); d = ImageDraw.Draw(im); white, gray = (255, 255, 255), (142, 142, 147)
    def line(text, f, y, col): d.text(((SIZE[0] - d.textlength(text, font=f)) / 2, y), text, font=f, fill=col)
    if step < 2:
        for i, t in enumerate(HOOK[0].split('\n')): line(t, font('Bold', 64), 786 + i * 88, white if step == 0 else gray)
        if step == 1: line(HOOK[1], font('ExtraBold', 82), 990, white)
    else: line(ASK, font('Bold', 62), 900, white)
    return im

def intro_part(name):
    steps = INTRO_STEPS[name]; t = [sum(steps[:i]) * BEAT for i in range(1, 5)]; f = [os.path.join(TMP, f'intro{i}.png') for i in range(4)]
    hook_card(0).save(f[0]); hook_card(1).convert('RGBA').save(f[1]); hook_card(2).convert('RGBA').save(f[2])
    ans = Image.new('RGBA', SIZE, BG + (255,)); cap = caption(SIZE, ANSWER, 56); ans.paste(cap, (0, 0), cap); ans.save(f[3])
    # 어두운 화면끼리는 부드럽게, 밝은 화면으로는 박에 맞춰 딱 넘긴다
    fc = (f"[0:v]loop=-1:1,fps=30,format=yuv420p[a];[1:v]loop=-1:1,fps=30,format=rgba,fade=in:st={t[0] - 0.1:.2f}:d=0.22:alpha=1[b];"
          f"[2:v]loop=-1:1,fps=30,format=rgba,fade=in:st={t[1] - 0.1:.2f}:d=0.22:alpha=1[c];[3:v]loop=-1:1,fps=30,format=rgba,fade=in:st={t[2] - 0.05:.2f}:d=0.1:alpha=1[d];"
          f"[a][b]overlay=0:0[x];[x][c]overlay=0:0[y];[y][d]overlay=0:0,trim=duration={t[3]},format=yuv420p[v]")
    return part('intro_' + name, lambda o: run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f[0], '-i', f[1], '-i', f[2], '-i', f[3], '-filter_complex', fc, '-map', '[v]', *ENC, o]))

def scene_part(i, clip, text, beats):
    px, top, box, r = LAYOUT[SIZE]; x, y, w, h = box; sec = beats * BEAT
    src = os.path.join(SRC, clip + '.mp4'); cap = os.path.join(TMP, f'cap{i}.png'); caption(SIZE, text, px, top).save(cap)
    assert dur(src) >= sec - 0.3, (clip, dur(src), sec)   # 조금 모자라면 마지막 화면을 잠깐 붙든다
    fc = (f"[0:v]loop=-1:1,fps=30[bg];[1:v]fps=30,scale={w}:{h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=2,format=rgba[c];"
          f"[2:v]loop=-1:1,fps=30,format=gray[m];[c][m]alphamerge[p];[bg][p]overlay={x}:{y}[a];"
          f"[3:v]loop=-1:1,fps=30,format=rgba,fade=in:st=0.05:d=0.35:alpha=1[t];[a][t]overlay=0:0,trim=duration={sec},format=yuv420p[v]")
    return part(f'scene{i}_{beats}', lambda o: run(['ffmpeg', '-y', '-loglevel', 'error', '-i', os.path.join(TMP, 'base.png'), '-i', src, '-i', os.path.join(TMP, 'mask.png'), '-i', cap, '-filter_complex', fc, '-map', '[v]', *ENC, o]))

def end_part():
    sec = END_BEATS * BEAT; end = os.path.join(TMP, 'end.png'); end_card(SIZE).save(end)
    fc = f"[0:v]loop=-1:1,fps=30,format=rgba,fade=in:st=0:d=0.45:alpha=1[e];[1:v][e]overlay=0:0,trim=duration={sec},format=yuv420p[v]"
    return part('end', lambda o: run(['ffmpeg', '-y', '-loglevel', 'error', '-i', end, '-f', 'lavfi', '-i', f'color=c={BGC}:s=1080x1920:r=30', '-filter_complex', fc, '-map', '[v]', *ENC, o]))

def cut(name, col, out, crop=None):
    """한 편을 만든다: 도입부 + 장면들 + 끝 화면, 그 길이에 맞춘 음악"""
    px, top, box, r = LAYOUT[SIZE]; base(SIZE, box, r).save(os.path.join(TMP, 'base.png')); rounded(box[2:], r).save(os.path.join(TMP, 'mask.png'))
    intro = sum(INTRO_STEPS[name]); parts = [intro_part(name)] + [scene_part(i, s[0], s[1], s[col]) for i, s in enumerate(SCENES) if s[col]] + [end_part()]
    body = sum(s[col] for s in SCENES)
    lst = os.path.join(TMP, name + '.txt'); open(lst, 'w').write(''.join(f"file '{os.path.abspath(p)}'\n" for p in parts))
    joined = os.path.join(TMP, name + '_joined.mp4'); run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined])
    wav = os.path.join(TMP, name + '.wav'); music.make(wav, intro, body, END_BEATS, shatter_at=INTRO_STEPS[name][0] * BEAT)   # '알고 보니 광고였다'가 뜨는 순간
    m = re.search(r'I:\s+(-?[0-9.]+) LUFS', run(['ffmpeg', '-hide_banner', '-i', wav, '-af', 'ebur128', '-f', 'null', '-']).stderr.split('Summary')[-1]); gain = LOUDNESS - float(m.group(1))
    video = ['-c:v', 'copy'] if not crop else ['-vf', crop, '-r', '30', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0']
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', joined, '-i', wav, '-map', '0:v', '-map', '1:a', *video, '-af', f'volume={gain:.2f}dB', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', out])
    print(f'{os.path.basename(out)}: {dur(out):.2f}s (도입 {intro}박 + 본편 {body}박 + 끝 {END_BEATS}박, 음악 {gain:+.1f}dB)'); sys.stdout.flush()

def video():
    cut('full', 3, os.path.join(DST, '인터맵_홍보영상_1080x1920.mp4'))
    # App Store 앱 미리보기 규격(886x1920, 30초 이하) — 가운데만 자르고, 후기 쓰기 장면을 뺀 짧은 편집
    cut('preview', 4, os.path.join(DST, '인터맵_앱미리보기_886x1920.mp4'), crop='crop=886:1920:97:0')

def stills():
    n = 0
    for clip, text, shot, _, _ in SCENES:
        n += 1
        for size, store in (((1290, 2796), '앱스토어_1290x2796'), ((1080, 1920), '플레이스토어_1080x1920')):
            d = os.path.join(DST, store); os.makedirs(d, exist_ok=True); still(size, text, os.path.join(SRC, shot + '.png'), os.path.join(d, f'{n:02d}.png'))
    print('stills', n)

if ONLY != 'video': stills()
if ONLY != 'stills': video()
