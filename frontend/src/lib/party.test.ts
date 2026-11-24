// node --experimental-strip-types src/lib/party.test.ts
import assert from 'node:assert/strict'
import { matchesParty, partyOf, partySizes } from './party.ts'

assert.deepEqual(partySizes(false).map(([, label]) => label), ['혼밥', '2~5인', '6인 이상'])
assert.deepEqual(partySizes(true).map(([, label]) => label), ['혼자', '2~5인', '6인 이상'], '카페에서는 혼밥이 아니라 혼자')
assert.deepEqual(partySizes(true).map(([code]) => code), partySizes(false).map(([code]) => code), '코드는 화면과 상관없이 같다')

// 카페 꼬리표와 섞여 있어도 규모만, 화면 순서대로
assert.deepEqual(partyOf(['MOOD', 'LARGE', 'WORK', 'SOLO']), ['SOLO', 'LARGE'])
assert.deepEqual(partyOf(undefined), [])

const reviews = [{ tags: ['SOLO'] }, { tags: ['MOOD'] }, {}]
assert.equal(matchesParty(reviews, []), true, '고른 게 없으면 전부')
assert.equal(matchesParty(reviews, ['SOLO']), true)
assert.equal(matchesParty(reviews, ['LARGE']), false)
assert.equal(matchesParty(reviews, ['LARGE', 'SOLO']), true, '여러 개를 고르면 하나라도 맞는 곳')
assert.equal(matchesParty([], ['SOLO']), false, '후기가 없으면 규모를 알 수 없다')
console.log('party ok')
