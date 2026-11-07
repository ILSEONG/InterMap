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
// 인터맵만의 모양 — 이 달의 기록에서 고른다
//  route  : 다녀온 곳 수만큼 정류장이 찍힌 이번 달 동선 (사람·달마다 다르게 굽는다)
//  noodles: 면 요리가 최애면 젓가락에 걸린 면발
//  bowl   : 국·탕·한식이 최애면 김 오르는 그릇
//  pin    : 한 동네를 자주 갔으면 커다란 지도 핀
type Shape = 'route' | 'noodles' | 'bowl' | 'pin'
// 독자 팔레트 — 토마토, 버터, 민트, 라일락, 인터맵 로즈, 코발트
const COLORS = ['#ff6a4d', '#ffd23f', '#35c89a', '#b7a3ff', '#e5486e', '#3e63f2']

export function lookOf(r: Recap): { shape: Shape; color: string } {
  const color = COLORS[Number(r.month.slice(5, 7)) % COLORS.length]
  const cat = r.topCategory?.name ?? ''
  if (/면|라멘|라면|국수|우동|소바|파스타|짬뽕|짜장|쌀국수|냉면/.test(cat)) return { shape: 'noodles', color }
  if (/국밥|국|탕|찌개|한식|순대|설렁|해장/.test(cat)) return { shape: 'bowl', color }
  if (r.topArea && r.places > 0 && r.topArea.count / r.places >= 0.5) return { shape: 'pin', color }
  return { shape: 'route', color }
}

// 같은 달·같은 기록이면 늘 같은 동선이 나오도록 씨앗 있는 난수
function seeded(seed: number) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
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

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

// 위쪽 큰 모양 (x0~x1, y0~y1 상자 안). 아래 30%쯤은 칭호 글자가 올라앉는 자리
function drawShape(ctx: CanvasRenderingContext2D, r: Recap, x0: number, y0: number, x1: number, y1: number) {
  const { shape, color } = lookOf(r)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  const w = x1 - x0
  const h = y1 - y0
  switch (shape) {
    case 'route': {
      // 정류장 3~8개를 지그재그 세 줄에 흩어 놓고 두툼한 길로 잇는다
      const rand = seeded(Number(r.month.replace('-', '')) * 31 + r.places)
      const stops = Math.min(Math.max(r.places, 3), 8)
      const pts: [number, number][] = []
      for (let i = 0; i < stops; i++) {
        const row = Math.floor((i / stops) * 3)
        const t = ((i / stops) * 3) % 1
        const along = row % 2 === 0 ? t : 1 - t
        pts.push([x0 + 110 + along * (w - 220) + (rand() - 0.5) * 80, y0 + 120 + row * (h * 0.27) + (rand() - 0.5) * 90])
      }
      ctx.lineWidth = 120
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2
        const my = (pts[i][1] + pts[i + 1][1]) / 2
        ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
      }
      ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1])
      ctx.stroke()
      // 정류장 — 흰 점에 검은 테, 마지막 곳은 검은 점
      pts.forEach(([x, y], i) => {
        ctx.fillStyle = i === pts.length - 1 ? INK : '#fff'
        circle(ctx, x, y, 34)
        ctx.lineWidth = 10
        ctx.strokeStyle = INK
        ctx.beginPath()
        ctx.arc(x, y, 34, 0, Math.PI * 2)
        ctx.stroke()
      })
      break
    }
    case 'noodles': {
      // 나란한 젓가락 두 짝에 걸려 아래로 늘어진 면발 다섯 가닥
      const stickY = y0 + h * 0.14
      const tilt = h * 0.06
      const nx0 = x0 + w * 0.26
      ctx.lineCap = 'round'
      ctx.lineWidth = 62
      for (let k = 0; k < 5; k++) {
        const x = nx0 + k * 92
        const top = stickY + 40 + (tilt * (x - x0)) / w
        ctx.beginPath()
        ctx.moveTo(x, top)
        for (let y = top; y <= y0 + h * 0.62; y += 8) ctx.lineTo(x + Math.sin((y - top) / 44 + k * 0.9) * 24, y)
        ctx.stroke()
      }
      ctx.strokeStyle = INK
      ctx.lineWidth = 40
      for (const dy of [0, 64]) {
        ctx.beginPath()
        ctx.moveTo(x0 + w * 0.1, stickY + dy)
        ctx.lineTo(x1 - w * 0.08, stickY + dy + tilt)
        ctx.stroke()
      }
      break
    }
    case 'bowl': {
      // 그릇(반원 + 굽) 위로 김 세 줄
      const cx = x0 + w / 2
      const rimY = y0 + h * 0.4
      const R = w * 0.32
      ctx.beginPath()
      ctx.moveTo(cx - R, rimY)
      ctx.arc(cx, rimY, R, 0, Math.PI, false)
      ctx.closePath()
      ctx.fill()
      roundRect(ctx, cx - R - 30, rimY - 44, 2 * R + 60, 70, 35)
      ctx.fill()
      roundRect(ctx, cx - R * 0.35, rimY + R - 20, R * 0.7, 70, 30)
      ctx.fill()
      ctx.lineCap = 'round'
      ctx.lineWidth = 46
      for (let k = -1; k <= 1; k++) {
        const sx = cx + k * 150
        ctx.beginPath()
        ctx.moveTo(sx, rimY - 90)
        ctx.bezierCurveTo(sx - 70, rimY - 170, sx + 70, rimY - 250, sx, rimY - 330)
        ctx.stroke()
      }
      break
    }
    case 'pin': {
      // 오른쪽에 크게 기운 지도 핀 하나 + 가운데 구멍
      const cx = x0 + w * 0.6
      const cy = y0 + h * 0.3
      const R = w * 0.25
      const tipY = y0 + h * 0.7
      // 끝점에서 원에 접하는 두 점 — 아래 방향에서 acos(R/d)만큼 벌어진 곳
      const a = Math.acos(R / (tipY - cy))
      ctx.beginPath()
      ctx.moveTo(cx, tipY)
      ctx.arc(cx, cy, R, Math.PI / 2 + a, Math.PI / 2 - a, false)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#fff'
      circle(ctx, cx, cy, R * 0.38)
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
  drawShape(ctx, r, cardX + 22, cardY + 22, cardX + cardW - 22, cardY + cardH - 22)

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
  const dots = COLORS
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
