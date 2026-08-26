import assert from 'node:assert/strict'
import { clusterPins, isSeparatedAt, latAtWorldY, worldPoint } from './cluster.ts'
import type { Restaurant } from '../data/mock'

function shop(id: string, lat: number, lng: number): Restaurant {
  return { id, name: id, category: '', address: '', lat, lng, groupIds: [], reviews: [], comments: [] }
}

// 같은 건물 수준(약 8m)으로 붙은 두 가게
const a = shop('a', 37.5625, 126.9256)
const b = shop('b', 37.56251, 126.92569)
// 약 250m 떨어진 가게
const far = shop('far', 37.5647, 126.9256)

// 손가락으로 못 가릴 만큼 붙은 둘은 한 핀으로 합쳐진다 (zoom 15에서 약 2px 간격)
const zoomedOut = clusterPins([a, b, far], 15)
assert.equal(zoomedOut.length, 2)
assert.equal(zoomedOut.find((p) => p.items.length === 2)?.items.map((r) => r.id).join(','), 'a,b')

// 충분히 확대하면(zoom 20) 낱개로 풀린다
assert.equal(clusterPins([a, b, far], 20).length, 3)

// 250m 떨어진 가게는 같은 줌에서 합쳐지지 않는다
assert.ok(clusterPins([a, far], 15).every((p) => p.items.length === 1))

// 합쳐진 핀 좌표는 구성원 평균
const merged = zoomedOut.find((p) => p.items.length === 2)!
assert.ok(Math.abs(merged.lat - (a.lat + b.lat) / 2) < 1e-9)

// worldPoint <-> latAtWorldY 왕복
for (const zoom of [12, 15, 18]) {
  const y = worldPoint(37.5625, 126.9256, zoom).y
  assert.ok(Math.abs(latAtWorldY(y, zoom) - 37.5625) < 1e-9)
}

// 픽셀을 더하면 남쪽으로 내려간다 (= 지도 중심을 아래로 옮겨 핀을 화면 위쪽에 둔다)
const base = worldPoint(37.5625, 126.9256, 15)
assert.ok(latAtWorldY(base.y + 200, 15) < 37.5625)

// 같은 건물 수준으로 붙은 가게는 최대 확대(20)에서도 못 가른다고 나와야 한다
const sameSpot = { ...a, id: 'same-building', lat: a.lat, lng: a.lng }
assert.equal(isSeparatedAt([a, sameSpot], a, 20), false)
assert.equal(isSeparatedAt([a, far], a, 20), true)
// 8m 거리면 20에서는 갈라진다
assert.equal(isSeparatedAt([a, b], a, 20), true)

console.log('cluster ok')
