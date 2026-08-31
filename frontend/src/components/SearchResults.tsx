import type { Restaurant, FriendGroup, ReviewAuthor } from '../data/model'
import { shortLocation } from '../lib/topPicks'
import type { TopPick } from '../lib/topPicks'
import PlaceRow from './PlaceRow'
import './SearchResults.css'

interface SearchResultsProps {
  results: Restaurant[]
  // 사람 검색일 때 이름이 걸린 사람별 별점 TOP 5 요약
  topPicks: { author: Pick<ReviewAuthor, 'id' | 'name'>; picks: TopPick[] }[]
  groups: FriendGroup[]
  tooShort: boolean
  minLength: number
  onPick: (restaurant: Restaurant) => void
}

export default function SearchResults({ results, topPicks, groups, tooShort, minLength, onPick }: SearchResultsProps) {
  if (tooShort) {
    return (
      <div className="search-results">
        <p className="search-results__empty">{minLength}글자 이상 입력하면 가게를 찾아드려요.</p>
      </div>
    )
  }

  return (
    <div className="search-results">
      {topPicks.map(({ author, picks }) => (
        <section key={author.id} className="top-picks">
          <h3 className="top-picks__title">{author.name}의 별점 TOP 5</h3>
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
      ))}
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
