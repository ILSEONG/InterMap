import { useEffect, useRef, type ReactNode } from 'react'
import Avatar from './Avatar'
import StarIcon from './StarIcon'
import type { PlaceMode } from '../lib/cafe'
import './TopBar.css'

export type SearchMode = 'restaurant' | 'person'
export type ReviewFilter = 'all' | 'with'

interface TopBarProps {
  // 로그인 상태면 닉네임·사진, 아니면 null
  nickname: string | null
  avatar: string | null
  // 사진 없을 때 아바타 바탕색 (다른 화면과 같은 id % 4 색)
  userId: number | null
  onLogin: () => void
  onMyPage: () => void

  // 검색 — 평소엔 누르면 열리는 칸, 열리면 입력칸 + 닫기
  searching: boolean
  onOpenSearch: () => void
  onCloseSearch: () => void
  query: string
  onQueryChange: (value: string) => void
  // Enter(키보드 검색 버튼): 결과 목록은 닫고 키워드·지도 필터는 그대로 둔다
  onSubmit: () => void
  // 검색창에 포커스가 오면 (키워드가 남아 있을 때) 결과 목록을 다시 연다
  onSearchFocus: () => void
  searchMode: SearchMode
  onSearchModeChange: (mode: SearchMode) => void
  // 검색 결과 패널 — 검색칸 바로 아래 붙는다
  results?: ReactNode

  // 팔로잉 현황판. 로그인 전이면 칩을 숨긴다
  showBoard: boolean
  // 팔로우한 사람이 마지막으로 본 뒤 새 후기를 올렸으면 빨간 점
  boardHasNew: boolean
  // 지도에서 한 이웃을 골라 보는 중이면 그 이웃 — 찜한 곳 오른쪽에 이름 칩(누르면 해제)
  selectedPerson: { id: number; name: string; avatar?: string | null } | null
  onClearPerson: () => void
  onOpenBoard: () => void
  // 찜 모드 — 켜면 지도에 내가 찜한 가게만 별로 나온다
  favMode: boolean
  onToggleFavMode: () => void
  // 필터 칩 — 누르면 필터 시트(후기 유무 + 업종)가 열린다 (FilterSheet)
  onOpenFilter: () => void
  // 필터가 걸려 있는지(칩을 진하게), 고른 업종(카페 화면이면 종류·꼬리표) 수(칩의 숫자)
  filterActive: boolean
  filterCount: number

  // 맨 위 전환 — 맛집 / 카페. 검색칸 왼쪽에 둔다 (로그인 전에도 보인다)
  placeMode: PlaceMode
  // 서버가 업종을 안 주는 버전이면 어느 가게가 카페인지 몰라 전환을 숨긴다
  showPlaceMode: boolean
  onPlaceModeChange: (mode: PlaceMode) => void
}

const PLACE_MODES: [PlaceMode, string][] = [
  ['food', '맛집'],
  ['cafe', '카페'],
]

const SEARCH_MODES: [SearchMode, string][] = [
  ['restaurant', '가게'],
  ['person', '이웃'],
]

// 상단 — 검색칸(왼쪽 끝에 맛집/카페 전환, 오른쪽 끝에 내 계정) 한 줄과, 그 아래 팔로잉 현황 · 찜한 곳 · 필터 칩 한 줄.
// 검색을 열면 칩 줄이 가게/사람 토글로 바뀌고 결과가 그 아래 펼쳐진다.
export default function TopBar(props: TopBarProps) {
  const { nickname, avatar, searching, query, searchMode, results } = props
  const cafe = props.showPlaceMode && props.placeMode === 'cafe'
  const placeWord = cafe ? '카페' : '가게'
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    // preventScroll — 초점을 줄 때 브라우저가 페이지를 몇 px 끌어올려 상단 바가 움찔하지 않게
    if (searching) inputRef.current?.focus({ preventScroll: true })
  }, [searching])

  return (
    <div className="topbar">
      <div className="topbar__search">
        {searching ? (
          <>
            <SearchGlyph />
            <input
              ref={inputRef}
              type="search"
              className="topbar__input"
              value={query}
              onChange={(e) => props.onQueryChange(e.target.value)}
              onFocus={props.onSearchFocus}
              onKeyDown={(e) => {
                if (e.key === 'Escape') props.onCloseSearch()
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                  props.onSubmit()
                }
              }}
              enterKeyHint="search"
              placeholder={searchMode === 'restaurant' ? `${placeWord} 이름으로 찾기` : '이웃 이름으로 찾기'}
              aria-label={searchMode === 'restaurant' ? `${placeWord} 이름으로 검색` : '이웃 이름으로 검색'}
            />
            <button type="button" className="topbar__icon-btn" aria-label="검색 닫기" onClick={props.onCloseSearch}>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </>
        ) : (
          <>
            {props.showPlaceMode && (
              <div className="topbar__modes" role="group" aria-label="지도에 보일 곳">
                {PLACE_MODES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`topbar__mode${props.placeMode === value ? ' topbar__mode--on' : ''}`}
                    aria-pressed={props.placeMode === value}
                    onClick={() => props.onPlaceModeChange(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="topbar__open" onClick={props.onOpenSearch}>
              <SearchGlyph />
              <span className="topbar__open-text">{nickname ? `${placeWord}, 이웃 검색` : `${placeWord} 검색`}</span>
            </button>
            {/* 내 계정 — 누르면 바로 마이페이지(로그인 전엔 로그인). 로그아웃은 마이페이지 안에 */}
            <button
              type="button"
              className="topbar__me"
              onClick={nickname ? props.onMyPage : props.onLogin}
              aria-label={nickname ? '마이페이지' : '로그인'}
            >
              {nickname ? (
                <Avatar src={avatar} name={nickname} className="topbar__avatar" />
              ) : (
                <PersonIcon />
              )}
            </button>
          </>
        )}
      </div>

      {searching ? (
        // 이웃 검색은 로그인한 사람만 — 로그인 전에는 고를 대상이 가게뿐이라 토글을 내지 않는다
        !nickname ? null : (
        <div className="topbar__chips" role="group" aria-label="검색 대상">
          {SEARCH_MODES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`topbar__chip${searchMode === value ? ' topbar__chip--dark' : ''}`}
              aria-pressed={searchMode === value}
              onClick={() => props.onSearchModeChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
        )
      ) : !nickname ? null : (
        <div className="topbar__chips-wrap">
          <div className="topbar__chips">
            {props.showBoard && (
              <button
                type="button"
                className={`topbar__chip${props.boardHasNew ? '' : ' topbar__chip--nodot'}`}
                onClick={props.onOpenBoard}
              >
                <FriendsIcon />
                팔로잉
                {props.boardHasNew && <span className="topbar__dot" aria-label="새 후기 있음" />}
              </button>
            )}
            {/* 찜은 로그인한 사람만 */}
            {nickname && (
              <button
                type="button"
                className={`topbar__chip${props.favMode ? ' topbar__chip--on' : ''}`}
                onClick={props.onToggleFavMode}
                aria-pressed={props.favMode}
              >
                <StarIcon filled={props.favMode} size={17} />
                찜한 곳
              </button>
            )}
            {props.selectedPerson && (
              <button
                type="button"
                className="topbar__chip topbar__chip--dark topbar__chip--person"
                onClick={props.onClearPerson}
                aria-label={`${props.selectedPerson.name} 지도 닫기`}
              >
                <Avatar
                  className={`topbar__chip-avatar tone-${Math.abs(props.selectedPerson.id) % 4}`}
                  src={props.selectedPerson.avatar ?? null}
                  name={props.selectedPerson.name}
                />
                <span className="topbar__chip-name">{props.selectedPerson.name}</span>
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className={`topbar__chip topbar__chip--filter${props.filterActive ? ' topbar__chip--dark' : ''}`}
              onClick={props.onOpenFilter}
              aria-haspopup="dialog"
              aria-label={props.filterCount > 0 ? `필터, ${props.filterCount}개 고름` : '필터'}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                <circle cx="16" cy="7" r="2" />
                <circle cx="8" cy="17" r="2" />
              </svg>
              필터
              {props.filterCount > 0 && <span className="topbar__chip-count">{props.filterCount}</span>}
            </button>
          </div>
        </div>
      )}

      {searching && results}
    </div>
  )
}

function SearchGlyph() {
  return (
    <svg
      className="topbar__glyph"
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
    </svg>
  )
}

function FriendsIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c1-3.2 3.5-4.8 6.5-4.8s5.5 1.6 6.5 4.8" />
      <path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.6" />
      <path d="M17.5 15.4c2 .6 3.4 2.2 4 4.6" />
    </svg>
  )
}
