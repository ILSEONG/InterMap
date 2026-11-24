// 팔로잉 현황판을 마지막으로 연 때 — 그 뒤에 올라온 후기를 "새 후기"로 센다
// 맛집 화면의 현황판과 카페 화면의 현황판은 따로 센다 (카페 현황판만 열었다고 맛집 새 후기가 본 것이 되지 않게)
const keyOf = (cafe: boolean) => (cafe ? 'intermap.boardSeen.cafe' : 'intermap.boardSeen')

// 한 번도 안 열었으면 기준이 없으니 하루 안에 올라온 후기를 새 후기로 본다
export function readBoardSeen(cafe = false): number {
  try {
    return Number(localStorage.getItem(keyOf(cafe))) || Date.now() - 24 * 3_600_000
  } catch {
    return Date.now() - 24 * 3_600_000
  }
}

export function markBoardSeen(cafe = false) {
  try {
    localStorage.setItem(keyOf(cafe), String(Date.now()))
  } catch {
    // 저장 못 해도 다음에 하루치를 새 후기로 보일 뿐
  }
}
