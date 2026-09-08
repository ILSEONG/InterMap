import { createContext, useContext } from 'react'

// 프로필 개요 열기. 후기 카드·댓글처럼 시트 안쪽 깊이 박힌 곳에서 부르므로
// 시트마다 콜백을 손으로 내려주는 대신 컨텍스트로 한 번에 내린다.
export const OpenProfileContext = createContext<((userId: number) => void) | null>(null)

export function useOpenProfile() {
  return useContext(OpenProfileContext)
}
