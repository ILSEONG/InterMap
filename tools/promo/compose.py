# 찍어 온 화면(v*.mp4, s*.png)에 문구를 얹어 홍보영상과 스토어 스크린샷을 만든다.
#   python3 compose.py <찍은 폴더> <결과 폴더> [stills|video|check]
import os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC, DST = sys.argv[1], sys.argv[2]
ONLY = sys.argv[3] if len(sys.argv) > 3 else ''
TMP = os.path.join(DST, '_tmp'); os.makedirs(TMP, exist_ok=True)
FRONT = os.environ.get('FRONTEND') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'frontend')   # 앱 글꼴(Pretendard)과 아이콘을 그대로 쓴다
FONTS = os.path.join(FRONT, 'node_modules/pretendard/dist/public/static/')
ICON = os.path.join(FRONT, 'public/icon-512.png')
BG, INK, SOFT = (254, 245, 234), (28, 28, 30), (107, 107, 112)   # 배경은 앱 아이콘의 바탕색
font = lambda w, px: ImageFont.truetype(FONTS + f'Pretendard-{w}.otf', px)

# 장면: (찍은 영상, 영상 길이(초), 문구, 스크린샷) — 영상은 capture.py가 이 길이에 맞춰 한 프레임씩 찍어 온다
SCENES = [
    ('v1_map', 3.2, '이웃이 다녀온 맛집을\n지도에서 한눈에 봐요', 's1_map'),
    ('v2_sheet', 4.3, '이웃이 남긴 별점과 후기를\n바로 확인해요', 's2_sheet'),
    ('v3_filter', 3.7, '업종과 인원에 맞는 곳만\n골라서 봐요', 's3_filter'),
    ('v4_review', 4.4, '다녀온 곳은\n후기로 남겨요', 's7_review'),
    ('v5_cafe', 3.9, '맛집과 카페는\n탭으로 나눠서 봐요', 's4_cafe'),
    ('v6_poll', 3.9, '어디 갈지 고민될 땐\n투표로 같이 정해요', 's5_poll'),
    ('v7_recap', 4.3, '한 달의 맛집 기록을\n결산 카드로 돌아봐요', 's6_recap'),
]
END_SEC = 2.2
TAGLINE, NAME = '친구가 고른 맛집 지도', '인터맵'

def caption(size, text, px, top):
    """투명 바탕에 가운데 정렬 문구"""
    im = Image.new('RGBA', size, (0, 0, 0, 0)); d = ImageDraw.Draw(im); f = font('Bold', px); y = top
    for line in text.split('\n'):
        w = d.textlength(line, font=f, features=['kern']); d.text(((size[0] - w) / 2, y), line, font=f, fill=INK + (255,)); y += round(px * 1.34)
    return im

def rounded(size, r):
    m = Image.new('L', (size[0] * 4, size[1] * 4), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] * 4 - 1, size[1] * 4 - 1], r * 4, fill=255)
    return m.resize(size, Image.LANCZOS)

def base(size, box, r):
    """배경 + 화면이 놓일 자리의 그림자·테두리"""
    x, y, w, h = box; im = Image.new('RGB', size, BG)
    sh = Image.new('RGBA', size, (0, 0, 0, 0)); k = size[0] / 1080
    ImageDraw.Draw(sh).rounded_rectangle([x, y + round(20 * k), x + w, y + h + round(20 * k)], r, fill=(60, 40, 20, 62))
    im.paste(sh.filter(ImageFilter.GaussianBlur(34 * k)), (0, 0), sh.filter(ImageFilter.GaussianBlur(34 * k)))
    ImageDraw.Draw(im).rounded_rectangle([x - 2, y - 2, x + w + 1, y + h + 1], r + 2, fill=(226, 216, 203))
    return im

LAYOUT = {   # 크기: (문구 글자 크기, 문구 위치, 화면 상자, 모서리)
    (1080, 1920): (62, 92, (177, 300, 725, 1570), 46),
    (1290, 2796): (88, 176, (140, 540, 1010, 2186), 64),
}

def still(size, text, shot, out):
    px, top, box, r = LAYOUT[size]; im = base(size, box, r); x, y, w, h = box
    im.paste(Image.open(shot).convert('RGB').resize((w, h), Image.LANCZOS), (x, y), rounded((w, h), r))
    im.paste(caption(size, text, px, top), (0, 0), caption(size, text, px, top)); im.save(out, optimize=True)

def end_card(size):
    im = Image.new('RGB', size, BG); d = ImageDraw.Draw(im); cx = size[0] // 2; n = 280; x, y = cx - n // 2, 650
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

ENC = ['-r', '30', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-video_track_timescale', '15360', '-an']
def dur(f): return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], capture_output=True, text=True).stdout)

def video():
    size = (1080, 1920); px, top, box, r = LAYOUT[size]; x, y, w, h = box
    base(size, box, r).save(os.path.join(TMP, 'base.png')); rounded((w, h), r).save(os.path.join(TMP, 'mask.png'))
    parts = []
    for i, (clip, sec, text, _) in enumerate(SCENES):
        src = os.path.join(SRC, clip + '.mp4'); cap = os.path.join(TMP, f'cap{i}.png'); caption(size, text, px, top).save(cap); out = os.path.join(TMP, f'scene{i}.mp4')
        fc = (f"[0:v]loop=-1:1,fps=30[bg];[1:v]fps=30,scale={w}:{h}:flags=lanczos,tpad=stop_mode=clone:stop_duration=2,format=rgba[c];"
              f"[2:v]loop=-1:1,fps=30,format=gray[m];[c][m]alphamerge[p];[bg][p]overlay={x}:{y}[a];"
              f"[3:v]loop=-1:1,fps=30,format=rgba,fade=in:st=0.05:d=0.35:alpha=1[t];[a][t]overlay=0:0,trim=duration={sec},format=yuv420p[v]")
        run(['ffmpeg', '-y', '-loglevel', 'error', '-i', os.path.join(TMP, 'base.png'), '-i', src, '-i', os.path.join(TMP, 'mask.png'), '-i', cap, '-filter_complex', fc, '-map', '[v]', *ENC, out + '.part.mp4'])
        os.replace(out + '.part.mp4', out); parts.append(out); print(f'{clip}: {dur(src):.2f}s -> {dur(out):.2f}s'); sys.stdout.flush()
    end = os.path.join(TMP, 'end.png'); end_card(size).save(end); out = os.path.join(TMP, 'scene_end.mp4')
    bgc = '0x%02x%02x%02x' % BG
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', end, '-f', 'lavfi', '-i', f'color=c={bgc}:s=1080x1920:r=30', '-filter_complex',
         f"[0:v]loop=-1:1,fps=30,format=rgba,fade=in:st=0:d=0.45:alpha=1[e];[1:v][e]overlay=0:0,trim=duration={END_SEC},format=yuv420p[v]", '-map', '[v]', *ENC, out + '.part.mp4'])
    os.replace(out + '.part.mp4', out); parts.append(out)
    lst = os.path.join(TMP, 'list.txt'); open(lst, 'w').write(''.join(f"file '{os.path.abspath(p)}'\n" for p in parts))
    joined = os.path.join(TMP, 'joined.mp4'); run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined])
    full = os.path.join(DST, '인터맵_홍보영상_1080x1920.mp4')
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', joined, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', full])
    # App Store 앱 미리보기 규격(886x1920) — 가운데만 잘라 다시 인코딩
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', full, '-vf', 'crop=886:1920:97:0', '-r', '30', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.0',
         '-c:a', 'copy', '-movflags', '+faststart', os.path.join(DST, '인터맵_앱미리보기_886x1920.mp4')])
    print('total', f'{dur(full):.2f}s')

def stills():
    n = 0
    for clip, _, text, shot in SCENES:
        if not shot: continue
        n += 1
        for size, store in (((1290, 2796), '앱스토어_1290x2796'), ((1080, 1920), '플레이스토어_1080x1920')):
            d = os.path.join(DST, store); os.makedirs(d, exist_ok=True); still(size, text, os.path.join(SRC, shot + '.png'), os.path.join(d, f'{n:02d}.png'))
    print('stills', n)

if ONLY != 'video': stills()
if ONLY != 'stills': video()
