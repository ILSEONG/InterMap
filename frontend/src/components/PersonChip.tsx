import { useState } from 'react'
import type { Restaurant } from '../data/model'
import type { TopPick } from '../lib/topPicks'
import TopPicksCard from './TopPicksCard'
import './PersonChip.css'

interface PersonChipProps {
  name: string
  picks: TopPick[]
  onPick: (restaurant: Restaurant) => void
  onClose: () => void
}

// 스토리 아래 왼쪽 유리 칩. 칩 본체를 누르면 TOP 5가 펼쳐지고, 닫기로 사람 선택을 푼다.
export default function PersonChip({ name, picks, onPick, onClose }: PersonChipProps) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className="person-chip">
      <div className="person-chip__bar glass">
        <button
          type="button"
          className="person-chip__body"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          <span className="person-chip__name">{name}</span>
          <svg
            className={`person-chip__caret${expanded ? ' person-chip__caret--open' : ''}`}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <button type="button" className="person-chip__close" onClick={onClose} aria-label="친구 선택 해제">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {expanded && picks.length > 0 && (
        <TopPicksCard
          className="person-chip__card glass glass--strong"
          name={name}
          picks={picks}
          onPick={(r) => {
            setExpanded(false)
            onPick(r)
          }}
        />
      )}
    </div>
  )
}
