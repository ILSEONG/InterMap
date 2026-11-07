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

// 색 — 따뜻한 아이보리 바탕에 먹색 글자, 포인트는 톤 다운한 로즈 한 가지만
const INK = '#2b2626'
const SOFT = '#8c8380'
const FAINT = 'rgba(43, 38, 38, 0.08)'
const ROSE = '#c25a6e'
const ROSE_TINT = '#f6e1e4'

// 카드에 들어가는 글자 — 폰트 하위 집합을 미리 받아 두려고 모은다
function cardText(r: Recap): string {
  return [
    'INTERMAP MONTHLY 월간 결산 이달의 칭호 친구가 고른 맛집 지도, 인터맵 다녀왔어요 곳 의 나 년 월 ★·.0123456789',
    personaOf(r),
    ...rowsOf(r).flatMap((row) => [row.label, row.value, row.sub ?? '']),
  ].join('')
}

async function loadFonts(text: string) {
  if (!document.fonts?.load) return
  await Promise.all(['300', '400', '500', '700'].map((w) => document.fonts.load(`${w} 64px ${FONT}`, text).catch(() => [])))
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

// 아주 옅은 빛 번짐 — 바탕에 파스텔 기운만
function bloom(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, alpha: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(${rgb}, ${alpha})`)
  g.addColorStop(0.55, `rgba(${rgb}, ${alpha * 0.45})`)
  g.addColorStop(1, `rgba(${rgb}, 0)`)
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

// 목록 한 줄 — 왼쪽 이름표, 오른쪽 값(진하게) + 덧말(흐리게)
function drawRow(ctx: CanvasRenderingContext2D, row: Row, x: number, w: number, baseline: number) {
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = SOFT
  ctx.font = `400 34px ${FONT}`
  ctx.fillText(row.label, x, baseline)
  const labelW = ctx.measureText(row.label).width

  const room = w - labelW - 48
  const sub = row.sub ? `  ${row.sub}` : ''
  ctx.font = `400 34px ${FONT}`
  let subW = sub ? ctx.measureText(sub).width : 0
  if (subW > room * 0.45) subW = 0
  const starW = row.star ? 44 : 0
  const value = fitText(ctx, row.value, 700, 46, 32, room - subW - starW)
  const valueFont = ctx.font
  const valueW = ctx.measureText(value).width
  let cursor = x + w - subW - valueW - starW
  if (row.star) {
    ctx.fillStyle = ROSE
    ctx.font = `400 36px ${FONT}`
    ctx.fillText('★', cursor, baseline - 2)
    cursor += starW
  }
  ctx.fillStyle = INK
  ctx.font = valueFont
  ctx.fillText(value, cursor, baseline)
  if (subW) {
    ctx.fillStyle = SOFT
    ctx.font = `400 34px ${FONT}`
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

  // 바탕 — 따뜻한 아이보리 위에 복숭아·장미·라벤더 기운을 옅게
  ctx.fillStyle = '#f8f4ef'
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  bloom(ctx, 980, 120, 760, '251, 214, 196', 0.85)
  bloom(ctx, 60, 860, 700, '244, 214, 222', 0.7)
  bloom(ctx, 1040, 1480, 680, '226, 222, 243', 0.75)
  bloom(ctx, 160, 1900, 520, '250, 228, 210', 0.6)

  // 머리 — 작은 글자 두 개를 양 끝에, 그 아래 머리카락 선
  const [year, monthNum] = r.month.split('-')
  ctx.fillStyle = INK
  ctx.font = `700 28px ${FONT}`
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px'
  ctx.fillText('INTERMAP', PAD, 168)
  ctx.fillStyle = SOFT
  ctx.font = `400 28px ${FONT}`
  const tag = `MONTHLY  ${year}.${monthNum}`
  ctx.fillText(tag, CARD_WIDTH - PAD - ctx.measureText(tag).width, 168)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  ctx.fillStyle = FAINT
  ctx.fillRect(PAD, 206, inner, 2)

  // "10월의 나" + 칭호
  ctx.fillStyle = SOFT
  ctx.font = `400 50px ${FONT}`
  ctx.fillText(`${Number(monthNum)}월의 나`, PAD, 370)

  ctx.font = `700 28px ${FONT}`
  const badge = '이달의 칭호'
  const badgeW = ctx.measureText(badge).width + 44
  roundRect(ctx, PAD, 418, badgeW, 54, 27)
  ctx.fillStyle = ROSE_TINT
  ctx.fill()
  ctx.fillStyle = ROSE
  ctx.fillText(badge, PAD + 22, 455)

  ctx.fillStyle = INK
  if ('letterSpacing' in ctx) ctx.letterSpacing = '-3px'
  const persona = fitText(ctx, personaOf(r), 700, 112, 64, inner)
  ctx.fillText(persona, PAD - 4, 600)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'

  // 큰 숫자 — 가는 글씨로 크게, 옆에 "곳 다녀왔어요"
  const num = String(r.places)
  ctx.fillStyle = INK
  if ('letterSpacing' in ctx) ctx.letterSpacing = '-10px'
  ctx.font = `300 300px ${FONT}`
  ctx.fillText(num, PAD - 14, 930)
  const numW = ctx.measureText(num).width
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  ctx.font = `500 52px ${FONT}`
  ctx.fillText(r.places > 0 ? '곳' : '', PAD + numW + 8, 860)
  ctx.fillStyle = SOFT
  ctx.font = `400 44px ${FONT}`
  ctx.fillText(r.places > 0 ? '다녀왔어요' : '아직 다녀온 곳이 없어요', PAD + numW + 8, 926)

  // 목록 카드 — 반투명 흰 카드에 머리카락 선으로 줄을 나눈다
  const rows = rowsOf(r)
  const rowH = 132
  const cardPad = 26
  const cardY = 1040
  const cardH = rows.length * rowH + cardPad * 2
  ctx.save()
  ctx.shadowColor = 'rgba(90, 60, 50, 0.08)'
  ctx.shadowBlur = 60
  ctx.shadowOffsetY = 18
  roundRect(ctx, PAD, cardY, inner, cardH, 44)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)'
  ctx.fill()
  ctx.restore()
  roundRect(ctx, PAD, cardY, inner, cardH, 44)
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.stroke()
  rows.forEach((row, i) => {
    const top = cardY + cardPad + i * rowH
    if (i > 0) {
      ctx.fillStyle = FAINT
      ctx.fillRect(PAD + 52, top, inner - 104, 2)
    }
    drawRow(ctx, row, PAD + 52, inner - 104, top + rowH / 2 + 14)
  })

  // 꼬리 — 로즈 점 하나 + 한 줄
  ctx.font = `400 30px ${FONT}`
  const foot = '친구가 고른 맛집 지도, 인터맵'
  const footW = ctx.measureText(foot).width
  const footX = (CARD_WIDTH - footW) / 2 + 14
  ctx.fillStyle = ROSE
  ctx.beginPath()
  ctx.arc(footX - 26, 1815, 7, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = SOFT
  ctx.fillText(foot, footX, 1826)

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
