import type { Restaurant, FriendGroup } from '../data/model'
import { useOpenProfile } from '../lib/openProfile'
import Avatar from './Avatar'
import Highlight from './Highlight'
import PlaceRow from './PlaceRow'
import './SearchResults.css'

// 목록에 그리는 최대 행 수
const MAX_ROWS = 50

// 이웃 검색 결과 한 줄 — 이미 아는 이웃(팔로잉·팔로워)은 내가 붙인 이름과 사진까지
export interface NeighborHit {
  id: number
  // 보이는 이름 (내가 붙인 이름 우선)
  name: string
  // 원래 닉네임 — 이름과 다를 때만 @닉네임으로 덧붙인다
  nickname: string
  avatar: string | null
  following: boolean
}

interface SearchResultsProps {
  mode: 'restaurant' | 'person'
  results: Restaurant[]
  // 이웃 검색 결과 (mode === 'person')
  neighbors?: NeighborHit[]
  onFollow?: (userId: number) => void
  groups: FriendGroup[]
  tooShort: boolean
  minLength: number
  // 검색어 — 결과 이름에서 겹치는 부분을 칠한다
  highlight?: string
  onPick: (restaurant: Restaurant) => void
}

// 상단 검색칸 아래 뜨는 결과 패널. 가게 검색이면 가게만, 이웃 검색이면 이웃만.
export default function SearchResults({
  mode,
  results,
  neighbors = [],
  onFollow,
  groups,
  tooShort,
  minLength,
  highlight,
  onPick,
}: SearchResultsProps) {
  // 이웃을 누르면 프로필 개요 (App이 컨텍스트로 내려준다)
  const openProfile = useOpenProfile()

  if (tooShort) {
    return (
      <section className="search-results glass glass--strong" aria-label="검색 결과">
        <p className="search-results__empty">
          {minLength}글자 이상 입력하면 {mode === 'person' ? '이웃을' : '가게를'} 찾아드려요.
        </p>
      </section>
    )
  }

  if (mode === 'person') {
    return (
      <section className="search-results glass glass--strong" aria-label="이웃 검색 결과">
        <h2 className="search-results__heading">이웃 {neighbors.length}</h2>
        {neighbors.length === 0 ? (
          <p className="search-results__empty">찾는 이웃이 없어요. 닉네임을 다시 확인해 보세요.</p>
        ) : (
          <ul className="search-results__list">
            {neighbors.map((u) => (
              <li key={u.id} className="search-results__person">
                <button
                  type="button"
                  className="search-results__person-open"
                  onClick={() => openProfile?.(u.id)}
                  disabled={!openProfile}
                >
                  <Avatar className={`search-results__person-avatar tone-${Math.abs(u.id) % 4}`} src={u.avatar} name={u.name} />
                  <span className="search-results__person-text">
                    <span className="search-results__person-name">
                      <Highlight text={u.name} query={highlight} />
                    </span>
                    {u.name !== u.nickname && (
                      <span className="search-results__person-sub">
                        @<Highlight text={u.nickname} query={highlight} />
                      </span>
                    )}
                  </span>
                </button>
                {u.following ? (
                  <span className="search-results__follow search-results__follow--on">팔로잉</span>
                ) : (
                  <button type="button" className="search-results__follow" onClick={() => onFollow?.(u.id)}>
                    팔로우
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <section className="search-results glass glass--strong" aria-label="가게 검색 결과">
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
    </section>
  )
}
