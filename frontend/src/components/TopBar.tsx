import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useBackLayer } from '../lib/backLayer'
import Avatar from './Avatar'
import StarIcon from './StarIcon'
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
  onLogout: () => void
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
  // 지도에서 한 사람을 골라 보는 중이면 켜 둔다
  personSelected: boolean
  onOpenBoard: () => void
  // 찜 모드 — 켜면 지도에 내가 찜한 가게만 별로 나온다
  favMode: boolean
  onToggleFavMode: () => void
  reviewFilter: ReviewFilter
  onReviewFilterChange: (value: ReviewFilter) => void
  // 로그인 전이거나 친구 한 명 보기 중엔 후기 필터가 무의미하니 숨긴다
  showReviewFilter: boolean
}

const FILTER_LABELS: Record<ReviewFilter, string> = {
  all: '모든 가게',
  with: '후기 있는 곳',
}

const SEARCH_MODES: [SearchMode, string][] = [
  ['restaurant', '가게'],
  ['person', '사람'],
]

// 상단 — 검색칸(오른쪽 끝에 내 계정) 한 줄과, 그 아래 팔로잉 현황 · 찜한 곳 · 후기 필터 칩 한 줄.
// 검색을 열면 칩 줄이 가게/사람 토글로 바뀌고 결과가 그 아래 펼쳐진다.
export default function TopBar(props: TopBarProps) {
  const { nickname, avatar, searching, query, searchMode, reviewFilter, results } = props
  const inputRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<'account' | 'filter' | null>(null)
  // 펼친 메뉴는 안드로이드 뒤로가기로 먼저 닫힌다
  useBackLayer(menu !== null, () => setMenu(null))
  const accountRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const filterMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (searching) inputRef.current?.focus()
  }, [searching])

  // 메뉴 밖을 (터치 포함) 누르면 닫는다
  useEffect(() => {
    if (!menu) return
    const anchors = menu === 'account' ? [accountRef] : [filterRef, filterMenuRef]
    const close = (e: PointerEvent) => {
      if (!anchors.some((a) => a.current?.contains(e.target as Node))) setMenu(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menu])

  const pick = (fn: () => void) => () => {
    setMenu(null)
    fn()
  }

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
              placeholder={searchMode === 'restaurant' ? '가게 이름으로 찾기' : '사람 이름으로 찾기'}
              aria-label={searchMode === 'restaurant' ? '가게 이름으로 검색' : '사람 이름으로 검색'}
            />
            {query && (
              <button
                type="button"
                className="topbar__icon-btn topbar__icon-btn--soft"
                aria-label="검색어 지우기"
                onClick={() => {
                  props.onQueryChange('')
                  inputRef.current?.focus()
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9 9l6 6M15 9l-6 6" />
                </svg>
              </button>
            )}
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
            <button type="button" className="topbar__open" onClick={props.onOpenSearch}>
              <SearchGlyph />
              가게, 이웃 검색
            </button>
            <div className="topbar__anchor" ref={accountRef}>
              <button
                type="button"
                className="topbar__me"
                onClick={() => setMenu((m) => (m === 'account' ? null : 'account'))}
                aria-label="내 계정"
                aria-expanded={menu === 'account'}
              >
                {nickname ? (
                  <Avatar src={avatar} name={nickname} className={`topbar__avatar tone-${(props.userId ?? 0) % 4}`} />
                ) : (
                  <PersonIcon />
                )}
              </button>
              {menu === 'account' && (
                <div className="topbar__menu topbar__menu--right" role="menu">
                  {nickname ? (
                    <>
                      <p className="topbar__menu-label">{nickname}님</p>
                      <button type="button" role="menuitem" onClick={pick(props.onMyPage)}>
                        마이페이지
                      </button>
                      <button type="button" role="menuitem" onClick={pick(props.onLogout)}>
                        로그아웃
                      </button>
                    </>
                  ) : (
                    <button type="button" role="menuitem" onClick={pick(props.onLogin)}>
                      로그인
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {searching ? (
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
      ) : !nickname ? null : (
        <div className="topbar__chips-wrap">
          <div className="topbar__chips">
            {props.showBoard && (
              <button
                type="button"
                className={`topbar__chip${props.personSelected ? ' topbar__chip--on' : ''}`}
                onClick={props.onOpenBoard}
              >
                <FriendsIcon />
                팔로잉 현황
                <span
                  className={`topbar__dot${props.boardHasNew ? '' : ' topbar__dot--off'}`}
                  aria-label={props.boardHasNew ? '새 후기 있음' : undefined}
                  aria-hidden={!props.boardHasNew}
                />
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
            {props.showReviewFilter && (
              <div className="topbar__anchor" ref={filterRef}>
                <button
                  type="button"
                  className={`topbar__chip${reviewFilter !== 'all' ? ' topbar__chip--dark' : ''}`}
                  onClick={() => setMenu((m) => (m === 'filter' ? null : 'filter'))}
                  aria-haspopup="menu"
                  aria-expanded={menu === 'filter'}
                >
                  {FILTER_LABELS[reviewFilter]}
                  <svg
                    className="topbar__chevron"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {/* 칩 줄은 가로로 밀리는 스크롤 칸이라 메뉴를 그 밖에 둔다 — 안에 두면 열 때 줄 스크롤이 풀려 칩이 튄다 */}
          {menu === 'filter' && (
            <div className="topbar__menu topbar__menu--filter" role="menu" ref={filterMenuRef}>
              {(Object.keys(FILTER_LABELS) as ReviewFilter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={reviewFilter === value}
                  className={reviewFilter === value ? 'topbar__menu-item--active' : undefined}
                  onClick={pick(() => props.onReviewFilterChange(value))}
                >
                  {FILTER_LABELS[value]}
                  {reviewFilter === value && (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
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
