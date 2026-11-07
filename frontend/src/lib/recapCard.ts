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
const YELLOW = '#ffe81f'
const ORANGE = '#ff5a1f'
const CREAM = '#fff4d6'
const OLIVE = '#5f5a2a'
const ROUND = 'Jua, "Noto Sans KR", sans-serif'
// 친구 동그라미 색 (앱 아바타 파스텔 톤과 같은 계열을 진하게)
const FRIEND_COLORS = ['#3e63f2', '#e5486e', '#35c89a']

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

// 리본(동선) 꺾임점 — 왼쪽 위에서 시작해 지그재그로 내려와 오른쪽 밖으로 빠진다
const RIBBON: [number, number][] = [
  [175, 520],
  [905, 270],
  [205, 1060],
  [905, 840],
  [500, 1360],
  [1300, 1180],
]
async function drawFront(r: Recap): Promise<Blob> {
  const { canvas, ctx } = newCanvas()
  const [, monthNum] = r.month.split('-')

  ctx.fillStyle = YELLOW
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  // 리본 — 두툼한 선, 바깥 꺾임은 둥글게
  ctx.strokeStyle = ORANGE
  ctx.lineWidth = 270
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  RIBBON.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.stroke()

  // 오른쪽 위 크림색 동그라미 — 달
  ctx.fillStyle = CREAM
  circle(ctx, 890, 290, 84)
  ctx.fillStyle = INK
  ctx.font = `900 46px ${FONT}`
  const m = `${Number(monthNum)}월`
  ctx.fillText(m, 890 - ctx.measureText(m).width / 2, 306)

  // 작은 머리말 + 칭호 + 한 줄
  ctx.fillStyle = INK
  ctx.font = `700 34px ${FONT}`
  ctx.fillText(`나의 ${Number(monthNum)}월 칭호`, PAD, 1520)
  const persona = fitText(ctx, personaOf(r), (s) => `900 ${s}px ${FONT}`, 104, 64, CARD_WIDTH - PAD * 2)
  ctx.fillText(persona, PAD - 3, 1630)
  ctx.fillStyle = OLIVE
  ctx.font = `500 38px ${FONT}`
  ctx.fillText(`${r.places}곳 다녀왔어요`, PAD, 1712)

  // 오른쪽 아래 — 내 후기에 댓글 단 친구들 (이니셜 동그라미 + 나머지 인원)
  const bubbles = r.fans.slice(0, 2)
  const extra = r.fanTotal - bubbles.length
  const items = bubbles.map((f, i) => ({ text: f.name.slice(0, 1), color: FRIEND_COLORS[i % FRIEND_COLORS.length], ink: '#fff' }))
  if (extra > 0) items.push({ text: `+${extra}`, color: CREAM, ink: INK })
  const R = 50
  let x = CARD_WIDTH - PAD - R - (items.length - 1) * (R * 1.5)
  for (const it of items) {
    ctx.fillStyle = YELLOW
    circle(ctx, x, 1698, R + 6)
    ctx.fillStyle = it.color
    circle(ctx, x, 1698, R)
    ctx.fillStyle = it.ink
    ctx.font = `700 ${it.text.length > 2 ? 32 : 40}px ${FONT}`
    ctx.fillText(it.text, x - ctx.measureText(it.text).width / 2, 1712)
    x += R * 1.5
  }

  ctx.fillStyle = INK
  ctx.font = `900 26px ${FONT}`
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px'
  ctx.fillText('INTERMAP', PAD, 1830)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  return toBlob(canvas)
}

// 뒷면 — 음악 앱 연말 결산처럼: 큰 숫자 하나, 순위 목록 두 칸, 맛집 Top 3, 아래 두 숫자. 줄 대신 여백으로 나눈다
async function drawBack(r: Recap): Promise<Blob> {
  const { canvas, ctx } = newCanvas()
  const [year, monthNum] = r.month.split('-')

  // 노란 테두리 + 안쪽 흰 면
  ctx.fillStyle = YELLOW
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
      ctx.fillStyle = ORANGE
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
export async function drawRecapCards(r: Recap): Promise<{ front: Blob; back: Blob }> {
  await loadFonts(cardText(r))
  const [front, back] = await Promise.all([drawFront(r), drawBack(r)])
  return { front, back }
}

// 화면 낭독기용 — 카드 이미지에 담긴 내용을 글로
export function recapAltText(r: Recap): string {
  return [
    `${monthLabel(r.month, '')}의 나, ${personaOf(r)}. ${r.places}곳 다녀왔어요.`,
    ...rowsOf(r).map((row) => `${row.label} ${row.value}${row.sub ? ` ${row.sub}` : ''}.`),
  ].join(' ')
}
