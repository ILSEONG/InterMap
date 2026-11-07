import '@fontsource/jua/400.css'
import type { Recap } from './api'
import { monthLabel } from './time'

// 월간 결산 카드 — 인스타 스토리 비율(1080×1920) 이미지 두 장(앞·뒤)을 캔버스로 직접 그린다.
// 앞면: 노란 바탕을 가로지르는 주황 리본 = 이 달의 동선(다녀온 곳만큼 정류장 점), 칭호, 댓글 단 친구들
// 뒷면: 노란 테두리 안 흰 바탕에 둥근 글씨(주아)로 숫자들
// 화면 미리보기도 이 이미지를 그대로 보여 준다 (보이는 것 = 공유되는 것).

export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1920
const FONT = '"Noto Sans KR", system-ui, sans-serif'
const PAD = 90

// 이 달을 한마디로 — 많이 간 장르 → 동네 → 별점 성향 → 다닌 양 순으로 본다
export function personaOf(r: Recap): string {
  if (r.places === 0) return '쉬어 가는 달'
  if (r.topCategory && r.topCategory.count >= 2 && r.topCategory.count / r.places >= 0.4) return `${r.topCategory.name} 탐험가`
  if (r.topArea && r.topArea.count >= 2 && r.topArea.count / r.places >= 0.5) return `${areaShort(r.topArea.name)} 터줏대감`
  if (r.avgRating !== null && r.avgRating >= 4.5) return '칭찬 요정'
  if (r.avgRating !== null && r.avgRating <= 3) return '깐깐한 미식가'
  if (r.places >= 8) return '프로 맛집러'
  return '동네 미식가'
}

// "망원동" → "망원" (칭호에 붙일 때만). "성수동1가"처럼 숫자가 붙은 건 그대로
function areaShort(name: string): string {
  return /^[가-힣]{2,}동$/.test(name) ? name.slice(0, -1) : name
}

interface Row {
  label: string
  value: string
  // 값 뒤에 흐리게 붙는 말 ("4곳", "댓글 7개")
  sub?: string
  // 별점 줄 — 값 앞에 작은 별
  star?: boolean
}

// 카드 아래 목록. 없는 값은 다른 숫자로 채운다
export function rowsOf(r: Recap): Row[] {
  const rows: Row[] = [
    r.topCategory
      ? { label: '최애 장르', value: r.topCategory.name, sub: `${r.topCategory.count}곳` }
      : { label: '최애 장르', value: '골고루' },
    r.topArea ? { label: '자주 간 동네', value: r.topArea.name, sub: `${r.topArea.count}곳` } : { label: '자주 간 동네', value: '여기저기' },
    { label: '평균 별점', value: r.avgRating === null ? '-' : r.avgRating.toFixed(1), sub: ratingWord(r.avgRating), star: r.avgRating !== null },
    r.topFan
      ? { label: '단골 손님', value: r.topFan.name, sub: `댓글 ${r.topFan.count}개` }
      : r.photos > 0
        ? { label: '남긴 사진', value: `${r.photos}장` }
        : { label: '새 이웃', value: `${r.newFollowing}명` },
  ]
  if (r.best) rows.push({ label: '이달의 한 곳', value: r.best.name, sub: `★ ${r.best.rating.toFixed(1)}` })
  return rows
}

function ratingWord(avg: number | null): string {
  if (avg === null) return ''
  if (avg >= 4.5) return '후한 편'
  if (avg >= 3.8) return '대체로 만족'
  if (avg >= 3) return '꼼꼼한 편'
  return '깐깐한 편'
}

const INK = '#141414'
const ROUND = 'Jua, "Noto Sans KR", sans-serif'
// 친구 동그라미 색 (앱 아바타 파스텔 톤과 같은 계열을 진하게)
const FRIEND_COLORS = ['#3e63f2', '#e5486e', '#35c89a']

// 테마 — 앞면 바탕·모양·글자색과 뒷면 테두리·순위 숫자색. 레이아웃은 모두 같다
type Ctx = CanvasRenderingContext2D
export interface RecapTheme {
  id: string
  name: string
  bg: string
  shape: string
  ink: string
  sub: string
  badge: string
  badgeInk: string
  // 뒷면 흰 바탕 위 순위 숫자 — 흰 바탕에서 읽히는 진한 색
  accent: string
  draw: (ctx: Ctx, t: RecapTheme) => void
}

function thickPath(ctx: Ctx, pts: [number, number][], width: number, cap: CanvasLineCap = 'round') {
  ctx.lineWidth = width
  ctx.lineCap = cap
  ctx.lineJoin = 'round'
  ctx.beginPath()
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.stroke()
}

export const RECAP_THEMES: RecapTheme[] = [
  {
    // 노랑 바탕을 가로지르는 주황 지그재그 리본
    id: 'lemon',
    name: '레몬',
    bg: '#ffe81f',
    shape: '#ff5a1f',
    ink: INK,
    sub: '#5f5a2a',
    badge: '#fff4d6',
    badgeInk: INK,
    accent: '#ff5a1f',
    draw: (ctx, t) => {
      ctx.strokeStyle = t.shape
      thickPath(ctx, [[175, 520], [905, 270], [205, 1060], [905, 840], [500, 1360], [1300, 1180]], 270)
    },
  },
  {
    // 민트 바탕에 초코색 S자 리본 — 화면 밖에서 들어와 두 번 휘고 밖으로
    id: 'mintchoco',
    name: '민트초코',
    bg: '#bff2de',
    shape: '#3d2b22',
    ink: '#1b1714',
    sub: '#3c5f52',
    badge: '#fffaf0',
    badgeInk: '#1b1714',
    accent: '#16936c',
    draw: (ctx, t) => {
      const w = 230
      const R = 230
      const ys = [360, 360 + 2 * R, 360 + 4 * R]
      ctx.strokeStyle = t.shape
      ctx.lineWidth = w
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-200, ys[0])
      ctx.lineTo(730, ys[0])
      ctx.arc(730, ys[0] + R, R, -Math.PI / 2, Math.PI / 2, false)
      ctx.lineTo(350, ys[1])
      ctx.arc(350, ys[1] + R, R, -Math.PI / 2, Math.PI / 2, true)
      ctx.lineTo(1300, ys[2])
      ctx.stroke()
    },
  },
  {
    // 파랑 바탕에 라임 무지개 아치 두 겹 + 가운데 해
    id: 'blueberry',
    name: '블루베리',
    bg: '#3550f2',
    shape: '#c6f24e',
    ink: '#ffffff',
    sub: 'rgba(255, 255, 255, 0.78)',
    badge: '#c6f24e',
    badgeInk: INK,
    accent: '#3550f2',
    draw: (ctx, t) => {
      const cx = 540
      const cy = 1200
      ctx.strokeStyle = t.shape
      for (const r of [520, 300]) {
        ctx.lineWidth = 170
        ctx.lineCap = 'butt'
        ctx.beginPath()
        ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI)
        ctx.stroke()
      }
      ctx.fillStyle = t.shape
      ctx.beginPath()
      ctx.arc(cx, cy, 110, Math.PI, 2 * Math.PI)
      ctx.fill()
    },
  },
  {
    // 연분홍 바탕에 빨간 체리 두 알 — 꼭지는 진한 글자색
    id: 'cherry',
    name: '체리',
    bg: '#ffd5de',
    shape: '#e5233f',
    ink: '#2a0d14',
    sub: '#8a4b5a',
    badge: '#ffffff',
    badgeInk: '#2a0d14',
    accent: '#e5233f',
    draw: (ctx, t) => {
      const cherries: [number, number, number][] = [
        [330, 1010, 230],
        [740, 1100, 215],
      ]
      ctx.strokeStyle = t.ink
      ctx.lineWidth = 40
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(330, 790)
      ctx.quadraticCurveTo(380, 500, 660, 360)
      ctx.moveTo(740, 890)
      ctx.quadraticCurveTo(700, 560, 660, 360)
      ctx.stroke()
      // 잎
      ctx.fillStyle = t.ink
      ctx.save()
      ctx.translate(760, 330)
      ctx.rotate(-0.5)
      ctx.beginPath()
      ctx.ellipse(0, 0, 130, 56, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      for (const [x, y, r] of cherries) {
        ctx.fillStyle = t.shape
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
        ctx.beginPath()
        ctx.ellipse(x - r * 0.42, y - r * 0.42, r * 0.16, r * 0.1, -0.8, 0, Math.PI * 2)
        ctx.fill()
      }
    },
  },
  {
    // 검정 바탕에 형광 라임 꽃 — 꽃잎 여섯 장, 가운데는 바탕색 구멍
    id: 'nightlime',
    name: '나이트 라임',
    bg: '#161616',
    shape: '#d4ff3a',
    ink: '#ffffff',
    sub: '#a9a9a9',
    badge: '#d4ff3a',
    badgeInk: INK,
    accent: '#161616',
    draw: (ctx, t) => {
      const cx = 540
      const cy = 790
      ctx.fillStyle = t.shape
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6
        ctx.beginPath()
        ctx.arc(cx + Math.cos(a) * 250, cy + Math.sin(a) * 250, 200, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.beginPath()
      ctx.arc(cx, cy, 260, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = t.bg
      ctx.beginPath()
      ctx.arc(cx, cy, 120, 0, Math.PI * 2)
      ctx.fill()
    },
  },
]

// 달마다 기본 테마가 바뀐다 (화면에서 직접 고를 수도 있다)
export function defaultThemeId(month: string): string {
  return RECAP_THEMES[Number(month.slice(5, 7)) % RECAP_THEMES.length].id
}

// 카드에 들어가는 글자 — 폰트 하위 집합을 미리 받아 두려고 모은다
function cardText(r: Recap): string {
  return [
    'INTERMAP 인터맵 월간 결산 친구가 고른 맛집 지도 다녀왔어요 곳 의 나 기록 년 월 에 명 ★·.+0123456789',
    personaOf(r),
    ...r.fans.map((f) => f.name),
    ...r.categories.map((c) => c.name),
    ...r.areas.map((a) => a.name),
    ...r.list.map((p) => p.name),
    '이번 달 다녀온 곳 많이 간 장르 동네 이달의 맛집 Top 3 평균 별점 단골 손님 나의 칭호 댓글 개 장',
    ...rowsOf(r).flatMap((row) => [row.label, row.value, row.sub ?? '']),
  ].join('')
}

async function loadFonts(text: string) {
  if (!document.fonts?.load) return
  await Promise.all([
    ...['500', '700', '900'].map((w) => document.fonts.load(`${w} 64px ${FONT}`, text).catch(() => [])),
    document.fonts.load(`400 64px ${ROUND}`, text).catch(() => []),
  ])
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r)
    return
  }
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// 폭에 맞을 때까지 글자를 줄이고, 최소 크기에서도 넘치면 말줄임. 정한 글꼴을 ctx에 남긴다
function fitText(ctx: CanvasRenderingContext2D, text: string, font: (size: number) => string, max: number, min: number, width: number): string {
  for (let size = max; size > min; size -= 2) {
    ctx.font = font(size)
    if (ctx.measureText(text).width <= width) return text
  }
  ctx.font = font(min)
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1)
  return cut === text ? text : `${cut}…`
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function newCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('이 기기에서는 카드를 그릴 수 없어요.')
  ctx.textBaseline = 'alphabetic'
  return { canvas, ctx }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('카드를 만들지 못했어요.'))), 'image/png'),
  )
}

async function drawFront(r: Recap, t: RecapTheme): Promise<Blob> {
  const { canvas, ctx } = newCanvas()
  const [, monthNum] = r.month.split('-')

  ctx.fillStyle = t.bg
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  t.draw(ctx, t)

  // 오른쪽 위 크림색 동그라미 — 달
  ctx.fillStyle = t.badge
  circle(ctx, 890, 290, 84)
  ctx.fillStyle = t.badgeInk
  ctx.font = `900 46px ${FONT}`
  const m = `${Number(monthNum)}월`
  ctx.fillText(m, 890 - ctx.measureText(m).width / 2, 306)

  // 작은 머리말 + 칭호 + 한 줄
  ctx.fillStyle = t.ink
  ctx.font = `700 34px ${FONT}`
  ctx.fillText(`나의 ${Number(monthNum)}월 칭호`, PAD, 1520)
  const persona = fitText(ctx, personaOf(r), (s) => `900 ${s}px ${FONT}`, 104, 64, CARD_WIDTH - PAD * 2)
  ctx.fillText(persona, PAD - 3, 1630)
  ctx.fillStyle = t.sub
  ctx.font = `500 38px ${FONT}`
  ctx.fillText(`${r.places}곳 다녀왔어요`, PAD, 1712)

  // 오른쪽 아래 — 내 후기에 댓글 단 친구들 (이니셜 동그라미 + 나머지 인원)
  const bubbles = r.fans.slice(0, 2)
  const extra = r.fanTotal - bubbles.length
  const items = bubbles.map((f, i) => ({ text: f.name.slice(0, 1), color: FRIEND_COLORS[i % FRIEND_COLORS.length], ink: '#fff' }))
  if (extra > 0) items.push({ text: `+${extra}`, color: t.badge, ink: t.badgeInk })
  const R = 50
  let x = CARD_WIDTH - PAD - R - (items.length - 1) * (R * 1.5)
  for (const it of items) {
    ctx.fillStyle = t.bg
    circle(ctx, x, 1698, R + 6)
    ctx.fillStyle = it.color
    circle(ctx, x, 1698, R)
    ctx.fillStyle = it.ink
    ctx.font = `700 ${it.text.length > 2 ? 32 : 40}px ${FONT}`
    ctx.fillText(it.text, x - ctx.measureText(it.text).width / 2, 1712)
    x += R * 1.5
  }

  ctx.fillStyle = t.ink
  ctx.font = `900 26px ${FONT}`
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px'
  ctx.fillText('INTERMAP', PAD, 1830)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  return toBlob(canvas)
}

// 뒷면 — 음악 앱 연말 결산처럼: 큰 숫자 하나, 순위 목록 두 칸, 맛집 Top 3, 아래 두 숫자. 줄 대신 여백으로 나눈다
async function drawBack(r: Recap, t: RecapTheme): Promise<Blob> {
  const { canvas, ctx } = newCanvas()
  const [year, monthNum] = r.month.split('-')

  // 테마색 테두리 + 안쪽 흰 면
  ctx.fillStyle = t.bg
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  const F = 48
  roundRect(ctx, F, F, CARD_WIDTH - F * 2, CARD_HEIGHT - F * 2, 60)
  ctx.fillStyle = '#fff'
  ctx.fill()

  const x = 130
  const right = CARD_WIDTH - 130
  const inner = right - x
  const GRAY = '#8b8778'
  const label = (text: string, lx: number, ly: number) => {
    ctx.fillStyle = GRAY
    ctx.font = `400 30px ${ROUND}`
    ctx.fillText(text, lx, ly)
  }

  // 머리
  label(`${year}년 ${Number(monthNum)}월 · 인터맵 결산`, x, 190)

  // 큰 숫자
  label('이번 달 다녀온 곳', x, 300)
  ctx.fillStyle = INK
  ctx.font = `400 200px ${ROUND}`
  const num = String(r.places)
  ctx.fillText(num, x - 6, 480)
  const numW = ctx.measureText(num).width
  ctx.font = `400 64px ${ROUND}`
  ctx.fillText('곳', x + numW + 10, 480)

  // 순위 목록 — 왼쪽 장르, 오른쪽 동네
  const colW = inner / 2 - 20
  const rankList = (title: string, items: { name: string; count?: number; rating?: number }[], lx: number, ly: number, w: number, empty: string) => {
    label(title, lx, ly)
    if (items.length === 0) {
      ctx.fillStyle = INK
      ctx.font = `400 40px ${ROUND}`
      ctx.fillText(empty, lx, ly + 76)
      return
    }
    items.slice(0, 3).forEach((it, i) => {
      const y = ly + 76 + i * 72
      ctx.fillStyle = t.accent
      ctx.font = `400 40px ${ROUND}`
      ctx.fillText(String(i + 1), lx, y)
      const tail = it.rating !== undefined ? `★ ${it.rating.toFixed(1)}` : it.count !== undefined ? `${it.count}곳` : ''
      ctx.font = `400 30px ${ROUND}`
      const tailW = tail ? ctx.measureText(tail).width + 16 : 0
      ctx.fillStyle = INK
      const name = fitText(ctx, it.name, (s) => `400 ${s}px ${ROUND}`, 40, 28, w - 48 - tailW)
      ctx.fillText(name, lx + 48, y)
      if (tail) {
        const nw = ctx.measureText(name).width
        ctx.fillStyle = GRAY
        ctx.font = `400 30px ${ROUND}`
        ctx.fillText(tail, lx + 48 + nw + 16, y)
      }
    })
  }
  rankList('많이 간 장르', r.categories, x, 660, colW, '골고루')
  rankList('많이 간 동네', r.areas, x + inner / 2 + 20, 660, colW, '여기저기')

  // 이달의 맛집 Top 3 — 별점 높은 순 (같으면 먼저 간 곳)
  const best = [...r.list].sort((a, b) => b.rating - a.rating).slice(0, 3)
  rankList('이달의 맛집 Top 3', best, x, 1050, inner, '-')

  // 아래 두 숫자
  const statY = 1450
  label('평균 별점', x, statY)
  ctx.fillStyle = INK
  ctx.font = `400 88px ${ROUND}`
  ctx.fillText(r.avgRating === null ? '-' : `★ ${r.avgRating.toFixed(1)}`, x - 4, statY + 110)
  const sx = x + inner / 2 + 20
  if (r.topFan) {
    label('단골 손님', sx, statY)
    ctx.fillStyle = INK
    ctx.fillText(fitText(ctx, r.topFan.name, (s) => `400 ${s}px ${ROUND}`, 88, 48, colW), sx - 4, statY + 110)
    label(`댓글 ${r.topFan.count}개`, sx, statY + 170)
  } else {
    const photo = r.photos > 0
    label(photo ? '남긴 사진' : '새 이웃', sx, statY)
    ctx.fillStyle = INK
    ctx.font = `400 88px ${ROUND}`
    ctx.fillText(photo ? `${r.photos}장` : `${r.newFollowing}명`, sx - 4, statY + 110)
  }

  // 꼬리
  ctx.fillStyle = INK
  ctx.font = `400 30px ${ROUND}`
  ctx.fillText('INTERMAP', x, CARD_HEIGHT - F - 96)
  label('친구가 고른 맛집 지도', right - (ctx.measureText('친구가 고른 맛집 지도').width), CARD_HEIGHT - F - 96)
  return toBlob(canvas)
}

// 앞·뒤 두 장
export async function drawRecapCards(r: Recap, themeId = defaultThemeId(r.month)): Promise<{ front: Blob; back: Blob }> {
  const theme = RECAP_THEMES.find((t) => t.id === themeId) ?? RECAP_THEMES[0]
  await loadFonts(cardText(r))
  const [front, back] = await Promise.all([drawFront(r, theme), drawBack(r, theme)])
  return { front, back }
}

// 화면 낭독기용 — 카드 이미지에 담긴 내용을 글로
export function recapAltText(r: Recap): string {
  return [
    `${monthLabel(r.month, '')}의 나, ${personaOf(r)}. ${r.places}곳 다녀왔어요.`,
    ...rowsOf(r).map((row) => `${row.label} ${row.value}${row.sub ? ` ${row.sub}` : ''}.`),
  ].join(' ')
}
