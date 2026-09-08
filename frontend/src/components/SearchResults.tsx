import type { Restaurant, FriendGroup, ReviewAuthor } from '../data/model'
import type { TopPick } from '../lib/topPicks'
import type { UserItem } from '../lib/api'
import { useOpenProfile } from '../lib/openProfile'
import Avatar from './Avatar'
import PlaceRow from './PlaceRow'
import TopPicksCard from './TopPicksCard'
import './SearchResults.css'

// 목록에 그리는 최대 행 수
const MAX_ROWS = 50

interface SearchResultsProps {
  results: Restaurant[]
  // 사람 검색일 때 이름이 걸린 사람별 별점 TOP 5 요약
  topPicks: { author: Pick<ReviewAuthor, 'id' | 'name'>; picks: TopPick[] }[]
  // 사람 검색일 때 아직 팔로우하지 않아 후기가 안 보이는 인터맵 사용자들
  people?: UserItem[]
  onFollow?: (userId: number) => void
  groups: FriendGroup[]
  tooShort: boolean
  minLength: number
  onPick: (restaurant: Restaurant) => void
}

export default function SearchResults({ results, topPicks, people = [], onFollow, groups, tooShort, minLength, onPick }: SearchResultsProps) {
  // 사람을 누르면 프로필 개요 (App이 컨텍스트로 내려준다)
  const openProfile = useOpenProfile()

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
        <TopPicksCard key={author.id} name={author.name} picks={picks} userId={author.id} onPick={onPick} />
      ))}
      {people.length > 0 && (
        <section className="search-results__people">
          <p className="search-results__count">인터맵 사용자 {people.length}명</p>
          <ul className="search-results__list">
            {people.map((u) => (
              <li key={u.id} className="search-results__person">
                <button
                  type="button"
                  className="search-results__person-open"
                  onClick={() => openProfile?.(u.id)}
                  disabled={!openProfile}
                >
                  <Avatar className="search-results__person-avatar" src={null} name={u.nickname} />
                  <span className="search-results__person-name">{u.nickname}</span>
                </button>
                <button type="button" className="search-results__follow" onClick={() => onFollow?.(u.id)}>
                  팔로우
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="search-results__count">검색 결과 {results.length}곳</p>
      {results.length === 0 ? (
        <p className="search-results__empty">찾는 가게가 없어요. 다른 키워드로 찾아보세요.</p>
      ) : (
        <ul className="search-results__list">
          {/* 행이 수백 개 넘어가면 렌더가 입력을 막는다. 지도엔 전부 찍히니 목록만 자른다. */}
          {results.slice(0, MAX_ROWS).map((restaurant) => (
            <li key={restaurant.id}>
              <PlaceRow restaurant={restaurant} groups={groups} onSelect={onPick} />
            </li>
          ))}
        </ul>
      )}
      {results.length > MAX_ROWS && (
        <p className="search-results__empty">{results.length - MAX_ROWS}곳 더 있어요. 키워드를 더 입력하면 좁혀져요.</p>
      )}
    </div>
  )
}
