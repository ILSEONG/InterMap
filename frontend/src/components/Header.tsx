import { useEffect, useRef, useState } from 'react'
import './Header.css'

interface HeaderProps {
  onOpenFilter: () => void
  activeGroupCount: number
  query: string
  onQueryChange: (value: string) => void
}

const WORDMARK_COLORS = ['#ff5d73', '#ff7a45', '#2fbfa6', '#8b6bff']

export default function Header({ onOpenFilter, activeGroupCount, query, onQueryChange }: HeaderProps) {
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const letters = ['인', '터', '맵']

  useEffect(() => {
    if (searching) inputRef.current?.focus()
  }, [searching])

  function toggleSearch() {
    if (searching) onQueryChange('')
    setSearching((prev) => !prev)
  }

  return (
    <header className={`app-header${searching ? ' app-header--searching' : ''}`}>
      <button type="button" className="app-header__filter" onClick={onOpenFilter}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 6H20M7 12H17M10 18H14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
        <span className="app-header__filter-label">맵필터</span>
        {activeGroupCount > 0 && <span className="app-header__badge">{activeGroupCount}</span>}
      </button>

      <div className="app-header__center">
        <h1 className="app-header__wordmark" aria-label="인터맵" aria-hidden={searching}>
          {letters.map((letter, i) => (
            <span key={i} style={{ color: WORDMARK_COLORS[i % WORDMARK_COLORS.length] }}>
              {letter}
            </span>
          ))}
        </h1>
        <input
          ref={inputRef}
          type="search"
          className="app-header__search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && toggleSearch()}
          placeholder="가게 이름으로 찾기"
          aria-label="가게 검색"
          tabIndex={searching ? 0 : -1}
        />
      </div>

      <button
        type="button"
        className="app-header__search-toggle"
        onClick={toggleSearch}
        aria-label={searching ? '검색 닫기' : '검색 열기'}
        aria-expanded={searching}
      >
        {searching ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2.6" />
            <path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </header>
  )
}
