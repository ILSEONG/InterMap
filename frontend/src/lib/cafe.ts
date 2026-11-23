import type { Review } from '../data/model'

// 카페 화면 — 맨 위 "맛집 | 카페" 전환의 카페 쪽. 코드는 서버와 같다 (Cuisine.java의 cafeKind, ReviewTags.java).
// 순서가 곧 화면에 보이는 순서.

// 지도를 어느 쪽으로 보고 있는지: 맛집(전부) / 카페(카페·베이커리·디저트만)
export type PlaceMode = 'food' | 'cafe'

// 카페의 업종 코드 (lib/cuisine의 '카페·디저트')
export const CAFE_CUISINE = 'CAFE'

// 카페의 종류 — 서버가 가게마다 정해 준다. 맨 앞이 기본(정해지지 않은 카페)
export const CAFE_KINDS: [code: string, label: string][] = [
  ['COFFEE', '카페'],
  ['BAKERY', '베이커리'],
  ['DESSERT', '디저트'],
]

// 카페 후기에 고르는 꼬리표 — 이 카페의 어떤 점이 좋은지
export const CAFE_TAGS: [code: string, label: string][] = [
  ['WORK', '작업·공부'],
  ['TALK', '수다'],
  ['SWEETS', '디저트'],
  ['TASTE', '커피 맛'],
  ['MOOD', '분위기'],
]

export function isCafe(place: { cuisine?: string | null }): boolean {
  return place.cuisine === CAFE_CUISINE
}

// 하나를 켜거나 끈 뒤의 선택 — 화면 순서대로 정리한다 (모르는 코드는 버린다)
export function toggleCode(options: [string, string][], selected: string[], code: string): string[] {
  const next = selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]
  return options.map(([c]) => c).filter((c) => next.includes(c))
}

// 이 카페가 고른 종류에 드는지. 고른 게 없으면 전부 든다. 종류가 안 정해진 카페는 '카페'로 친다
export function matchesCafeKind(kind: string | null | undefined, selected: string[]): boolean {
  return selected.length === 0 || selected.includes(kind ?? CAFE_KINDS[0][0])
}

// 이웃 후기 가운데 고른 꼬리표가 하나라도 달린 게 있는지. 고른 게 없으면 전부 든다
export function matchesCafeTags(reviews: Pick<Review, 'tags'>[], selected: string[]): boolean {
  return selected.length === 0 || reviews.some((rv) => (rv.tags ?? []).some((t) => selected.includes(t)))
}

// 이웃 후기에 달린 꼬리표를 모아 센다 — 많이 고른 것부터, 같으면 화면 순서대로. 모르는 코드는 뺀다
export function countCafeTags(reviews: Pick<Review, 'tags'>[]): { code: string; label: string; count: number }[] {
  return CAFE_TAGS.map(([code, label]) => ({
    code,
    label,
    count: reviews.filter((rv) => (rv.tags ?? []).includes(code)).length,
  }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)
}
