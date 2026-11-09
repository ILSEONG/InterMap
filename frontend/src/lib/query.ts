// 서버 데이터 계층 — TanStack Query + 기기 저장(IndexedDB).
// - 같은 데이터를 여러 곳에서 동시에 불러도 요청은 한 번 (중복 제거), 실패하면 잠깐 쉬었다 다시 시도
// - 받아 둔 게 있으면 바로 그리고 새 값은 뒤에서 받아 조용히 바꾼다 (stale-while-revalidate) — "불러오는 중 → 통째로 바뀜" 깜빡임 없음
// - 앱으로 돌아오거나 인터넷이 다시 연결되면 오래된 것만 새로 받는다
// - 앱 시작에 필요한 목록은 IndexedDB에 남겨 다시 켜도 지도·스토리가 바로 뜬다. localStorage와 달리 읽고 쓰는 동안 화면을 멈추지 않는다
// 키는 [로그인한 사람, 이름, ...] — 사람별로 나뉘고, 로그아웃·탈퇴하면 통째로 지운다.
import { QueryClient, focusManager, useQuery, type Query, type QueryKey } from '@tanstack/react-query'
import { persistQueryClientRestore, persistQueryClientSubscribe, type PersistedClient, type Persister } from '@tanstack/react-query-persist-client'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { createStore, del, get, set } from 'idb-keyval'
import { useCallback } from 'react'

const DAY = 24 * 60 * 60 * 1000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 20초 안에 다시 열면 새로 받지 않는다 — 화면을 왔다 갔다 할 때 요청이 쏟아지지 않게
      staleTime: 20_000,
      // 안 쓰는 데이터도 하루는 메모리에 둔다 (기기 저장 기간보다 짧으면 저장한 게 지워진다)
      gcTime: DAY,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
})

// 기기에 남기는 데이터 — 앱을 켜자마자 필요한 것만 (프로필·투표 화면 등은 메모리로 충분)
const PERSISTED = new Set(['reviews', 'comments', 'favorites', 'social', 'myPolls', 'recap'])

let owner = 'guest'
// 로그인한 사람이 바뀌면 키가 바뀐다 — 다른 사람 몫은 보이지 않는다
export function setQueryOwner(id: string) {
  if (owner === id) return
  owner = id
  memory.clear()
}
export const cacheKey = (...parts: unknown[]): QueryKey => [owner, ...parts]

// 그린 카드 이미지(Blob)처럼 기기에 저장할 수 없는 것 — 메모리에만, 사람이 바뀌면 비운다
export const memory = new Map<string, unknown>()

type Updater<T> = T | ((prev: T | undefined) => T)

// 앱 안에서 바뀐 걸 바로 반영한다 (후기 쓰기·댓글·찜…). 받는 중이던 요청이 있으면 그건 버리고 새로 받는다 —
// 쓰기 전에 출발한 응답이 방금 쓴 걸 덮어 지우지 않게
export function writeCache<T>(key: QueryKey, value: Updater<T>) {
  queryClient.setQueryData<T>(key, (prev) => (typeof value === 'function' ? (value as (p: T | undefined) => T)(prev) : value))
  if (queryClient.isFetching({ queryKey: key, exact: true }) > 0) {
    void queryClient.invalidateQueries({ queryKey: key, exact: true }, { cancelRefetch: true })
  }
}

export const readCache = <T,>(key: QueryKey) => queryClient.getQueryData<T>(key)

// 내 것만 다시 받기 (차단·팔로우처럼 서버 쪽 목록이 바뀌었을 때)
export function refresh(...names: string[]) {
  for (const name of names) void queryClient.invalidateQueries({ queryKey: [owner, name] })
}

// useState처럼 [값, 바꾸기]를 돌려주는 서버 데이터 훅. 키에 로그인한 사람이 자동으로 붙는다.
// empty: 아직 받은 게 없을 때 바꾸기 함수가 이전 값으로 받는 값 (예: 빈 목록)
export function useServerState<T>(
  parts: unknown[],
  fetcher: () => Promise<T>,
  options: { enabled?: boolean; staleTime?: number; empty?: T } = {},
) {
  const key = cacheKey(...parts)
  const query = useQuery({ queryKey: key, queryFn: fetcher, enabled: options.enabled ?? true, staleTime: options.staleTime })
  const keyText = JSON.stringify(key)
  const { empty } = options
  const setData = useCallback(
    (value: T | ((prev: T) => T)) =>
      writeCache<T>(JSON.parse(keyText) as QueryKey, (prev) =>
        typeof value === 'function' ? (value as (p: T) => T)((prev ?? empty) as T) : value,
      ),
    // empty는 처음 값만 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyText],
  )
  return [query.data, setData, query] as const
}

// ---- 기기 저장 (IndexedDB) ----

const store = typeof indexedDB === 'undefined' ? undefined : createStore('intermap', 'query')
const STORE_KEY = 'client'

// IndexedDB는 객체를 그대로 담는다 — JSON 문자열로 바꾸는 단계가 없다.
// 데이터가 바뀔 때마다 쓰지 않고 1초에 한 번 몰아서 쓰고, 앱이 백그라운드로 가면 바로 쓴다 (꺼지기 전에 남게)
let pending: PersistedClient | null = null
let timer: number | undefined
function flush() {
  window.clearTimeout(timer)
  timer = undefined
  if (!store || !pending) return
  const client = pending
  pending = null
  void set(STORE_KEY, client, store).catch(() => {
    // 용량이 차거나 막혀 있으면 기기 저장만 건너뛴다
  })
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
}
const persister: Persister = {
  persistClient(client) {
    pending = client
    if (timer === undefined) timer = window.setTimeout(flush, 1000)
  },
  restoreClient: () => (store ? get<PersistedClient>(STORE_KEY, store).catch(() => undefined) : undefined),
  removeClient() {
    pending = null
    window.clearTimeout(timer)
    timer = undefined
    if (store) return del(STORE_KEY, store).catch(() => {})
  },
}

const persistOptions = {
  queryClient,
  persister,
  maxAge: 7 * DAY,
  // 저장 형식이 바뀌면 올린다 — 예전 형식은 버린다
  buster: 'v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (q: Query) =>
      q.state.status === 'success' && PERSISTED.has(String(q.queryKey[1])),
  },
}

// 예전 저장 방식(localStorage 'intermap.cache.')에서 옮긴다 — 업데이트 직후 첫 실행에도 지도가 바로 뜨게. 옮긴 뒤 지운다
function migrateLegacy() {
  const PREFIX = 'intermap.cache.'
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(PREFIX)) continue
      const raw = localStorage.getItem(k)
      localStorage.removeItem(k)
      const [who, name] = k.slice(PREFIX.length).split('|')
      if (!raw || !who || !name) continue
      const value = JSON.parse(raw)
      const parts = name.startsWith('recap:') ? ['recap', name.slice(6)] : [name]
      if (!PERSISTED.has(parts[0]) || queryClient.getQueryData([who, ...parts]) !== undefined) continue
      // 시각 0으로 넣어 바로 "오래된 것" — 화면엔 바로 쓰고 새 값은 곧바로 받는다
      queryClient.setQueryData([who, ...parts], value, { updatedAt: 1 })
    }
  } catch {
    // 못 옮기면 처음부터 받는다
  }
}

// 앱을 그리기 전에 한 번 — 기기에 남긴 걸 불러온다. IndexedDB가 늦거나 막혀 있어도 0.4초 넘게 기다리지 않는다
export async function restoreQueryCache() {
  if (store) {
    await Promise.race([
      persistQueryClientRestore(persistOptions).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 400)),
    ])
  }
  migrateLegacy()
  if (store) persistQueryClientSubscribe(persistOptions)
}

// 로그아웃·탈퇴 — 메모리와 기기에 남긴 걸 전부 지운다
export function clearQueryCache() {
  queryClient.clear()
  memory.clear()
  void persister.removeClient()
}

// 안드로이드·iOS 앱: 백그라운드에서 돌아오면 "다시 보인 것"으로 친다 — 오래된 데이터만 새로 받는다
if (Capacitor.isNativePlatform()) {
  focusManager.setEventListener((handleFocus) => {
    const onVisibility = () => handleFocus(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    const resume = CapacitorApp.addListener('resume', () => handleFocus(true))
    const pause = CapacitorApp.addListener('pause', () => handleFocus(false))
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      void resume.then((h) => h.remove())
      void pause.then((h) => h.remove())
    }
  })
}
