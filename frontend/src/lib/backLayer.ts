import { useEffect, useRef } from 'react'

// 컴포넌트 안에만 있는 작은 레이어(사진 크게 보기, 펼친 메뉴 등)를 안드로이드 뒤로가기가 먼저 닫게 한다.
// App의 뒤로가기 처리는 큰 화면들을 위에서부터 닫는데, 이런 레이어는 App이 모르는 상태라 그 아래 시트가 먼저 닫혔다.
// 열린 순서대로 쌓고, 뒤로가기는 가장 나중에 연 것부터 닫는다.
const stack: { close: () => void }[] = []

// 맨 위 레이어를 닫았으면 true
export function closeTopLayer(): boolean {
  const top = stack.at(-1)
  if (!top) return false
  top.close()
  return true
}

export function useBackLayer(active: boolean, close: () => void) {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!active) return
    const entry = { close: () => closeRef.current() }
    stack.push(entry)
    return () => {
      const i = stack.indexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
