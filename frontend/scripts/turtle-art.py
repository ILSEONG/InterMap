# 거북이 픽셀 그림 생성기 — 도형을 낮은 해상도 격자에 찍고 테두리를 자동으로 두른다
import math, sys
from PIL import Image

OUT='#4a3a2e'; BODY='#fff6e1'; SHADE='#f3e3c3'; SHELL='#f7a961'; SHELL_L='#fbc48d'; SHELL_D='#e98d44'
CHEEK='#f8b9ad'; SPARK='#f7a961'; HEART='#f58f77'; SHADOW='#00000018'

class Canvas:
    def __init__(s,w,h): s.w=w; s.h=h; s.px={}
    def set(s,x,y,c):
        if 0<=x<s.w and 0<=y<s.h: s.px[(x,y)]=c
    def part(s, mask, fill, outline=OUT):
        # 테두리(바깥으로 1칸) 먼저, 그다음 채움 — 뒤에 그린 부분이 앞 부분 위에 선을 남긴다
        for (x,y) in mask:
            for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
                if (x+dx,y+dy) not in mask: s.set(x+dx,y+dy,outline)
        for (x,y) in mask: s.set(x,y,fill)
    def dots(s, pts, c):
        for x,y in pts: s.set(x,y,c)

def ellipse(cx,cy,rx,ry,ymin=None,ymax=None):
    m=set()
    for y in range(int(cy-ry)-1,int(cy+ry)+2):
        for x in range(int(cx-rx)-1,int(cx+rx)+2):
            if ((x+0.5-cx)/rx)**2+((y+0.5-cy)/ry)**2<=1.0:
                if (ymin is None or y>=ymin) and (ymax is None or y<=ymax): m.add((x,y))
    return m
def rect(x0,y0,x1,y1): return {(x,y) for x in range(x0,x1+1) for y in range(y0,y1+1)}

def svg(c, path, scale_hint=None):
    rows=[]
    for y in range(c.h):
        x=0
        while x<c.w:
            col=c.px.get((x,y))
            if col is None: x+=1; continue
            x0=x
            while x<c.w and c.px.get((x,y))==col: x+=1
            if len(col)==9: rows.append(f'<rect x="{x0}" y="{y}" width="{x-x0}" height="1" fill="{col[:7]}" fill-opacity="{int(col[7:],16)/255:.2f}"/>')
            else: rows.append(f'<rect x="{x0}" y="{y}" width="{x-x0}" height="1" fill="{col}"/>')
    open(path,'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {c.w} {c.h}" shape-rendering="crispEdges">'+''.join(rows)+'</svg>\n')

def png(c, path, k=12, bg=(245,241,234)):
    im=Image.new('RGB',(c.w*k,c.h*k),bg)
    for (x,y),col in c.px.items():
        r,g,b=int(col[1:3],16),int(col[3:5],16),int(col[5:7],16)
        a=int(col[7:9],16)/255 if len(col)==9 else 1
        rgb=tuple(int(bg[i]*(1-a)+v*a) for i,v in enumerate((r,g,b)))
        for yy in range(k):
            for xx in range(k): im.putpixel((x*k+xx,y*k+yy),rgb)
    im.save(path)

def shell_detail(c, cx, cy, rx, ry, base_y):
    # 등딱지 아래쪽 어두운 띠와 위쪽 밝은 결
    for (x,y) in ellipse(cx,cy,rx,ry,ymax=base_y):
        if c.px.get((x,y))==SHELL:
            if y>=base_y-1: c.set(x,y,SHELL_D)
    for (x,y) in ellipse(cx-1.5,cy-1.5,rx*0.45,ry*0.35):
        if c.px.get((x,y))==SHELL: c.set(x,y,SHELL_L)

def standing(eyes='open', arm=False, extra=None):
    c=Canvas(38,30)
    c.dots(ellipse(18,27.4,14,1.5),SHADOW)
    # 등딱지 먼저 — 머리·가슴이 그 앞에 선다
    sh=ellipse(12,18,8.4,7.0,ymax=21)
    c.part(sh,SHELL)
    shell_detail(c,12,18,8.4,7.0,21)
    # 몸: 배 + 다리 + 가슴 + 머리 (한 덩어리)
    body=rect(6,22,22,23)|rect(7,24,10,26)|rect(18,24,21,26)|rect(19,15,24,23)|ellipse(25,10.5,6.6,6.2)
    c.part(body,BODY)
    # 흔드는 팔은 따로 그려 몸과 선으로 나뉘게 한다
    if arm:
        c.part(rect(25,20,26,21)|rect(26,18,28,20)|rect(28,16,30,18)|rect(30,14,32,16),BODY)
        c.dots([(24,20),(24,21)],BODY)
    c.dots(rect(11,24,17,24),SHADE)
    ex=23
    if eyes=='open':
        c.dots([(ex,10),(ex,11),(ex+5,10),(ex+5,11)],OUT)
    else:  # 웃는 눈 ^ ^
        c.dots([(ex-1,11),(ex,10),(ex+1,11),(ex+4,11),(ex+5,10),(ex+6,11)],OUT)
    c.dots([(ex+2,13),(ex+3,13)],OUT)
    c.dots([(ex-2,13),(ex-1,13),(ex+6,13),(ex+7,13)],CHEEK)
    if extra: extra(c)
    return c

def sparkle(c):
    c.dots([(33,2),(34,1),(35,5),(36,5),(34,8),(35,9)],SPARK)
def sparkle_wave(c):
    c.dots([(33,3),(34,2),(35,6),(36,6),(34,10),(35,11)],SPARK)

def resting():
    c=Canvas(38,30)
    c.dots(ellipse(18,27.4,15,1.5),SHADOW)
    sh=ellipse(11,20,8.2,6.2,ymax=23)
    c.part(sh,SHELL)
    shell_detail(c,11,20,8.2,6.2,23)
    # 엎드린 자세 — 머리를 앞발 위에 얹는다
    body=rect(4,24,22,25)|rect(3,25,6,26)|ellipse(23,18.5,6.6,6.0)|rect(18,24,29,26)
    c.part(body,BODY)
    c.dots([(24,25),(24,26)],OUT)
    ex=21
    c.dots([(ex-1,19),(ex,18),(ex+1,19),(ex+4,19),(ex+5,18),(ex+6,19)],OUT)
    c.dots([(ex+2,21),(ex+3,21)],OUT)
    c.dots([(ex-2,21),(ex-1,21),(ex+6,21),(ex+7,21)],CHEEK)
    hx,hy=30,5
    heart=["0110110","1111111","1111111","0111110","0011100","0001000"]
    for j,row in enumerate(heart):
        for i,ch in enumerate(row):
            if ch=='1': c.set(hx+i,hy+j,HEART)
    return c

def face():
    # 프로필용 — 얼굴을 크게, 등딱지는 뒤에 살짝
    c=Canvas(24,24)
    sh=ellipse(7,17,7.0,6.6)
    c.part(sh,SHELL)
    for (x,y) in ellipse(5.5,15,2.8,2.2):
        if c.px.get((x,y))==SHELL: c.set(x,y,SHELL_L)
    body=ellipse(13.5,12.5,7.4,7.0)|rect(10,18,17,23)
    c.part(body,BODY)
    c.dots([(11,11),(11,12),(16,11),(16,12)],OUT)
    c.dots([(13,14),(14,14)],OUT)
    c.dots([(9,14),(10,14),(17,14),(18,14)],CHEEK)
    return c

if __name__=='__main__':
    out=sys.argv[1] if len(sys.argv)>1 else '.'
    items={'turtle-wave':standing('open',arm=True,extra=sparkle_wave),'turtle-happy':standing('smile',extra=sparkle),'turtle-rest':resting(),'turtle-face':face()}
    for name,c in items.items():
        svg(c,f'{out}/{name}.svg'); png(c,f'{out}/{name}.png')
    # 한 장으로 모아 보기
    ims=[Image.open(f'{out}/{n}.png') for n in items]
    W=sum(i.width for i in ims)+30; H=max(i.height for i in ims)
    sheet=Image.new('RGB',(W,H),(245,241,234)); x=0
    for i in ims: sheet.paste(i,(x,0)); x+=i.width+10
    sheet.save(f'{out}/sheet.png')
