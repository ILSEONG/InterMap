// 프로필 화면 쌓기. 맨 위가 보이는 화면이고, list는 그 사람의 팔로잉·팔로워 목록을 펼쳤는지.
// 목록에서 다른 사람을 누르면 위에 쌓이고, 뒤로가기는 한 단계씩 되돌린다.
export type ProfileList = 'following' | 'followers'
export interface ProfileStep {
  userId: number
  list: ProfileList | null
}

// 같은 사람을 다시 열면(예: TOP 5 제목) 쌓지 않는다
export function pushProfile(stack: ProfileStep[], userId: number): ProfileStep[] {
  return stack.at(-1)?.userId === userId ? stack : [...stack, { userId, list: null }]
}

export function setTopList(stack: ProfileStep[], list: ProfileList | null): ProfileStep[] {
  return stack.length ? [...stack.slice(0, -1), { ...stack[stack.length - 1], list }] : stack
}

// 펼친 목록 → 개요 → 이전 사람 → 닫힘(빈 스택)
export function backProfile(stack: ProfileStep[]): ProfileStep[] {
  return stack.at(-1)?.list ? setTopList(stack, null) : stack.slice(0, -1)
}
