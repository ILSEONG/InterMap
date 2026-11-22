import assert from 'node:assert/strict'
import { highlightSpans, matchesWords, searchWords } from './search.ts'

// 띄어쓰기로 나누고 소문자로 맞춘다. 넷째 낱말까지만.
assert.deepEqual(searchWords('  Tama   여의도 '), ['tama', '여의도'])
assert.deepEqual(searchWords('a b c d e'), ['a', 'b', 'c', 'd'])
assert.deepEqual(searchWords('   '), [])
console.log('searchWords ok')

// 낱말마다 이름·업종·주소 어디든 있으면 된다 (순서 무관)
const yeouido = '타마 일식 서울특별시 영등포구 국제금융로 10 서울특별시 영등포구 여의도동 23'
const yeoksam = '타마 일식 서울특별시 강남구 테헤란로 1 서울특별시 강남구 역삼동 1'
assert.equal(matchesWords(yeouido, searchWords('타마 여의도')), true)
assert.equal(matchesWords(yeoksam, searchWords('타마 여의도')), false)
assert.equal(matchesWords(yeouido, searchWords('여의도 타마')), true)
assert.equal(matchesWords(yeoksam, searchWords('강남구 일식 타마')), true)
// 낱말 하나만 쳐도 예전처럼 걸린다
assert.equal(matchesWords(yeouido, searchWords('타마')), true)
assert.equal(matchesWords(yeoksam, searchWords('타마')), true)
console.log('matchesWords ok')

// 검색어가 통째로 있으면 그 한 곳
assert.deepEqual(highlightSpans('여의도 타마 본점', '타마 본점'), [[4, 9]])
// 통째로 없으면 낱말마다, 글에 없는 낱말은 건너뛴다
assert.deepEqual(highlightSpans('타마 스시', '스시 여의도 타마'), [[0, 2], [3, 5]])
// 겹치는 구간은 합친다
assert.deepEqual(highlightSpans('타마스시', '타마스 마스시'), [[0, 4]])
// 안 맞으면 칠하지 않는다
assert.deepEqual(highlightSpans('타마', '여의도'), [])
assert.deepEqual(highlightSpans('타마', '  '), [])
console.log('highlightSpans ok')
