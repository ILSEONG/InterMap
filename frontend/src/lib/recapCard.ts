import type { Recap } from './api'
import { monthLabel } from './time'

// 월간 결산 카드 — 인스타 스토리 비율(1080×1920) 이미지를 캔버스로 직접 그린다.
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

interface Tile {
  label: string
  value: string
  sub?: string
}

// 카드 칸 네 개 + 맨 아래 한 칸. 없는 값은 다른 숫자로 채운다
export function tilesOf(r: Recap): { grid: Tile[]; wide: Tile | null } {
  const grid: Tile[] = [
    r.topCategory
      ? { label: '최애 장르', value: r.topCategory.name, sub: `${r.topCategory.count}곳` }
      : { label: '최애 장르', value: '골고루', sub: '가리지 않아요' },
    r.topArea
      ? { label: '제일 많이 간 동네', value: r.topArea.name, sub: `${r.topArea.count}곳` }
      : { label: '제일 많이 간 동네', value: '여기저기', sub: '' },
    { label: '평균 별점', value: r.avgRating === null ? '-' : `★ ${r.avgRating.toFixed(1)}`, sub: ratingWord(r.avgRating) },
    r.topFan
      ? { label: '내 후기 단골 손님', value: r.topFan.name, sub: `댓글 ${r.topFan.count}개` }
      : r.photos > 0
        ? { label: '남긴 사진', value: `${r.photos}장`, sub: '' }
        : { label: '새 이웃', value: `${r.newFollowing}명`, sub: '' },
  ]
  const wide = r.best ? { label: '이달의 한 곳', value: r.best.name, sub: `★ ${r.best.rating.toFixed(1)}` } : null
  return { grid, wide }
}

function ratingWord(avg: number | null): string {
  if (avg === null) return ''
  if (avg >= 4.5) return '후한 편이에요'
  if (avg >= 3.8) return '대체로 만족'
  if (avg >= 3) return '꼼꼼하게 매겨요'
  return '깐깐해요'
}

// 카드에 들어가는 글자 — 폰트 하위 집합을 미리 받아 두려고 모은다
function cardText(r: Recap): string {
  const { grid, wide } = tilesOf(r)
  return [
    'INTERMAP 월간 결산 인터맵 친구가 고른 진짜 맛집 지도 다녀왔어요 곳 의 나 년 월 0123456789',
    personaOf(r),
    monthLabel(r.month, ''),
    ...grid.flatMap((t) => [t.label, t.value, t.sub ?? '']),
    wide ? `${wide.label}${wide.value}${wide.sub}` : '',
  ].join('')
}

async function loadFonts(text: string) {
  if (!document.fonts?.load) return
  await Promise.all(
    ['500', '700', '900'].map((w) => document.fonts.load(`${w} 64px ${FONT}`, text).catch(() => [])),
  )
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

// 폭에 맞을 때까지 글자를 줄이고, 최소 크기에서도 넘치면 말줄임
function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, min: number, width: number): string {
  let size = max
  for (; size > min; size -= 4) {
    ctx.font = `${weight} ${size}px ${FONT}`
    if (ctx.measureText(text).width <= width) return text
  }
  ctx.font = `${weight} ${min}px ${FONT}`
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1)
  return cut === text ? text : `${cut}…`
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

// wide: 맨 아래 한 칸 — 가게 이름 왼쪽, 별점은 오른쪽 끝에 크게
function drawTile(ctx: CanvasRenderingContext2D, tile: Tile, x: number, y: number, w: number, h: number, wide = false) {
  roundRect(ctx, x, y, w, h, 48)
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.32)'
  ctx.stroke()

  let inner = w - 76
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  ctx.font = `500 34px ${FONT}`
  ctx.fillText(fitText(ctx, tile.label, 500, 34, 26, inner), x + 38, y + 70)
  if (wide && tile.sub) {
    ctx.fillStyle = '#fff'
    ctx.font = `900 64px ${FONT}`
    const subW = ctx.measureText(tile.sub).width
    ctx.fillText(tile.sub, x + w - 38 - subW, y + 150)
    inner -= subW + 32
  }
  ctx.fillStyle = '#fff'
  const value = fitText(ctx, tile.value, 900, 64, 40, inner)
  ctx.fillText(value, x + 38, y + 150)
  if (tile.sub && !wide) {
    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    ctx.font = `700 32px ${FONT}`
    ctx.fillText(fitText(ctx, tile.sub, 700, 32, 24, inner), x + 38, y + h - 40)
  }
}

export async function drawRecapCard(r: Recap): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = CARD_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('이 기기에서는 카드를 그릴 수 없어요.')
  await loadFonts(cardText(r))

  // 바탕 — 코랄에서 로즈, 깊은 자두색으로
  const bg = ctx.createLinearGradient(0, 0, CARD_WIDTH * 0.35, CARD_HEIGHT)
  bg.addColorStop(0, '#ff8a5c')
  bg.addColorStop(0.45, '#d9365a')
  bg.addColorStop(1, '#5a1745')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
  glow(ctx, 920, 260, 520, 'rgba(255,236,210,0.45)')
  glow(ctx, 80, 1500, 620, 'rgba(255,160,190,0.28)')
  glow(ctx, 1000, 1900, 420, 'rgba(255,120,90,0.25)')
  ctx.textBaseline = 'alphabetic'

  // 머리 — 작은 알약 + "11월의 나"
  ctx.font = `700 32px ${FONT}`
  const pill = 'INTERMAP · 월간 결산'
  const pillW = ctx.measureText(pill).width + 64
  roundRect(ctx, PAD, 120, pillW, 68, 34)
  ctx.fillStyle = 'rgba(255,255,255,0.2)'
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.fillText(pill, PAD + 32, 166)

  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = `700 64px ${FONT}`
  ctx.fillText(`${monthLabel(r.month, '')}의 나`, PAD, 320)

  // 칭호
  ctx.fillStyle = '#fff'
  const persona = fitText(ctx, personaOf(r), 900, 124, 72, CARD_WIDTH - PAD * 2)
  ctx.fillText(persona, PAD, 470)

  // 큰 숫자 — "9곳 다녀왔어요"
  ctx.font = `900 300px ${FONT}`
  const num = String(r.places)
  ctx.fillText(num, PAD - 8, 820)
  const numW = ctx.measureText(num).width
  ctx.font = `900 120px ${FONT}`
  ctx.fillText('곳', PAD + numW + 6, 820)
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.font = `700 60px ${FONT}`
  ctx.fillText(r.places > 0 ? '다녀왔어요' : '아직 다녀온 곳이 없어요', PAD, 920)

  // 숫자 칸
  const { grid, wide } = tilesOf(r)
  const gap = 30
  const tileW = (CARD_WIDTH - PAD * 2 - gap) / 2
  const tileH = 240
  const top = 1010
  grid.forEach((tile, i) => {
    drawTile(ctx, tile, PAD + (i % 2) * (tileW + gap), top + Math.floor(i / 2) * (tileH + gap), tileW, tileH)
  })
  if (wide) drawTile(ctx, wide, PAD, top + 2 * (tileH + gap), CARD_WIDTH - PAD * 2, 200, true)

  // 꼬리
  ctx.fillStyle = 'rgba(255,255,255,0.78)'
  ctx.font = `500 34px ${FONT}`
  const foot = '친구가 고른 진짜 맛집 지도 · 인터맵'
  ctx.fillText(foot, (CARD_WIDTH - ctx.measureText(foot).width) / 2, 1830)

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('카드를 만들지 못했어요.'))), 'image/png'),
  )
}

// 화면 낭독기용 — 카드 이미지에 담긴 내용을 글로
export function recapAltText(r: Recap): string {
  const { grid, wide } = tilesOf(r)
  return [
    `${monthLabel(r.month, '')}의 나, ${personaOf(r)}. ${r.places}곳 다녀왔어요.`,
    ...grid.map((t) => `${t.label} ${t.value}${t.sub ? ` ${t.sub}` : ''}.`),
    wide ? `${wide.label} ${wide.value} ${wide.sub}.` : '',
  ].join(' ')
}
