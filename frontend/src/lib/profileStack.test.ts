import assert from 'node:assert/strict'
import { backProfile, pushProfile, setTopList } from './profileStack.ts'

// A 프로필 → A 팔로잉 목록 → B 프로필 → B 팔로워 목록, 뒤로가기로 한 단계씩 되돌아온다
let s = pushProfile([], 1)
s = setTopList(s, 'following')
s = pushProfile(s, 2)
s = setTopList(s, 'followers')
assert.deepEqual(s, [
  { userId: 1, list: 'following' },
  { userId: 2, list: 'followers' },
])

s = backProfile(s)
assert.deepEqual(s.at(-1), { userId: 2, list: null }, 'B 목록 → B 개요')
s = backProfile(s)
assert.deepEqual(s, [{ userId: 1, list: 'following' }], 'B 개요 → A 목록')
s = backProfile(s)
assert.deepEqual(s, [{ userId: 1, list: null }], 'A 목록 → A 개요')
s = backProfile(s)
assert.deepEqual(s, [], 'A 개요 → 닫힘')
assert.deepEqual(backProfile([]), [])

// 같은 사람은 다시 쌓지 않는다
assert.deepEqual(pushProfile([{ userId: 1, list: null }], 1), [{ userId: 1, list: null }])

console.log('profileStack ok')
