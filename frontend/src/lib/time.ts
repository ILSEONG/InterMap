// ISO 시각을 "방금 전 / N분 전 / N시간 전 / N일 전"으로
export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}시간 전`
  return `${Math.floor(hours / 24)}일 전`
}

// 후기가 올라온 때 — 하루가 안 지났으면 "N시간 전"까지, 그 뒤로는 날짜 "2026-11-03" (한국 시간).
// "N일 전"은 며칠인지 다시 세어야 해서 후기에는 날짜를 그대로 보여 준다
const KST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
export function reviewDate(iso: string, now = Date.now()): string {
  const at = Date.parse(iso)
  if (now - at < 24 * 60 * 60_000) return timeAgo(iso, now)
  return KST_DATE.format(new Date(at)).slice(0, 10)
}

// 한국 시간 기준 "2026-11" (월간 결산의 달 단위)
const KST_MONTH = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' })
export function kstMonth(date: Date | string | number = new Date()): string {
  return KST_MONTH.format(new Date(date)).slice(0, 7)
}

// "2026-11" → 그 앞 달 "2026-10"
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

// "2026-11" → "11월" (해가 다르면 "2025년 11월")
export function monthLabel(month: string, now = kstMonth()): string {
  const [y, m] = month.split('-').map(Number)
  return month.slice(0, 4) === now.slice(0, 4) ? `${m}월` : `${y}년 ${m}월`
}

// 마감까지 남은 시간 — "2시간 남음", "마감됐어요"
export function timeLeft(iso: string, now = Date.now()): string {
  const min = Math.floor((Date.parse(iso) - now) / 60_000)
  if (min <= 0) return '마감됐어요'
  if (min < 60) return `${min}분 남음`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}시간 남음`
  return `${Math.floor(hours / 24)}일 남음`
}
