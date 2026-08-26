import type { Restaurant, FriendGroup } from '../data/mock'
import './SearchResults.css'

interface SearchResultsProps {
  results: Restaurant[]
  groups: FriendGroup[]
  tooShort: boolean
  minLength: number
  onPick: (restaurant: Restaurant) => void
}

function topGroupColor(restaurant: Restaurant, groups: FriendGroup[]): string {
  const active = groups.filter((g) => restaurant.groupIds.includes(g.id))
  return [...active].sort((a, b) => a.priority - b.priority)[0]?.color ?? '#8B6BFF'
}

export default function SearchResults({ results, groups, tooShort, minLength, onPick }: SearchResultsProps) {
  if (tooShort) {
    return (
      <div className="search-results">
        <p className="search-results__empty">{minLength}글자 이상 입력하면 가게를 찾아드려요.</p>
      </div>
    )
  }

  return (
    <div className="search-results">
      <p className="search-results__count">검색 결과 {results.length}곳</p>
      {results.length === 0 ? (
        <p className="search-results__empty">찾는 가게가 없어요. 다른 키워드로 찾아보세요.</p>
      ) : (
        <ul className="search-results__list">
          {results.map((restaurant) => (
            <li key={restaurant.id}>
              <button type="button" className="search-result" onClick={() => onPick(restaurant)}>
                <span
                  className="search-result__dot"
                  style={{ ['--pin-color' as string]: restaurant.closed ? '#9b93ab' : topGroupColor(restaurant, groups) }}
                />
                <span className="search-result__body">
                  <span className="search-result__name">
                    {restaurant.name}
                    {restaurant.closed && <em className="search-result__closed">폐업</em>}
                  </span>
                  <span className="search-result__meta">
                    {restaurant.category} · {restaurant.address}
                  </span>
                </span>
                {restaurant.reviews.length > 0 && (
                  <span className="search-result__reviews">후기 {restaurant.reviews.length}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
