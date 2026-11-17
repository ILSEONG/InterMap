import { useSyncExternalStore } from 'react'

// 서버에 닿는지 — api.ts의 모든 요청이 결과를 알려 준다 (reportReach).
// 닿지 않으면 화면이 예전 내용인 채로 조용히 멈춰 보였다. 잠깐 끊긴 것(다시 시도에서 바로 되는 것)에는
// 알림을 띄우지 않으려고, 실패하고 2.5초 안에 성공이 없을 때만 "연결 안 됨"으로 본다.
const DELAY = 2500

let failed = false
let offline = typeof navigator !== 'undefined' && navigator.onLine === false
let shown = false
let timer: number | undefined
const listeners = new Set<() => void>()

function update() {
  const bad = failed || offline
  if (!bad) {
    window.clearTimeout(timer)
    timer = undefined
    if (shown) {
      shown = false
      listeners.forEach((l) => l())
    }
    return
  }
  if (shown || timer !== undefined) return
  timer = window.setTimeout(() => {
    timer = undefined
    shown = true
    listeners.forEach((l) => l())
  }, DELAY)
}

// ok: 서버가 응답했다 (4xx·500도 "닿은" 것). false: 네트워크 오류이거나 서버 앞단이 대신 답한 502~504
export function reportReach(ok: boolean) {
  failed = !ok
  // 요청이 성공했으면 인터넷도 되는 것 — 기기가 알려 주는 상태가 늦을 때가 있다
  if (ok) offline = false
  update()
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    offline = true
    update()
  })
  window.addEventListener('online', () => {
    offline = false
    update()
  })
  update()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// 서버에 연결하지 못하고 있으면 true
export function useUnreachable(): boolean {
  return useSyncExternalStore(subscribe, () => shown)
}
