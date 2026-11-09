import { useEffect, useState } from 'react'

// 값이 delay 동안 그대로일 때만 바뀌는 사본 — 검색어로 서버를 부를 때 쓴다.
// 한글 입력은 조합 중 값(ㅁ → 마 → 망 …)이 계속 바뀌어 글자마다 요청이 나가므로, 손을 멈췄을 때 한 번만.
export function useDebounced<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return settled
}
