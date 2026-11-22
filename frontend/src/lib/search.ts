// 가게 검색어 다루기 — 서버(RestaurantSearch.java)와 같은 규칙.
// 검색어를 띄어쓰기로 나눈 낱말마다 이름·업종·주소 어딘가에 들어 있으면 걸린다 ("타마 여의도" → 여의도에 있는 타마).

// 이보다 뒤의 낱말은 보지 않는다 (서버 MAX_WORDS와 같은 값)
const MAX_WORDS = 4

// 검색어 → 낱말들 (소문자)
export function searchWords(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS)
}

// 낱말이 전부 글 안에 들어 있는지 (순서 무관, 대소문자 무시)
export function matchesWords(text: string, words: string[]): boolean {
  const hay = text.toLowerCase()
  return words.every((word) => hay.includes(word))
}

// 글에서 칠할 구간 [시작, 끝) — 검색어가 통째로 있으면 그 한 곳, 없으면 낱말마다 처음 나오는 곳. 겹치면 합친다
export function highlightSpans(text: string, query: string): [number, number][] {
  const whole = query.trim().toLowerCase()
  if (!whole) return []
  const hay = text.toLowerCase()
  const needles = hay.includes(whole) ? [whole] : searchWords(whole)
  const found: [number, number][] = []
  for (const needle of needles) {
    const at = hay.indexOf(needle)
    if (at >= 0) found.push([at, at + needle.length])
  }
  found.sort((a, b) => a[0] - b[0])
  const spans: [number, number][] = []
  for (const [start, end] of found) {
    const last = spans[spans.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else spans.push([start, end])
  }
  return spans
}
