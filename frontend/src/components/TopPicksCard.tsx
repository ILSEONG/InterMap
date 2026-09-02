import type { Restaurant } from '../data/model'
import { shortLocation } from '../lib/topPicks'
import type { TopPick } from '../lib/topPicks'
import './SearchResults.css'

interface TopPicksCardProps {
  name: string
  picks: TopPick[]
  onPick: (restaurant: Restaurant) => void
  className?: string
}

// 한 사람의 별점 TOP 5 요약 카드. 사람 검색 결과와 친구 목록 선택 양쪽에서 쓴다.
export default function TopPicksCard({ name, picks, onPick, className }: TopPicksCardProps) {
  return (
    <section className={`top-picks${className ? ` ${className}` : ''}`}>
      <h3 className="top-picks__title">{name}의 별점 TOP 5</h3>
      <ol className="top-picks__list">
        {picks.map(({ restaurant, rating }, i) => (
          <li key={restaurant.id}>
            <button type="button" className="top-picks__row" onClick={() => onPick(restaurant)}>
              <span className="top-picks__rank">{i + 1}</span>
              <span className="top-picks__body">
                <span className="top-picks__name">{restaurant.name}</span>
                <span className="top-picks__meta">
                  {restaurant.category} · {shortLocation(restaurant.address)}
                </span>
              </span>
              <span className="top-picks__rating">★ {rating.toFixed(1)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
