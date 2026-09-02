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

// 스토리 아래 왼쪽 칩. 칩 본체를 누르면 TOP 5가 펼쳐지고, ✕로 사람 선택을 푼다.
export default function PersonChip({ name, picks, onPick, onClose }: PersonChipProps) {
  const [expanded, setExpanded] = useState(true)
  return (
    <div className="person-chip">
      <div className="person-chip__bar">
        <button
          type="button"
          className="person-chip__body"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          {name}
          <span className="person-chip__caret" aria-hidden="true">
            {expanded ? '▴' : '▾'}
          </span>
        </button>
        <button type="button" className="person-chip__close" onClick={onClose} aria-label="친구 선택 해제">
          ✕
        </button>
      </div>
      {expanded && picks.length > 0 && (
        <TopPicksCard
          className="person-chip__card"
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
