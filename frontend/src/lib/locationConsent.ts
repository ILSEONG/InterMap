import { useSyncExternalStore } from 'react'

// 위치기반서비스 이용약관 버전 = 시행일. 약관 내용을 바꾸면 올린다 — 예전 버전에 동의한 사람은 다시 묻는다.
export const LOCATION_TERMS_VERSION = '2026-10-26'

export interface LocationConsent {
  version: string
  // ISO 시각. 동의 내역 화면에 보여준다.
  agreedAt: string
}

// 내 위치는 기기 안에서만 쓰고 서버로 보내지 않으므로 동의도 기기에 둔다 (로그인 없이도 지도를 쓰니까).
const KEY = 'intermap.locationConsent'

function read(): LocationConsent | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LocationConsent | null
    return saved?.version === LOCATION_TERMS_VERSION ? saved : null
  } catch {
    return null
  }
}

// useSyncExternalStore는 같은 값이면 같은 참조를 돌려받아야 하므로 메모리에 들고 있는다
let current = read()
const listeners = new Set<() => void>()

function write(next: LocationConsent | null) {
  current = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // 저장 실패해도 이번 실행 동안은 메모리 값으로 동작
  }
  listeners.forEach((listener) => listener())
}

export function agreeLocation() {
  write({ version: LOCATION_TERMS_VERSION, agreedAt: new Date().toISOString() })
}

export function withdrawLocation() {
  write(null)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// 현재 동의 내역. 동의 안 했거나 약관 버전이 바뀌었으면 null
export function useLocationConsent(): LocationConsent | null {
  return useSyncExternalStore(subscribe, () => current)
}
