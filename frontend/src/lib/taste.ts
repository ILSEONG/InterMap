import type { Review } from '../data/model'
import { restaurantKey } from './api'

// 입맛 이야기 — 현황판의 "한식파" 같은 꼬리표와, 프로필의 "나와의 입맛 궁합"을 같은 규칙으로 만든다.
// 서버를 부르지 않고 앱이 이미 받은 후기(팔로우한 사람 + 나)만으로 계산한다.

// 가게 분류는 공공데이터(LOCALDATA) 업태 그대로라 크게만 나뉜다 — 화면에 보일 이름으로 다듬는다
const CATEGORY_NAMES: Record<string, string> = {
  경양식: '양식',
  중국식: '중식',
  까페: '카페',
  커피숍: '카페',
  '호프/통닭': '치킨·호프',
  '통닭(치킨)': '치킨',
  '김밥(도시락)': '분식',
  '식육(숯불구이)': '고기',
  '탕류(보신용)': '탕',
  횟집: '회',
  냉면집: '냉면',
  '외국음식전문점(인도,태국등)': '세계 음식',
  뷔페식: '뷔페',
  패스트푸드: '패스트푸드',
  '정종/대포집/소주방': '술집',
}
// 장르로 치지 않는 뭉뚱그린 분류 (서버 RecapController와 같은 목록)
const VAGUE = new Set(['', '음식점', '일반음식점', '기타', '기타 휴게음식점'])

// "음식점>한식" → 한식, "경양식" → 양식. 장르로 칠 수 없으면 null
export function categoryName(raw: string | null | undefined): string | null {
  if (!raw) return null
  const last = raw.slice(raw.lastIndexOf('>') + 1).trim()
  // 업태 이름 자체에 쉼표가 있는 것(외국음식전문점(인도,태국등))은 통째로 먼저 찾는다
  if (CATEGORY_NAMES[last]) return CATEGORY_NAMES[last]
  const first = last.split(',')[0].trim()
  if (VAGUE.has(first)) return null
  return CATEGORY_NAMES[first] ?? first
}

// 받침이 있으면 은/이, 없으면 는/가 — "한식은", "카페는"
function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  if (code < 0 || code > 11171) return false
  return code % 28 !== 0
}
export const eunNeun = (word: string) => `${word}${hasBatchim(word) ? '은' : '는'}`
export const iGa = (word: string) => `${word}${hasBatchim(word) ? '이' : '가'}`
export const waGwa = (word: string) => `${word}${hasBatchim(word) ? '과' : '와'}`

// 한 사람의 입맛 꼬리표 — 후기 중 가장 많은 분류가 셋 이상이고 40% 이상이면 "한식파"
export function tasteTag(reviews: Review[]): string | null {
  const counts = new Map<string, number>()
  for (const rv of reviews) {
    const name = categoryName(rv.restaurant.category)
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let best: [string, number] | null = null
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry
  if (!best || best[1] < 3 || best[1] / reviews.length < 0.4) return null
  return `${best[0]}파`
}

export interface CommonPlace {
  key: string
  name: string
  address: string
  category: string | null
  mine: number
  theirs: number
}

export interface GenreRow {
  name: string
  count: number
  mine: number
  theirs: number
}

export interface TasteMatch {
  // 둘 다 후기를 남긴 가게 (같이 갔는지는 모른다) — 별점 차이가 작은 순
  common: CommonPlace[]
  // 3곳 미만이면 점수를 내지 않는다
  ready: boolean
  score: number
  // "입맛이 잘 통해요"
  headline: string
  // "한식 단짝"
  title: string
  // "둘 다 가 본 5곳 중 3곳에서 별점이 비슷했어요."
  lead: string
  // "한식은 별점이 거의 같았고, 일식에서 가장 크게 갈렸어요." (분류가 둘 이상일 때만)
  insight: string | null
  // 분류별 평균 별점 — 많이 겹친 순, 최대 3줄
  genres: GenreRow[]
}

export const MIN_COMMON = 3
// 별점 차이 0점 → 100%, 1점 → 75%, 4점 → 0%
export const scoreOf = (avgDiff: number) => Math.max(0, Math.round(100 - avgDiff * 25))

// 같은 가게에 후기를 여러 번 썼으면 가장 최근 별점
function latestByPlace(reviews: Review[]): Map<string, Review> {
  const map = new Map<string, Review>()
  for (const rv of reviews) {
    const key = restaurantKey(rv.restaurant)
    const prev = map.get(key)
    if (!prev || Date.parse(rv.createdAt) > Date.parse(prev.createdAt)) map.set(key, rv)
  }
  return map
}

export function tasteMatch(mine: Review[], theirs: Review[]): TasteMatch {
  const myPlaces = latestByPlace(mine)
  const common: CommonPlace[] = []
  for (const [key, rv] of latestByPlace(theirs)) {
    const my = myPlaces.get(key)
    if (!my) continue
    common.push({
      key,
      name: rv.restaurant.name,
      address: rv.restaurant.address,
      category: categoryName(rv.restaurant.category) ?? categoryName(my.restaurant.category),
      mine: my.rating,
      theirs: rv.rating,
    })
  }
  common.sort((a, b) => Math.abs(a.mine - a.theirs) - Math.abs(b.mine - b.theirs) || b.theirs - a.theirs)

  const n = common.length
  const empty = { common, ready: false, score: 0, headline: '', title: '', lead: '', insight: null, genres: [] }
  if (n < MIN_COMMON) return empty

  const avgDiff = common.reduce((sum, p) => sum + Math.abs(p.mine - p.theirs), 0) / n
  const score = scoreOf(avgDiff)
  const close = common.filter((p) => Math.abs(p.mine - p.theirs) <= 0.5).length

  // 분류별로 묶는다 (분류를 모르는 가게는 "기타")
  const byGenre = new Map<string, CommonPlace[]>()
  for (const p of common) {
    const g = p.category ?? '기타'
    byGenre.set(g, [...(byGenre.get(g) ?? []), p])
  }
  const avg = (list: CommonPlace[], pick: (p: CommonPlace) => number) => list.reduce((s, p) => s + pick(p), 0) / list.length
  const genres = [...byGenre.entries()]
    .map(([name, list]) => ({ name, count: list.length, mine: avg(list, (p) => p.mine), theirs: avg(list, (p) => p.theirs) }))
    .sort((a, b) => b.count - a.count)

  // 칭호: 절반 이상이 한 분류면 그 분류, 아니면 "두루두루" + 점수 구간
  const top = genres[0]
  const prefix = top && top.name !== '기타' && top.count * 2 >= n ? top.name : '두루두루'
  const [suffix, headline] =
    score >= 80 ? ['단짝', '입맛이 잘 통해요'] : score >= 60 ? ['잘 통하는 사이', '입맛이 꽤 통해요'] : ['입맛 정반대', '입맛이 많이 달라요']

  const lead =
    close === n
      ? `둘 다 가 본 ${n}곳 모두 별점이 비슷했어요.`
      : close === 0
        ? `둘 다 가 본 ${n}곳 모두 별점이 꽤 달랐어요.`
        : `둘 다 가 본 ${n}곳 중 ${close}곳에서 별점이 비슷했어요.`

  // 분류가 둘 이상이면 가장 가까운 분류와 가장 크게 갈린 분류를 짚는다
  let insight: string | null = null
  const known = genres.filter((g) => g.name !== '기타')
  if (known.length >= 2) {
    const gap = (g: GenreRow) => Math.abs(g.mine - g.theirs)
    const nearest = known.reduce((a, b) => (gap(b) < gap(a) ? b : a))
    const farthest = known.reduce((a, b) => (gap(b) > gap(a) ? b : a))
    if (gap(farthest) >= 1 && nearest !== farthest) {
      insight = `${eunNeun(nearest.name)} 별점이 거의 같았고, ${farthest.name}에서 가장 크게 갈렸어요.`
    } else if (gap(farthest) < 1) {
      insight = '어느 분류든 별점이 비슷했어요.'
    }
  }

  return { common, ready: true, score, headline, title: `${prefix} ${suffix}`, lead, insight, genres: genres.slice(0, 3) }
}
