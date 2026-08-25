import './Header.css'

interface HeaderProps {
  onOpenFilter: () => void
  activeGroupCount: number
}

const WORDMARK_COLORS = ['#ff5d73', '#ff7a45', '#2fbfa6', '#8b6bff']

export default function Header({ onOpenFilter, activeGroupCount }: HeaderProps) {
  const letters = ['인', '터', '맵']
  return (
    <header className="app-header">
      <button type="button" className="app-header__filter" onClick={onOpenFilter}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 6H20M7 12H17M10 18H14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
        맵필터
        {activeGroupCount > 0 && <span className="app-header__badge">{activeGroupCount}</span>}
      </button>
      <h1 className="app-header__wordmark" aria-label="인터맵">
        {letters.map((letter, i) => (
          <span key={i} style={{ color: WORDMARK_COLORS[i % WORDMARK_COLORS.length] }}>
            {letter}
          </span>
        ))}
      </h1>
      <span className="app-header__filter app-header__filter--spacer" aria-hidden="true">
        맵필터
      </span>
    </header>
  )
}
