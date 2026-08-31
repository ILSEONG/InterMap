import type { Restaurant } from '../data/model'

export interface TopPick {
  restaurant: Restaurant
  rating: number
}

// 한 사람이 별점을 남긴 가게를 별점 높은 순으로 최대 limit개.
// 같은 가게에 후기가 여럿이면 가장 높은 별점을 쓰고, 동점이면 최근 후기를 앞에 둔다.
export function topPicksOf(restaurants: Restaurant[], authorId: number, limit = 5): TopPick[] {
  return restaurants
    .flatMap((restaurant) => {
      const mine = restaurant.reviews.filter((rev) => rev.author.id === authorId)
      if (mine.length === 0) return []
      const best = mine.reduce((a, b) => (b.rating > a.rating ? b : a))
      return [{ restaurant, rating: best.rating, at: Date.parse(best.createdAt) }]
    })
    .sort((a, b) => b.rating - a.rating || b.at - a.at)
    .slice(0, limit)
    .map(({ restaurant, rating }) => ({ restaurant, rating }))
}

// 주소를 "서울 마포구", "경기 성남시", "부산 해운대구"처럼 짧은 위치로 줄인다.
// 시/도는 접미사(특별시·광역시·도 등)를 떼고, 3글자면 가운데를 빼서 2글자로(충청남→충남).
// 두 번째 토큰은 시·구·군일 때만 붙인다(세종처럼 바로 동이 오면 시/도만).
export function shortLocation(address: string): string {
  const [region = '', district = ''] = address.trim().split(/\s+/)
  const base = region.replace(/(특별자치도|특별자치시|특별시|광역시|도)$/, '')
  const short = base.length === 3 ? base[0] + base[2] : base
  return /[시구군]$/.test(district) ? `${short} ${district}` : short
}
