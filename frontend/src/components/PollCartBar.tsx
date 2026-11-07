import { BallotIcon } from './PollIcons'
import './Poll.css'

interface PollCartBarProps {
  count: number
  onOpen: () => void
  onClear: () => void
}

// 투표 후보를 담아 두면 하단 독 바로 위에 뜨는 바 — 눌러서 투표 만들기로
export default function PollCartBar({ count, onOpen, onClear }: PollCartBarProps) {
  return (
    <div className="poll-cart glass" role="region" aria-label="투표 후보">
      <span className="poll-cart__label">
        <BallotIcon size={20} />
        투표 후보 {count}곳
      </span>
      <button type="button" className="poll-cart__go" onClick={onOpen}>
        투표 만들기
      </button>
      <button type="button" className="poll-cart__clear" onClick={onClear} aria-label="담은 후보 모두 비우기">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
