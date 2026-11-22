// 업종 필터 — 코드는 서버(Cuisine.java, resources/cuisine/rules.json)와 같다. 순서가 곧 화면에 보이는 순서.
// 가게의 업종은 서버가 정해 준다 (이름 낱말 · 상가(상권)정보 소분류 · 인허가 업종). 정해지지 않은 가게도 있다 —
// 그런 가게는 업종을 고르지 않았을 때만 보인다.
export const CUISINES: [code: string, label: string][] = [
  ['KOREAN', '한식'],
  ['MEAT', '고기'],
  ['SOUP', '국·탕'],
  ['NOODLE', '면'],
  ['SEAFOOD', '회·해산물'],
  ['CHINESE', '중식'],
  ['JAPANESE', '일식'],
  ['WESTERN', '양식'],
  ['ASIAN', '아시안'],
  ['SNACK', '분식'],
  ['CHICKEN', '치킨'],
  ['PIZZA_BURGER', '피자·버거'],
  ['CAFE', '카페·디저트'],
  ['BAR', '술집'],
]

const LABELS = new Map(CUISINES)

// 고른 업종을 화면 순서대로 정리한다 (모르는 코드는 버린다)
function ordered(selected: string[]): string[] {
  return CUISINES.map(([code]) => code).filter((code) => selected.includes(code))
}

// 하나를 켜거나 끈 뒤의 선택
export function toggleCuisine(selected: string[], code: string): string[] {
  return ordered(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code])
}

// 칩에 쓸 글 — 안 골랐으면 "업종", 하나면 그 이름, 여럿이면 "한식 외 2"
export function cuisineChipLabel(selected: string[]): string {
  const picked = ordered(selected)
  if (picked.length === 0) return '업종'
  const first = LABELS.get(picked[0])!
  return picked.length === 1 ? first : `${first} 외 ${picked.length - 1}`
}

// 이 가게가 고른 업종에 드는지. 고른 게 없으면 전부 든다
export function matchesCuisine(cuisine: string | null | undefined, selected: string[]): boolean {
  return selected.length === 0 || (cuisine != null && selected.includes(cuisine))
}
