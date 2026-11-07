import type { Recap } from './api'
import { monthLabel } from './time'

// 월간 결산 카드 — 인스타 스토리 비율(1080×1920) 이미지를 캔버스로 직접 그린다.
// 화면 미리보기도 이 이미지를 그대로 보여 준다 (보이는 것 = 공유되는 것).

export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1920
const FONT = '"Noto Sans KR", system-ui, sans-serif'
const PAD = 96

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

// 색·모양 — 밝은 회색 바탕 위에 한 가지 원색으로 칠한 두툼한 모양 하나, 글자는 검정.
// 달마다 모양과 색이 바뀐다 (같은 달은 늘 같은 카드)
const BG = '#f3f2ee'
const INK = '#111111'
const SOFT = '#6f6e69'
const LINE = 'rgba(17, 17, 17, 0.1)'
type Shape = 'scallop' | 'zigzag' | 'arches' | 'stack' | 'wave'
const LOOKS: { shape: Shape; color: string }[] = [
  { shape: 'scallop', color: '#e8e35a' },
  { shape: 'zigzag', color: '#ecbd5f' },
  { shape: 'arches', color: '#4f6ee8' },
  { shape: 'stack', color: '#e05a4e' },
  { shape: 'wave', color: '#9dd655' },
]

export function lookOf(month: string) {
  return LOOKS[Number(month.slice(5, 7)) % LOOKS.length]
}

// 카드에 들어가는 글자 — 폰트 하위 집합을 미리 받아 두려고 모은다
function cardText(r: Recap): string {
  return [
    'INTERMAP 월간 결산 친구가 고른 맛집 지도, 인터맵 다녀왔어요 곳 의 나 년 월 에 ★·.0123456789',
    personaOf(r),
    ...rowsOf(r).flatMap((row) => [row.label, row.value, row.sub ?? '']),
  ].join('')
}

async function loadFonts(text: string) {
  if (!document.fonts?.load) return
  await Promise.all(['400', '500', '700', '900'].map((w) => document.fonts.load(`${w} 64px ${FONT}`, text).catch(() => [])))
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
function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, min: number, width: number): string {
  for (let size = max; size > min; size -= 2) {
    ctx.font = `${weight} ${size}px ${FONT}`
    if (ctx.measureText(text).width <= width) return text
  }
  ctx.font = `${weight} ${min}px ${FONT}`
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1)
  return cut === text ? text : `${cut}…`
}

// 두툼한 선 하나로 그리는 모양 — 끝과 꺾임을 둥글게
function stroke(ctx: CanvasRenderingContext2D, points: [number, number][], width: number) {
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.stroke()
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

// 위쪽 큰 모양 (x0~x1, y0~y1 상자 안)
function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, color: string, x0: number, y0: number, x1: number, y1: number) {
  ctx.fillStyle = color
  ctx.strokeStyle = color
  const w = x1 - x0
  const h = y1 - y0
  switch (shape) {
    // 윗변이 물결인 덩어리 (Tickets)
    case 'scallop': {
      const bumps = 4
      const r = w / bumps / 2
      for (let i = 0; i < bumps; i++) circle(ctx, x0 + r + i * 2 * r, y0 + r, r)
      // 위 모서리는 반원들 아래로 각지게, 아래 모서리만 둥글게
      ctx.fillRect(x0, y0 + r, w, 120)
      roundRect(ctx, x0, y0 + r, w, h - r, 60)
      ctx.fill()
      break
    }
    // 두툼한 Z (Secret crypto)
    case 'zigzag': {
      const t = 210
      stroke(ctx, [[x0 + t / 2, y0 + t / 2], [x1 - t / 2, y0 + t / 2], [x0 + t / 2, y1 - t / 2], [x1 - t / 2, y1 - t / 2]], t)
      break
    }
    // 아치 셋이 이어진 M (Yoga)
    case 'arches': {
      const t = 230
      stroke(ctx, [[x0 + t / 2, y1 - t / 2], [x0 + t / 2, y0 + t / 2], [x0 + w / 2, y0 + h * 0.62], [x1 - t / 2, y0 + t / 2], [x1 - t / 2, y1 - t / 2]], t)
      break
    }
    // 알약을 겹겹이 쌓은 기둥 (social media)
    case 'stack': {
      const pill = 200
      const step = 150
      const n = Math.floor((h - pill) / step) + 1
      for (let i = 0; i < n; i++) {
        roundRect(ctx, x0, y0 + i * step, w, pill, pill / 2)
        ctx.fill()
      }
      break
    }
    // 세 번 접힌 물결 (Fintech) — 가로줄을 반원으로 이어 끊김 없는 리본
    case 'wave': {
      const t = 190
      const rows = 4
      const gap = (h - t) / (rows - 1)
      const R = gap / 2
      const left = x0 + t / 2 + R
      const right = x1 - t / 2 - R
      ctx.lineWidth = t
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x0 + t / 2, y0 + t / 2)
      for (let i = 0; i < rows; i++) {
        const y = y0 + t / 2 + gap * i
        const goingRight = i % 2 === 0
        const last = i === rows - 1
        ctx.lineTo(goingRight ? (last ? x1 - t / 2 : right) : last ? x0 + t / 2 : left, y)
        if (!last) ctx.arc(goingRight ? right : left, y + R, R, -Math.PI / 2, Math.PI / 2, !goingRight)
      }
      ctx.stroke()
      break
    }
  }
}

// 목록 한 줄 — 왼쪽 색 점 + 이름표, 오른쪽 값(굵게) + 덧말(흐리게)
function drawRow(ctx: CanvasRenderingContext2D, row: Row, x: number, w: number, baseline: number, dot: string) {
  ctx.fillStyle = dot
  circle(ctx, x + 12, baseline - 12, 12)
  ctx.fillStyle = SOFT
  ctx.font = `500 32px ${FONT}`
  ctx.fillText(row.label, x + 44, baseline)
  const labelW = ctx.measureText(row.label).width + 44

  const room = w - labelW - 40
  const sub = row.sub ? `  ${row.sub}` : ''
  ctx.font = `500 32px ${FONT}`
  let subW = sub ? ctx.measureText(sub).width : 0
  if (subW > room * 0.45) subW = 0
  const prefix = row.star ? '★ ' : ''
  const value = fitText(ctx, prefix + row.value, 700, 44, 30, room - subW)
  const valueW = ctx.measureText(value).width
  ctx.fillStyle = INK
  ctx.fillText(value, x + w - subW - valueW, baseline)
  if (subW) {
    ctx.fillStyle = SOFT
    ctx.font = `500 32px ${FONT}`
    ctx.fillText(sub, x + w - subW, baseline)
  }
}

export async function drawRecapCard(r: Recap): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('이 기기에서는 카드를 그릴 수 없어요.')
  await loadFonts(cardText(r))
  ctx.textBaseline = 'alphabetic'
  const inner = CARD_WIDTH - PAD * 2
  const look = lookOf(r.month)
  const [year, monthNum] = r.month.split('-')

  ctx.fillStyle = BG
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

  // 머리 — 왼쪽 검정 알약 "10월 결산", 오른쪽 날짜
  ctx.font = `700 30px ${FONT}`
  const chip = `${Number(monthNum)}월 결산`
  const chipW = ctx.measureText(chip).width + 60
  roundRect(ctx, PAD, 110, chipW, 66, 33)
  ctx.fillStyle = INK
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.fillText(chip, PAD + 30, 154)
  ctx.fillStyle = INK
  ctx.font = `700 30px ${FONT}`
  const brand = `INTERMAP · ${year}.${monthNum}`
  ctx.fillText(brand, CARD_WIDTH - PAD - ctx.measureText(brand).width, 154)

  // 큰 모양 — 흰 카드 위에 (레퍼런스의 프로젝트 카드처럼)
  const cardX = PAD - 24
  const cardY = 220
  const cardW = inner + 48
  const cardH = 980
  roundRect(ctx, cardX, cardY, cardW, cardH, 44)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  drawShape(ctx, look.shape, look.color, cardX + 22, cardY + 22, cardX + cardW - 22, cardY + cardH - 22)

  // 모양 위 왼쪽 아래에 칭호와 숫자
  ctx.fillStyle = INK
  const persona = fitText(ctx, personaOf(r), 700, 96, 56, cardW - 120)
  ctx.fillText(persona, cardX + 56, cardY + cardH - 150)
  ctx.font = `500 46px ${FONT}`
  ctx.fillText(r.places > 0 ? `${Number(monthNum)}월에 ${r.places}곳 다녀왔어요` : '아직 다녀온 곳이 없어요', cardX + 58, cardY + cardH - 74)

  // 아래 목록 — 얇은 선으로 나눈 줄, 줄마다 다른 색 점
  const rows = rowsOf(r)
  const rowH = 104
  const top = 1260
  const dots = [LOOKS[0].color, LOOKS[2].color, LOOKS[3].color, LOOKS[4].color, LOOKS[1].color]
  rows.forEach((row, i) => {
    const y = top + i * rowH
    if (i > 0) {
      ctx.fillStyle = LINE
      ctx.fillRect(PAD, y, inner, 2)
    }
    drawRow(ctx, row, PAD, inner, y + rowH / 2 + 14, dots[i % dots.length])
  })

  // 꼬리
  ctx.fillStyle = SOFT
  ctx.font = `500 30px ${FONT}`
  const foot = '친구가 고른 맛집 지도, 인터맵'
  ctx.fillText(foot, PAD, 1850)

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('카드를 만들지 못했어요.'))), 'image/png'),
  )
}

// 화면 낭독기용 — 카드 이미지에 담긴 내용을 글로
export function recapAltText(r: Recap): string {
  return [
    `${monthLabel(r.month, '')}의 나, ${personaOf(r)}. ${r.places}곳 다녀왔어요.`,
    ...rowsOf(r).map((row) => `${row.label} ${row.value}${row.sub ? ` ${row.sub}` : ''}.`),
  ].join(' ')
}
