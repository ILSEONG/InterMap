import assert from 'node:assert/strict'
import { topPicksOf } from './topPicks.ts'
import type { Restaurant, Review } from '../data/mock'

function shop(id: string, reviews: Review[]): Restaurant {
  return { id, name: id, category: '', address: '', lat: 0, lng: 0, groupIds: [], reviews, comments: [] }
}
const rv = (friendId: string, rating: number, postedHoursAgo = 0): Review => ({
  id: `${friendId}-${rating}-${postedHoursAgo}`,
  friendId,
  rating,
  text: '',
  postedHoursAgo,
})

const list = [
  shop('a', [rv('f1', 3)]),
  shop('b', [rv('f1', 5, 10), rv('f2', 1)]),
  shop('c', [rv('f1', 5, 2)]),
  shop('d', [rv('f2', 4)]),
  shop('e', [rv('f1', 2), rv('f1', 4)]), // 같은 사람 후기 둘 → 높은 별점 4
  shop('f', [rv('f1', 1)]),
  shop('g', [rv('f1', 1)]),
]

const picks = topPicksOf(list, 'f1')
// 별점 내림차순, 동점(5점)은 최근 것(c) 먼저, 최대 5개 (f1이 남긴 가게는 6곳)
assert.deepEqual(
  picks.map((p) => `${p.restaurant.id}:${p.rating}`),
  ['c:5', 'b:5', 'e:4', 'a:3', 'f:1'],
)
// 남의 후기는 섞이지 않는다
assert.deepEqual(topPicksOf(list, 'f2').map((p) => p.restaurant.id), ['d', 'b'])
assert.deepEqual(topPicksOf(list, 'nobody'), [])

console.log('topPicks ok')

import { shortLocation } from './topPicks.ts'
assert.equal(shortLocation('서울 마포구 연남동 223-14'), '서울 마포구')
assert.equal(shortLocation('서울특별시 강남구 테헤란로 152'), '서울 강남구')
assert.equal(shortLocation('경기도 성남시 분당구 판교역로 235'), '경기 성남시')
assert.equal(shortLocation('부산광역시 해운대구 우동 1'), '부산 해운대구')
assert.equal(shortLocation('충청남도 천안시 동남구 1'), '충남 천안시')
assert.equal(shortLocation('전북특별자치도 전주시 완산구 1'), '전북 전주시')
assert.equal(shortLocation('강원특별자치도 평창군 대관령면 1'), '강원 평창군')
assert.equal(shortLocation('세종특별자치시 나성동 1'), '세종')
assert.equal(shortLocation('제주특별자치도 제주시 1'), '제주 제주시')
assert.equal(shortLocation(''), '')
console.log('shortLocation ok')
