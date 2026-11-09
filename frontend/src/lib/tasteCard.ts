import type { TasteMatch } from './taste'
import { waGwa } from './taste'
import { kstMonth } from './time'

// 입맛 궁합 공유 카드 — 인스타 스토리 크기(1080×1920) PNG 한 장.
// 가게 이름과 각자 준 별점은 넣지 않는다 (분류별 평균만) — 상대의 기록이 앱 밖으로 나가지 않게.

export interface TasteTheme {
  id: string
  name: string
  bg: string
  fg: string
  accent: string
  line: string
}

export const TASTE_THEMES: TasteTheme[] = [
  { id: 'sand', name: '샌드', bg: '#efe9df', fg: '#22201c', accent: '#c8553d', line: 'rgba(34,32,28,0.12)' },
  { id: 'sage', name: '세이지', bg: '#2e3c34', fg: '#f3f0e8', accent: '#e8b49a', line: 'rgba(243,240,232,0.14)' },
  { id: 'ink', name: '잉크', bg: '#161b26', fg: '#eef1f6', accent: '#ff8a6b', line: 'rgba(238,241,246,0.12)' },
]

const FONT = '"Noto Sans KR", system-ui, sans-serif'
// 360×640 기준으로 그리고 3배로 키운다
const S = 3
const W = 360
const H = 640
const PAD = 28

export interface TasteCardInput {
  myName: string
  theirName: string
  match: TasteMatch
}

// 점수가 낮으면 "통해요" 대신 "만 통해요"
export const cardHeadline = (score: number) => (score >= 60 ? '통해요' : '만 통해요')

function subLine(m: TasteMatch): string {
  const top = m.genres[0]
  const n = m.common.length
  return top && m.title.startsWith(top.name) ? `${m.title} · 둘 다 가 본 ${n}곳 중 ${top.count}곳이 ${top.name}` : `${m.title} · 둘 다 가 본 곳 ${n}곳`
}

// 띄어쓰기 단위로 줄을 나눈다 (한국어 어절이 중간에 끊기지 않게)
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width > max && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function monthText(): string {
  const [y, m] = kstMonth().split('-')
  return `${y}년 ${Number(m)}월`
}

async function loadFonts(text: string) {
  if (!document.fonts?.load) return
  await Promise.all(['400', '500', '700'].map((w) => document.fonts.load(`${w} 40px ${FONT}`, text).catch(() => [])))
}

export async function drawTasteCard(input: TasteCardInput, themeId = TASTE_THEMES[0].id): Promise<Blob> {
  const t = TASTE_THEMES.find((x) => x.id === themeId) ?? TASTE_THEMES[0]
  const { match, myName, theirName } = input
  const note = match.insight ?? match.lead
  await loadFonts(
    `intermap 입맛 궁합 ${waGwa(myName)} ${theirName} 입맛이 ${match.score}% ${cardHeadline(match.score)} ${subLine(match)} 분류별 평균 별점 ${match.genres
      .map((g) => `${g.name} · ${g.count}곳`)
      .join(' ')} 12345 ${note} 인터맵에서 나도 궁합 보기 ${monthText()}`,
  )

  const canvas = document.createElement('canvas')
  canvas.width = W * S
  canvas.height = H * S
  const ctx = canvas.getContext('2d')!
  ctx.scale(S, S)
  ctx.fillStyle = t.bg
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'alphabetic'

  const text = (s: string, x: number, y: number, size: number, weight: number, color: string, align: CanvasTextAlign = 'left', alpha = 1) => {
    ctx.globalAlpha = alpha
    ctx.font = `${weight} ${size}px ${FONT}`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(s, x, y)
    ctx.globalAlpha = 1
    return ctx.measureText(s).width
  }

  // 머리
  text('intermap', PAD, 44, 15, 700, t.fg)
  text('입맛 궁합', W - PAD, 44, 12, 500, t.fg, 'right', 0.55)

  // 제목: "준호와 민지" / "입맛이 82%" / "통해요"
  text(`${waGwa(myName)} ${theirName}`, PAD, 112, 14, 500, t.fg, 'left', 0.6)
  const w1 = text('입맛이 ', PAD, 156, 30, 700, t.fg)
  text(`${match.score}%`, PAD + w1, 156, 30, 700, t.accent)
  text(cardHeadline(match.score), PAD, 194, 30, 700, t.fg)
  ctx.font = `500 15px ${FONT}`
  const sub = wrap(ctx, subLine(match), W - PAD * 2)
  sub.forEach((line, i) => text(line, PAD, 230 + i * 22, 15, 500, t.fg, 'left', 0.8))

  // 분류별 평균 별점 — 점 두 개를 선으로 잇는다 (가까울수록 입맛이 비슷)
  const top = 300
  const legendY = top
  const dot = (x: number, y: number, color: string, r = 5.5) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  dot(PAD + 4, legendY - 4, t.fg, 4)
  const lw = text(myName, PAD + 12, legendY, 11.5, 500, t.fg, 'left', 0.8)
  dot(PAD + 26 + lw, legendY - 4, t.accent, 4)
  text(theirName, PAD + 34 + lw, legendY, 11.5, 500, t.fg, 'left', 0.8)
  text('분류별 평균 별점', W - PAD, legendY, 11.5, 500, t.fg, 'right', 0.8)

  const labelW = 84
  const x0 = PAD + labelW
  const x1 = W - PAD - 8
  const xOf = (v: number) => x0 + ((v - 1) / 4) * (x1 - x0)
  const rowH = 46
  let y = legendY + 14
  ctx.fillStyle = t.line
  for (const g of match.genres) {
    ctx.fillStyle = t.line
    ctx.fillRect(PAD, y, W - PAD * 2, 1)
    const cy = y + rowH / 2
    text(`${g.name} · ${g.count}곳`, PAD, cy + 4.5, 12.5, 500, t.fg, 'left', 0.72)
    const a = xOf(g.mine)
    const b = xOf(g.theirs)
    ctx.globalAlpha = 0.35
    ctx.fillStyle = t.fg
    ctx.fillRect(Math.min(a, b), cy - 1, Math.abs(a - b), 2)
    ctx.globalAlpha = 1
    if (g.mine === g.theirs) {
      // 같으면 반반 점
      ctx.save()
      ctx.beginPath()
      ctx.arc(a, cy, 5.5, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = t.fg
      ctx.fillRect(a - 6, cy - 6, 6, 12)
      ctx.fillStyle = t.accent
      ctx.fillRect(a, cy - 6, 6, 12)
      ctx.restore()
    } else {
      dot(a, cy, t.fg)
      dot(b, cy, t.accent)
    }
    y += rowH
  }
  ctx.fillStyle = t.line
  ctx.fillRect(PAD, y, W - PAD * 2, 1)
  for (let v = 1; v <= 5; v++) text(String(v), xOf(v), y + 16, 10.5, 400, t.fg, 'center', 0.45)

  // 그래프에서 읽히는 한 줄
  ctx.font = `500 12.5px ${FONT}`
  wrap(ctx, note, W - PAD * 2).forEach((line, i) => text(line, PAD, y + 46 + i * 19, 12.5, 500, t.fg, 'left', 0.72))

  // 바닥
  text('인터맵에서 나도 궁합 보기', PAD, H - 26, 11, 500, t.fg, 'left', 0.5)
  text(monthText(), W - PAD, H - 26, 11, 500, t.fg, 'right', 0.5)

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('카드를 만들지 못했어요.'))), 'image/png'),
  )
}
