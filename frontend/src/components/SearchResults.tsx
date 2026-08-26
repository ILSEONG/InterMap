import type { Restaurant, FriendGroup } from '../data/mock'
import PlaceRow from './PlaceRow'
import './SearchResults.css'

interface SearchResultsProps {
  results: Restaurant[]
  groups: FriendGroup[]
  tooShort: boolean
  minLength: number
  onPick: (restaurant: Restaurant) => void
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
              <PlaceRow restaurant={restaurant} groups={groups} onSelect={onPick} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
