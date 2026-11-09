// 받아 온 데이터 기억 (stale-while-revalidate).
// 같은 화면을 다시 열면 기억해 둔 걸 바로 그리고, 새 데이터는 뒤에서 받아 조용히 바꾼다 — "불러오는 중 → 화면이 통째로 바뀜" 깜빡임을 없앤다.
// persist=true인 것(앱 시작 데이터)은 기기에도 남겨서 앱을 다시 켜도 지도·스토리가 바로 뜬다.
// 로그인한 사람별로 나눠 담고, 로그아웃·탈퇴하면 지운다.

const memory = new Map<string, unknown>()
const PREFIX = 'intermap.cache.'
let owner = 'guest'

const fullKey = (key: string) => `${owner}|${key}`

// 로그인한 사람이 바뀌면 메모리 기억을 비운다 (기기에 남긴 건 사람별 키라 섞이지 않는다)
export function setCacheOwner(id: string) {
  if (owner === id) return
  owner = id
  memory.clear()
}

// 로그아웃·탈퇴 — 기억해 둔 걸 전부 지운다
export function clearCache() {
  memory.clear()
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key)
  } catch {
    // 저장소를 못 쓰면 지울 것도 없다
  }
}

export function peek<T>(key: string, persist = false): T | undefined {
  const k = fullKey(key)
  if (memory.has(k)) return memory.get(k) as T
  if (!persist) return undefined
  try {
    const raw = localStorage.getItem(PREFIX + k)
    if (raw === null) return undefined
    const value = JSON.parse(raw) as T
    memory.set(k, value)
    return value
  } catch {
    return undefined
  }
}

export function remember<T>(key: string, value: T, persist = false) {
  const k = fullKey(key)
  memory.set(k, value)
  if (!persist) return
  try {
    localStorage.setItem(PREFIX + k, JSON.stringify(value))
  } catch {
    // 용량이 차면 기기 저장만 건너뛴다 (메모리 기억은 그대로)
  }
}
