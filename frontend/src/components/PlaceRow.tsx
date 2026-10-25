import type { Restaurant, FriendGroup } from '../data/model'
import { shortLocation } from '../lib/topPicks'
import Highlight from './Highlight'
import './PlaceRow.css'

interface PlaceRowProps {
  restaurant: Restaurant
  groups: FriendGroup[]
  onSelect: (restaurant: Restaurant) => void
  // 검색어 — 이름에서 겹치는 부분을 칠한다
  highlight?: string
}

// 이 가게에 후기를 남긴 이웃들의 그룹 (우선순위 순, 미지정은 '그룹없음')
function activeGroups(restaurant: Restaurant, groups: FriendGroup[]): FriendGroup[] {
  return groups
    .filter((g) => (restaurant.groupIds.length > 0 ? restaurant.groupIds.includes(g.id) : g.id === 'none'))
    .sort((a, b) => a.priority - b.priority)
}

// 검색 결과 한 줄. 이웃 후기가 있는 가게는 틴트 배경 + 그룹 점으로 먼저 눈에 띄게.
export default function PlaceRow({ restaurant, groups, onSelect, highlight }: PlaceRowProps) {
  const reviewCount = restaurant.reviews.length
  const reviewed = reviewCount > 0 && !restaurant.closed
  const dots = reviewed ? activeGroups(restaurant, groups).slice(0, 3) : []
  const meta = [restaurant.category, shortLocation(restaurant.address)]
  if (!restaurant.closed) meta.push(reviewCount > 0 ? `후기 ${reviewCount}` : '후기 없음')

  return (
    <button
      type="button"
      className={`place-row${reviewed ? ' place-row--reviewed' : ''}${restaurant.closed ? ' place-row--closed' : ''}`}
      onClick={() => onSelect(restaurant)}
    >
      <span className="place-row__icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
          <circle cx="12" cy="9.5" r="2.5" />
        </svg>
      </span>
      <span className="place-row__body">
        <span className="place-row__name">
          <Highlight text={restaurant.name} query={highlight} />
        </span>
        <span className="place-row__meta">{meta.join(' · ')}</span>
      </span>
      {restaurant.closed ? (
        <em className="place-row__closed">폐업</em>
      ) : (
        dots.length > 0 && (
          <span className="place-row__dots" aria-label={dots.map((g) => g.label).join(', ')}>
            {dots.map((g) => (
              <span key={g.id} className="place-row__dot" style={{ background: g.color }} />
            ))}
          </span>
        )
      )}
    </button>
  )
}
