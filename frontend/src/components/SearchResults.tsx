import type { Restaurant, FriendGroup, ReviewAuthor } from '../data/model'
import type { TopPick } from '../lib/topPicks'
import type { UserItem } from '../lib/api'
import { useOpenProfile } from '../lib/openProfile'
import Avatar from './Avatar'
import Highlight from './Highlight'
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
  // 검색어 — 결과 이름에서 겹치는 부분을 칠한다
  highlight?: string
  onPick: (restaurant: Restaurant) => void
}

// 하단 검색 독 바로 위에 뜨는 결과 패널
export default function SearchResults({
  results,
  topPicks,
  people = [],
  onFollow,
  groups,
  tooShort,
  minLength,
  highlight,
  onPick,
}: SearchResultsProps) {
  // 사람을 누르면 프로필 개요 (App이 컨텍스트로 내려준다)
  const openProfile = useOpenProfile()

  if (tooShort) {
    return (
      <section className="search-results glass glass--strong" aria-label="검색 결과">
        <p className="search-results__empty">{minLength}글자 이상 입력하면 가게를 찾아드려요.</p>
      </section>
    )
  }

  return (
    <section className="search-results glass glass--strong" aria-label="검색 결과">
      {topPicks.map(({ author, picks }) => (
        <TopPicksCard key={author.id} name={author.name} picks={picks} userId={author.id} onPick={onPick} />
      ))}
      <h2 className="search-results__heading">가게 {results.length}</h2>
      {results.length === 0 ? (
        <p className="search-results__empty">찾는 가게가 없어요. 다른 키워드로 찾아보세요.</p>
      ) : (
        <ul className="search-results__list">
          {/* 행이 수백 개 넘어가면 렌더가 입력을 막는다. 지도엔 전부 찍히니 목록만 자른다. */}
          {results.slice(0, MAX_ROWS).map((restaurant) => (
            <li key={restaurant.id}>
              <PlaceRow restaurant={restaurant} groups={groups} onSelect={onPick} highlight={highlight} />
            </li>
          ))}
        </ul>
      )}
      {results.length > MAX_ROWS && (
        <p className="search-results__empty">{results.length - MAX_ROWS}곳 더 있어요. 키워드를 더 입력하면 좁혀져요.</p>
      )}
      {people.length > 0 && (
        <>
          <h2 className="search-results__heading search-results__heading--gap">인터맵 사용자</h2>
          <ul className="search-results__list">
            {people.map((u) => (
              <li key={u.id} className="search-results__person">
                <button
                  type="button"
                  className="search-results__person-open"
                  onClick={() => openProfile?.(u.id)}
                  disabled={!openProfile}
                >
                  <Avatar className={`search-results__person-avatar tone-${Math.abs(u.id) % 4}`} src={null} name={u.nickname} />
                  <span className="search-results__person-name">
                    <Highlight text={u.nickname} query={highlight} />
                  </span>
                </button>
                <button type="button" className="search-results__follow" onClick={() => onFollow?.(u.id)}>
                  팔로우
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
