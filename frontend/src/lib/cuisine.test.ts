import assert from 'node:assert/strict'
import { CUISINES, cuisineChipLabel, matchesCuisine, toggleCuisine } from './cuisine.ts'

assert.equal(CUISINES.length, 14)
assert.equal(new Set(CUISINES.map(([code]) => code)).size, 14)

// 켜고 끄기 — 고른 순서와 상관없이 화면 순서로 정리된다
assert.deepEqual(toggleCuisine([], 'JAPANESE'), ['JAPANESE'])
assert.deepEqual(toggleCuisine(['JAPANESE'], 'KOREAN'), ['KOREAN', 'JAPANESE'])
assert.deepEqual(toggleCuisine(['KOREAN', 'JAPANESE'], 'KOREAN'), ['JAPANESE'])
assert.deepEqual(toggleCuisine(['JAPANESE'], '없는코드'), ['JAPANESE'])
console.log('toggleCuisine ok')

assert.equal(cuisineChipLabel([]), '업종')
assert.equal(cuisineChipLabel(['JAPANESE']), '일식')
assert.equal(cuisineChipLabel(['BAR', 'KOREAN', 'CAFE']), '한식 외 2')
console.log('cuisineChipLabel ok')

// 고른 게 없으면 전부, 있으면 그 업종만 — 업종이 정해지지 않은 가게는 고르면 빠진다
assert.equal(matchesCuisine('KOREAN', []), true)
assert.equal(matchesCuisine(null, []), true)
assert.equal(matchesCuisine(undefined, []), true)
assert.equal(matchesCuisine('KOREAN', ['KOREAN', 'MEAT']), true)
assert.equal(matchesCuisine('CAFE', ['KOREAN', 'MEAT']), false)
assert.equal(matchesCuisine(null, ['KOREAN']), false)
console.log('matchesCuisine ok')
