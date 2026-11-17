import { useEffect, useState } from 'react'

// 긴 목록을 한 번에 그리지 않는다. 처음엔 화면에 보일 만큼만 그리고 나머지는 다음 프레임들에 나눠 붙인다.
// 이웃 150명이나 후기 80개를 한 번에 그리면 느린 폰에서 화면이 0.3초쯤 멈춘다 — 여는 순간의 끊김을 없앤다.
// resetKey가 바뀌면(다른 가게, 다른 정렬) 처음부터 다시 센다. 돌려주는 값만큼만 slice해서 그리면 된다.
export function useProgressiveCount(total: number, resetKey: unknown, first = 10, step = 20): number {
  const [state, setState] = useState({ key: resetKey, count: first })
  // 키가 바뀐 렌더에서는 지난 목록의 개수를 쓰지 않는다 (effect를 기다리면 한 번은 전부 그려 버린다)
  const count = Math.min(total, Object.is(state.key, resetKey) ? state.count : first)

  useEffect(() => {
    if (count >= total) return
    const frame = requestAnimationFrame(() => setState({ key: resetKey, count: count + step }))
    return () => cancelAnimationFrame(frame)
  }, [count, total, resetKey, step])

  return count
}
