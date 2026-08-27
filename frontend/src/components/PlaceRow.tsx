import type { Restaurant, FriendGroup } from '../data/mock'
import './PlaceRow.css'

interface PlaceRowProps {
  restaurant: Restaurant
  groups: FriendGroup[]
  onSelect: (restaurant: Restaurant) => void
}

function topGroupColor(restaurant: Restaurant, groups: FriendGroup[]): string {
  const active = groups.filter((g) =>
    restaurant.groupIds.length > 0 ? restaurant.groupIds.includes(g.id) : g.id === 'none',
  )
  return [...active].sort((a, b) => a.priority - b.priority)[0]?.color ?? 'var(--gc-none)'
}

// 검색 결과와 겹친 핀 목록이 같은 줄 모양을 쓴다.
export default function PlaceRow({ restaurant, groups, onSelect }: PlaceRowProps) {
  return (
    <button type="button" className="place-row" onClick={() => onSelect(restaurant)}>
      <span
        className="place-row__dot"
        style={{ ['--pin-color' as string]: restaurant.closed ? '#9b93ab' : topGroupColor(restaurant, groups) }}
      />
      <span className="place-row__body">
        <span className="place-row__name">
          {restaurant.name}
          {restaurant.closed && <em className="place-row__closed">폐업</em>}
        </span>
        <span className="place-row__meta">
          {restaurant.category} · {restaurant.address}
        </span>
      </span>
      {restaurant.reviews.length > 0 && <span className="place-row__reviews">후기 {restaurant.reviews.length}</span>}
    </button>
  )
}
