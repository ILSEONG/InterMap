import { useEffect, useRef, useState } from 'react'
import { useBackLayer } from '../lib/backLayer'
import StarIcon from './StarIcon'
import './Header.css'

export type SearchMode = 'restaurant' | 'person'

interface HeaderProps {
  // 로그인 상태면 닉네임, 아니면 null
  nickname: string | null
  onLogin: () => void
  onLogout: () => void
  onMyPage: () => void
  // 내가 팔로잉하는 사람들. 로그인 전이거나 아직 못 받았으면 null (버튼 숨김)
  following: FollowingPerson[] | null
  selectedPersonId: number | null
  onSelectPerson: (id: number | null) => void
  // 찜 모드 — 켜면 지도에 내가 찜한 가게만 별로 나온다
  favMode: boolean
  onToggleFavMode: () => void
}

export interface FollowingPerson {
  id: number
  name: string
}

// 상단 유리 캡슐 — 내 계정 · 친구 목록 · 인터맵 · 찜 모드.
// 검색은 엄지가 닿는 하단 독(SearchDock)으로 옮겼다.
export default function Header({
  nickname,
  onLogin,
  onLogout,
  onMyPage,
  following,
  selectedPersonId,
  onSelectPerson,
  favMode,
  onToggleFavMode,
}: HeaderProps) {
  const [accountOpen, setAccountOpen] = useState(false)
  const [friendsOpen, setFriendsOpen] = useState(false)
  // 펼친 메뉴는 안드로이드 뒤로가기로 먼저 닫힌다
  useBackLayer(accountOpen, () => setAccountOpen(false))
  useBackLayer(friendsOpen, () => setFriendsOpen(false))
  const accountRef = useRef<HTMLDivElement>(null)
  const friendsRef = useRef<HTMLDivElement>(null)

  // 메뉴 밖을 (터치 포함) 누르면 닫는다
  useEffect(() => {
    if (!accountOpen && !friendsOpen) return
    const close = (e: PointerEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setAccountOpen(false)
      if (!friendsRef.current?.contains(e.target as Node)) setFriendsOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [accountOpen, friendsOpen])

  return (
    <header className="app-header glass">
      <div className="app-header__left">
        <div className="app-header__menu-anchor" ref={accountRef}>
          <button
            type="button"
            className="app-header__icon-btn app-header__icon-btn--filled"
            onClick={() => {
              setFriendsOpen(false)
              setAccountOpen((prev) => !prev)
            }}
            aria-label="내 계정"
            aria-expanded={accountOpen}
          >
            <PersonIcon />
          </button>
          {accountOpen && (
            <div className="app-header__menu" role="menu">
              {nickname ? (
                <>
                  <p className="app-header__menu-label">{nickname}님</p>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAccountOpen(false)
                      onMyPage()
                    }}
                  >
                    마이페이지
                  </button>
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
              )}
            </div>
          )}
        </div>
        {following && (
          <div className="app-header__menu-anchor" ref={friendsRef}>
            <button
              type="button"
              className={`app-header__icon-btn${selectedPersonId !== null ? ' app-header__icon-btn--active' : ''}`}
              onClick={() => {
                setAccountOpen(false)
                setFriendsOpen((prev) => !prev)
              }}
              aria-label="친구 목록"
              aria-expanded={friendsOpen}
            >
              <FriendsIcon />
            </button>
            {friendsOpen && (
              <div className="app-header__menu" role="menu">
                {following.length === 0 ? (
                  <p className="app-header__menu-label">팔로잉한 사람이 없어요</p>
                ) : (
                  following.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selectedPersonId === p.id}
                      className={selectedPersonId === p.id ? 'app-header__menu-item--active' : undefined}
                      onClick={() => {
                        setFriendsOpen(false)
                        onSelectPerson(p.id)
                      }}
                    >
                      {p.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <h1 className="app-header__wordmark">인터맵</h1>

      <button
        type="button"
        className={`app-header__icon-btn app-header__fav${favMode ? ' app-header__fav--on' : ''}`}
        onClick={onToggleFavMode}
        aria-label={favMode ? '찜한 가게만 보기 끄기' : '찜한 가게만 보기'}
        aria-pressed={favMode}
      >
        <StarIcon filled={favMode} size={22} />
      </button>
    </header>
  )
}

function PersonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
    </svg>
  )
}

function FriendsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c1-3.2 3.5-4.8 6.5-4.8s5.5 1.6 6.5 4.8" />
      <path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.6" />
      <path d="M17.5 15.4c2 .6 3.4 2.2 4 4.6" />
    </svg>
  )
}
