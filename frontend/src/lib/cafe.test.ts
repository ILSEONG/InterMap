import assert from 'node:assert/strict'
import { CAFE_KINDS, CAFE_TAGS, countCafeTags, isCafe, matchesCafeKind, matchesCafeTags, toggleCode } from './cafe.ts'

// 카페인지
assert.equal(isCafe({ cuisine: 'CAFE' }), true)
assert.equal(isCafe({ cuisine: 'KOREAN' }), false)
assert.equal(isCafe({ cuisine: null }), false)
assert.equal(isCafe({}), false)

// 고르기: 화면 순서대로 정리하고, 다시 누르면 꺼진다
assert.deepEqual(toggleCode(CAFE_KINDS, [], 'DESSERT'), ['DESSERT'])
assert.deepEqual(toggleCode(CAFE_KINDS, ['DESSERT'], 'COFFEE'), ['COFFEE', 'DESSERT'])
assert.deepEqual(toggleCode(CAFE_KINDS, ['COFFEE', 'DESSERT'], 'COFFEE'), ['DESSERT'])
assert.deepEqual(toggleCode(CAFE_KINDS, ['DESSERT'], '없는코드'), ['DESSERT'])
assert.deepEqual(toggleCode(CAFE_TAGS, ['MOOD'], 'WORK'), ['WORK', 'MOOD'])

// 종류: 고른 게 없으면 전부, 종류가 안 정해진 카페는 '카페'
assert.equal(matchesCafeKind('BAKERY', []), true)
assert.equal(matchesCafeKind('BAKERY', ['BAKERY', 'DESSERT']), true)
assert.equal(matchesCafeKind('COFFEE', ['BAKERY']), false)
assert.equal(matchesCafeKind(null, ['COFFEE']), true)
assert.equal(matchesCafeKind(undefined, ['BAKERY']), false)

// 꼬리표: 이웃 후기 하나라도 고른 꼬리표가 달려 있으면
const reviews = [{ tags: ['WORK', 'MOOD'] }, { tags: ['MOOD'] }, {}, { tags: [] }]
assert.equal(matchesCafeTags(reviews, []), true)
assert.equal(matchesCafeTags(reviews, ['WORK']), true)
assert.equal(matchesCafeTags(reviews, ['TALK', 'MOOD']), true)
assert.equal(matchesCafeTags(reviews, ['TALK']), false)
assert.equal(matchesCafeTags([], ['WORK']), false)
assert.equal(matchesCafeTags([], []), true)

// 모아 세기: 많이 고른 것부터, 같으면 화면 순서
assert.deepEqual(countCafeTags(reviews), [
  { code: 'MOOD', label: '분위기', count: 2 },
  { code: 'WORK', label: '작업·공부', count: 1 },
])
assert.deepEqual(countCafeTags([{ tags: ['TASTE'] }, { tags: ['WORK'] }, { tags: ['없는코드'] }]), [
  { code: 'WORK', label: '작업·공부', count: 1 },
  { code: 'TASTE', label: '커피 맛', count: 1 },
])
assert.deepEqual(countCafeTags([]), [])

console.log('cafe.test.ts OK')
