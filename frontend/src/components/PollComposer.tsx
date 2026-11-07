import { useEffect, useState } from 'react'
import { POLL_MAX_OPTIONS, POLL_MIN_OPTIONS, createPoll, restaurantKey } from '../lib/api'
import type { PollCandidate, PollView } from '../lib/api'
import { BallotIcon } from './PollIcons'
import './ModalSheet.css'
import './Poll.css'

interface PollComposerProps {
  // 가게 시트에서 담아 둔 후보 (App이 들고 있다 — 시트를 닫았다 열어도 남게)
  candidates: PollCandidate[]
  onCandidatesChange: (next: PollCandidate[]) => void
  // 찜한 가게 — 후보로 바로 더할 수 있게 보여준다
  favorites: PollCandidate[]
  onCreated: (poll: PollView) => void
  onClose: () => void
}

const DURATIONS: [number, string][] = [
  [3, '3시간'],
  [24, '하루'],
  [72, '3일'],
]

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

// "어디 갈래?" 투표 만들기 — 담아 둔 후보에 한마디를 붙이고 마감을 골라 만든다.
// 만들면 App이 투표 화면(PollSheet)을 열어 친구에게 보내기를 이어서 한다.
export default function PollComposer({ candidates, onCandidatesChange, favorites, onCreated, onClose }: PollComposerProps) {
  const [title, setTitle] = useState('')
  const [hours, setHours] = useState(24)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const inCart = new Set(candidates.map(restaurantKey))
  const addable = favorites.filter((f) => !inCart.has(restaurantKey(f)))
  const full = candidates.length >= POLL_MAX_OPTIONS
  const ready = candidates.length >= POLL_MIN_OPTIONS && candidates.length <= POLL_MAX_OPTIONS

  function setNote(key: string, note: string) {
    onCandidatesChange(candidates.map((c) => (restaurantKey(c) === key ? { ...c, note } : c)))
  }

  async function submit() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const poll = await createPoll(title.trim(), hours, candidates.map((c) => ({ ...c, note: c.note?.trim() || undefined })))
      onCreated(poll)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet modal-sheet--tall poll-sheet" role="dialog" aria-modal="true" aria-labelledby="poll-composer-title">
        <header className="modal-sheet__header">
          <h2 id="poll-composer-title" className="modal-sheet__title">
            투표 만들기
          </h2>
          <button type="button" className="modal-sheet__icon-btn" onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </header>

        <div className="modal-sheet__body">
          <p className="modal-sheet__lead">후보를 골라 링크를 보내면, 친구들은 앱이 없어도 바로 고를 수 있어요.</p>
          {error && (
            <p className="modal-sheet__error" role="alert">
              {error}
            </p>
          )}

          <label className="poll-field">
            <span className="poll-field__label">제목</span>
            <input
              className="poll-field__input"
              type="text"
              value={title}
              maxLength={40}
              placeholder="어디 갈래?"
              onChange={(e) => setTitle(e.target.value)}
              enterKeyHint="done"
            />
          </label>

          <h3 className="poll-section-title">
            후보 <span className="poll-section-title__count">{candidates.length}/{POLL_MAX_OPTIONS}</span>
          </h3>
          {candidates.length === 0 ? (
            <p className="poll-hint">
              지도에서 가게를 눌러 <BallotIcon size={15} /> 투표 담기로 후보를 모아요. {POLL_MIN_OPTIONS}곳부터 만들 수 있어요.
            </p>
          ) : (
            <ol className="poll-candidates">
              {candidates.map((c, i) => {
                const key = restaurantKey(c)
                return (
                  <li key={key} className="poll-candidate">
                    <span className="poll-candidate__index" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="poll-candidate__main">
                      <p className="poll-candidate__name">{c.name}</p>
                      <p className="poll-candidate__meta">
                        {c.category} · {c.address}
                      </p>
                      <input
                        className="poll-candidate__note"
                        type="text"
                        value={c.note ?? ''}
                        maxLength={60}
                        placeholder="한마디 (선택) — 예: 웨이팅 짧아요"
                        aria-label={`${c.name} 한마디`}
                        onChange={(e) => setNote(key, e.target.value)}
                        enterKeyHint="done"
                      />
                    </div>
                    <button
                      type="button"
                      className="poll-candidate__remove"
                      onClick={() => onCandidatesChange(candidates.filter((x) => restaurantKey(x) !== key))}
                      aria-label={`${c.name} 빼기`}
                    >
                      <CloseIcon />
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
          {candidates.length === 1 && <p className="poll-hint">한 곳만 더 담으면 만들 수 있어요.</p>}

          {addable.length > 0 && !full && (
            <>
              <h3 className="poll-section-title">찜한 가게에서 더하기</h3>
              <div className="poll-chips">
                {addable.slice(0, 12).map((f) => (
                  <button
                    key={restaurantKey(f)}
                    type="button"
                    className="poll-chip"
                    onClick={() => onCandidatesChange([...candidates, f])}
                  >
                    <span aria-hidden="true">＋</span> {f.name}
                  </button>
                ))}
              </div>
            </>
          )}

          <h3 className="poll-section-title">마감</h3>
          <div className="segmented poll-durations" role="group" aria-label="마감까지">
            {DURATIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`segmented__item${hours === value ? ' segmented__item--active' : ''}`}
                aria-pressed={hours === value}
                onClick={() => setHours(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="modal-sheet__actions">
            <button type="button" className="modal-sheet__btn modal-sheet__btn--primary" onClick={submit} disabled={!ready || busy}>
              {busy ? '만드는 중…' : ready ? `${candidates.length}곳으로 투표 만들기` : `후보를 ${POLL_MIN_OPTIONS}곳 이상 담아주세요`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
