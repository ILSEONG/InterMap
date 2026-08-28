import { useEffect, useRef, useState } from 'react'
import './Header.css'

interface HeaderProps {
  onOpenFilter: () => void
  activeGroupCount: number
  query: string
  onQueryChange: (value: string) => void
  // 로그인 상태면 닉네임, 아니면 null
  nickname: string | null
  onLogin: () => void
  onSignup: () => void
  onLogout: () => void
}

// 로고 글자색 — AuthModal 등 다른 곳에서 "인터맵"을 로고처럼 칠할 때도 쓴다
export const WORDMARK_COLORS = ['#ff5d73', '#ff7a45', '#2fbfa6', '#8b6bff']

export default function Header({
  onOpenFilter,
  activeGroupCount,
  query,
  onQueryChange,
  nickname,
  onLogin,
  onSignup,
  onLogout,
}: HeaderProps) {
  const [searching, setSearching] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const accountRef = useRef<HTMLDivElement>(null)
  const letters = ['인', '터', '맵']

  useEffect(() => {
    if (searching) inputRef.current?.focus()
  }, [searching])

  // 메뉴 밖을 (터치 포함) 누르면 닫는다
  useEffect(() => {
    if (!accountOpen) return
    const close = (e: PointerEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [accountOpen])

  function toggleSearch() {
    if (searching) onQueryChange('')
    setSearching((prev) => !prev)
  }

  return (
    <header className={`app-header${searching ? ' app-header--searching' : ''}`}>
      <div className="app-header__account" ref={accountRef}>
        <button
          type="button"
          className="app-header__account-toggle"
          onClick={() => setAccountOpen((prev) => !prev)}
          aria-label="내 계정"
          aria-expanded={accountOpen}
        >
          <span aria-hidden="true">👤</span>
        </button>
        {accountOpen && (
          <div className="app-header__account-menu" role="menu">
            {nickname ? (
              <>
                <p className="app-header__account-name">{nickname}님</p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountOpen(false)
                    onLogout()
                  }}
                >
                  로그아웃
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountOpen(false)
                    onLogin()
                  }}
                >
                  로그인
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountOpen(false)
                    onSignup()
                  }}
                >
                  회원가입
                </button>
              </>
            )}
          </div>
        )}
      </div>

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
