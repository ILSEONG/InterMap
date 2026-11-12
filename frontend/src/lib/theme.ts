// 포인트 색 바꾸기 (마이페이지 → 포인트 색). 고른 색은 이 기기에만 남기고(localStorage),
// CSS 변수(--accent 계열)를 문서 루트에 덮어써 앱 전체에 바로 입힌다. 기본 색이면 덮어쓴 것을 걷어 index.css 값으로 돌아간다.
const KEY = 'intermap.accent'
export const DEFAULT_ACCENT = '#d9365a'

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: '로즈', hex: DEFAULT_ACCENT },
  { name: '코랄', hex: '#e8603c' },
  { name: '오렌지', hex: '#e07a10' },
  { name: '올리브', hex: '#7a8a1f' },
  { name: '그린', hex: '#1f9d55' },
  { name: '민트', hex: '#12a594' },
  { name: '스카이', hex: '#1c8fd6' },
  { name: '블루', hex: '#2f6bf0' },
  { name: '인디고', hex: '#5456d6' },
  { name: '퍼플', hex: '#8b45d6' },
  { name: '핑크', hex: '#d63f9b' },
  { name: '잉크', hex: '#2a2a30' },
]

type Rgb = [number, number, number]

export const isHex = (value: string) => /^#[0-9a-f]{6}$/i.test(value)

export function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
}

// h: 0~360, s·v: 0~1
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return rgbToHex([f(5) * 255, f(3) * 255, f(1) * 255])
}

export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h = (h * 60 + 360) % 360
  }
  return [h, max === 0 ? 0 : d / max, max]
}

// WCAG 상대 휘도·명암비
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

// 색을 target 쪽으로 조금씩 섞어 against와의 명암비가 min 이상이 되는 첫 색
function toward(color: Rgb, target: Rgb, against: Rgb, min: number): Rgb {
  for (let t = 0; t <= 1; t += 0.04) {
    const c = mix(color, target, t)
    if (contrast(c, against) >= min) return c
  }
  return target
}

const WHITE: Rgb = [255, 255, 255]
const INK: Rgb = [28, 28, 30]
const STORY_BG: Rgb = [20, 20, 22]

export function readAccent(): string {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && isHex(saved)) return saved.toLowerCase()
  } catch {
    // 저장소를 못 쓰면 기본 색
  }
  return DEFAULT_ACCENT
}

export function saveAccent(hex: string) {
  try {
    if (hex.toLowerCase() === DEFAULT_ACCENT) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, hex.toLowerCase())
  } catch {
    // 저장 못 해도 이번에 켠 동안은 적용된다
  }
}

const VARS = ['--accent', '--accent-ink', '--accent-tint', '--on-accent', '--accent-on-dark', '--accent-pin']

// 고른 색 하나에서 나머지를 만든다:
//   --accent-ink     흰 면·연한 틴트 위 글자 (어두운 쪽으로 당겨 읽히게)
//   --accent-tint    연한 바탕
//   --on-accent      포인트 색 면 위의 글자·체크 (밝은 색을 고르면 흰 글자가 안 보이므로 검정으로)
//   --accent-on-dark 스토리의 어두운 판 위 (밝은 쪽으로 당겨 읽히게)
//   --accent-pin     지도 별점 핀
export function applyAccent(hex: string) {
  const root = document.documentElement
  if (!isHex(hex) || hex.toLowerCase() === DEFAULT_ACCENT) {
    for (const name of VARS) root.style.removeProperty(name)
    delete root.dataset.accentLight
    return
  }
  const rgb = hexToRgb(hex)
  const light = contrast(rgb, WHITE) < 3
  root.style.setProperty('--accent', hex)
  root.style.setProperty('--accent-ink', rgbToHex(toward(rgb, [0, 0, 0], WHITE, 5.5)))
  root.style.setProperty('--accent-tint', `rgba(${rgb.join(', ')}, 0.13)`)
  root.style.setProperty('--on-accent', light ? rgbToHex(INK) : '#ffffff')
  root.style.setProperty('--accent-on-dark', rgbToHex(toward(rgb, WHITE, STORY_BG, 5)))
  root.style.setProperty('--accent-pin', hex)
  // 데이터 URI로 그린 흰 체크처럼 변수로 못 바꾸는 곳을 CSS가 이 표시를 보고 바꾼다
  if (light) root.dataset.accentLight = 'true'
  else delete root.dataset.accentLight
}
