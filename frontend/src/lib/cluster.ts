import type { Restaurant } from '../data/mock'

export interface Pin {
  key: string
  lat: number
  lng: number
  items: Restaurant[]
  // 서버 요약 셀로 만든 핀: items는 비어 있고 건수만 안다
  count?: number
}

// 핀 지름 16px + 터치 여유. 이보다 가까우면 손가락으로 개별 선택이 안 되므로 하나로 묶는다.
// 키우면 더 자주 묶이고, 줄이면 겹친 핀을 눌렀을 때 옆 가게가 잡히는 오탭이 늘어난다.
export const CLUSTER_PIXEL_DISTANCE = 26
// 줌 레벨에서의 월드 픽셀 좌표 (웹 메르카토르)
export function worldPoint(lat: number, lng: number, zoom: number) {
  const scale = 256 * 2 ** zoom
  const sin = Math.sin((lat * Math.PI) / 180)
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  }
}

// 월드 픽셀 y를 다시 위도로. 핀을 화면 위쪽에 두려고 지도 중심을 계산할 때 쓴다.
export function latAtWorldY(y: number, zoom: number): number {
  const t = y / (256 * 2 ** zoom)
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * t))) * 180) / Math.PI
}

// 그리디 군집화. 후보 비교는 격자 버킷(26px 셀)의 3×3 이웃으로 좁혀서
// 수천 건에서도 이동·줌마다 얼지 않는다. 결과는 전수 비교와 동일하다
// (거리 ≤ 셀 한 변이면 반드시 이웃 셀 안에 있으므로).
export function clusterPins(restaurants: Restaurant[], zoom: number): Pin[] {
  const points = restaurants.map((r) => ({ r, ...worldPoint(r.lat, r.lng, zoom) }))
  const buckets = new Map<string, number[]>()
  points.forEach((p, i) => {
    const key = `${Math.floor(p.x / CLUSTER_PIXEL_DISTANCE)}:${Math.floor(p.y / CLUSTER_PIXEL_DISTANCE)}`
    const list = buckets.get(key)
    if (list) list.push(i)
    else buckets.set(key, [i])
  })
  const taken = new Array<boolean>(points.length).fill(false)
  const pins: Pin[] = []

  points.forEach((point, i) => {
    if (taken[i]) return
    taken[i] = true
    const items = [point.r]

    const bx = Math.floor(point.x / CLUSTER_PIXEL_DISTANCE)
    const by = Math.floor(point.y / CLUSTER_PIXEL_DISTANCE)
    const candidates: number[] = []
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const list = buckets.get(`${bx + dx}:${by + dy}`)
        if (!list) continue
        for (const j of list) if (j > i && !taken[j]) candidates.push(j)
      }
    }
    // 흡수 순서가 인덱스 오름차순이어야 기존(전수 비교)과 같은 군집이 나온다
    candidates.sort((a, b) => a - b)
    for (const j of candidates) {
      const other = points[j]
      if (Math.hypot(point.x - other.x, point.y - other.y) <= CLUSTER_PIXEL_DISTANCE) {
        taken[j] = true
        items.push(other.r)
      }
    }

    pins.push({
      key: items.map((r) => r.id).sort().join('|'),
      lat: items.reduce((sum, r) => sum + r.lat, 0) / items.length,
      lng: items.reduce((sum, r) => sum + r.lng, 0) / items.length,
      items,
    })
  })

  return pins
}

// 해당 줌에서 이 가게가 다른 핀과 떨어져 보이는지.
// false면 아무리 확대해도 개별 핀으로 못 고른다는 뜻(같은 건물 등).
export function isSeparatedAt(restaurants: Restaurant[], target: Restaurant, zoom: number): boolean {
  const point = worldPoint(target.lat, target.lng, zoom)
  return restaurants.every((other) => {
    if (other.id === target.id) return true
    const o = worldPoint(other.lat, other.lng, zoom)
    return Math.hypot(point.x - o.x, point.y - o.y) > CLUSTER_PIXEL_DISTANCE
  })
}
