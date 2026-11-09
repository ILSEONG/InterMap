// 팔로잉 현황판을 마지막으로 연 때 — 그 뒤에 올라온 후기를 "새 후기"로 센다
const SEEN_KEY = 'intermap.boardSeen'

// 한 번도 안 열었으면 기준이 없으니 하루 안에 올라온 후기를 새 후기로 본다
export function readBoardSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || Date.now() - 24 * 3_600_000
  } catch {
    return Date.now() - 24 * 3_600_000
  }
}

export function markBoardSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()))
  } catch {
    // 저장 못 해도 다음에 하루치를 새 후기로 보일 뿐
  }
}
