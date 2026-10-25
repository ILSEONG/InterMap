import { useEffect, useRef, type ReactNode } from 'react'
import type { SearchMode } from './Header'
import './SearchDock.css'

export type ReviewFilter = 'all' | 'with' | 'without'

interface SearchDockProps {
  // 검색 모드인지 (검색 버튼을 누르면 true, 닫기를 누르면 false)
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
  reviewFilter: ReviewFilter
  onReviewFilterChange: (value: ReviewFilter) => void
  // 친구 한 명 보기 중엔 후기 필터가 무의미하니 숨긴다
  showReviewFilter: boolean
  // 검색 결과 패널 — 독 바로 위에 붙는다
  results?: ReactNode
}

const REVIEW_FILTERS: [ReviewFilter, string][] = [
  ['all', '전체'],
  ['with', '후기 있음'],
  ['without', '후기 없음'],
]

const SEARCH_MODES: [SearchMode, string][] = [
  ['restaurant', '가게'],
  ['person', '사람'],
]

// 화면 아래 엄지 영역에 떠 있는 유리 독.
// 평소: 후기 필터 + 검색 버튼 / 검색 중: 가게·사람 토글 + 검색창 + 닫기, 그 위에 결과 패널.
export default function SearchDock({
  searching,
  onOpenSearch,
  onCloseSearch,
  query,
  onQueryChange,
  onSubmit,
  onSearchFocus,
  searchMode,
  onSearchModeChange,
  reviewFilter,
  onReviewFilterChange,
  showReviewFilter,
  results,
}: SearchDockProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searching) inputRef.current?.focus()
  }, [searching])

  return (
    <div className="search-dock">
      {searching && results}
      <section className="search-dock__panel glass" aria-label={searching ? '검색' : '검색과 필터'}>
        {searching ? (
          <div className="segmented" role="group" aria-label="검색 대상">
            {SEARCH_MODES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`segmented__item${searchMode === value ? ' segmented__item--active' : ''}`}
                aria-pressed={searchMode === value}
                onClick={() => onSearchModeChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          showReviewFilter && (
            <div className="segmented" role="group" aria-label="후기 유무 필터">
              {REVIEW_FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`segmented__item${reviewFilter === value ? ' segmented__item--active' : ''}`}
                  aria-pressed={reviewFilter === value}
                  onClick={() => onReviewFilterChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          )
        )}

        <div className="search-dock__row">
          {searching ? (
            <>
              <div className="search-dock__field">
                <SearchGlyph />
                <input
                  ref={inputRef}
                  type="search"
                  className="search-dock__input"
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  onFocus={onSearchFocus}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') onCloseSearch()
                    if (e.key === 'Enter') {
                      e.currentTarget.blur()
                      onSubmit()
                    }
                  }}
                  enterKeyHint="search"
                  placeholder={searchMode === 'restaurant' ? '가게 이름으로 찾기' : '사람 이름으로 찾기'}
                  aria-label={searchMode === 'restaurant' ? '가게 이름으로 검색' : '사람 이름으로 검색'}
                />
                {query && (
                  <button
                    type="button"
                    className="search-dock__clear"
                    aria-label="검색어 지우기"
                    onClick={() => {
                      onQueryChange('')
                      inputRef.current?.focus()
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M9 9l6 6M15 9l-6 6" />
                    </svg>
                  </button>
                )}
              </div>
              <button type="button" className="search-dock__close" aria-label="검색 닫기" onClick={onCloseSearch}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </>
          ) : (
            <button type="button" className="search-dock__open" onClick={onOpenSearch}>
              <SearchGlyph />
              가게, 이웃 검색
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function SearchGlyph() {
  return (
    <svg className="search-dock__glyph" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  )
}
