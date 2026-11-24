import type { Review } from '../data/model'

// 모임 규모 — 후기에 "몇 명이 가기 좋은 곳인지"를 고르고, 필터의 "규모"에서 그 인원으로 거른다.
// 코드는 후기의 꼬리표(tags)에 같이 실린다 — 서버(ReviewTags.java)와 같다. 순서가 곧 화면에 보이는 순서.
// 맛집·카페 화면 모두 쓴다. 혼자 가는 곳만 부르는 말이 다르다 (맛집은 "혼밥", 카페는 "혼자")
const SIZES: [code: string, food: string, cafe: string][] = [
  ['SOLO', '혼밥', '혼자'],
  ['SMALL', '2~5인', '2~5인'],
  ['LARGE', '6인 이상', '6인 이상'],
]

export function partySizes(cafe: boolean): [code: string, label: string][] {
  return SIZES.map(([code, food, cafeLabel]) => [code, cafe ? cafeLabel : food])
}

// 꼬리표 가운데 규모 코드만, 화면 순서대로
export function partyOf(tags: string[] | undefined): string[] {
  return SIZES.map(([code]) => code).filter((code) => (tags ?? []).includes(code))
}

// 이웃 후기 가운데 고른 규모가 하나라도 적힌 게 있는지. 고른 게 없으면 전부 든다
export function matchesParty(reviews: Pick<Review, 'tags'>[], selected: string[]): boolean {
  return selected.length === 0 || reviews.some((rv) => (rv.tags ?? []).some((t) => selected.includes(t)))
}
