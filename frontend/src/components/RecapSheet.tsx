import { useEffect, useMemo, useState } from 'react'
import { fetchRecap } from '../lib/api'
import type { Recap } from '../lib/api'
import { drawRecapCards, recapAltText } from '../lib/recapCard'
import { shareImages } from '../lib/share'
import { kstMonth, monthLabel } from '../lib/time'
import { ShareIcon } from './PollIcons'
import './ModalSheet.css'
import './Poll.css'
import './RecapSheet.css'

interface RecapSheetProps {
  // 처음 보여 줄 달 ("2026-10"). 없으면 이번 달
  month?: string
  onClose: () => void
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}

// 월간 결산 — 그 달의 숫자를 앞·뒤 카드 이미지로 만들어 보여 주고(누르면 뒤집힘), 인스타 스토리 등으로 보낸다
type Card = { front: Blob; back: Blob; frontUrl: string; backUrl: string }

export default function RecapSheet({ month: initialMonth, onClose }: RecapSheetProps) {
  const [month, setMonth] = useState(initialMonth ?? kstMonth())
  const [recap, setRecap] = useState<Recap | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [card, setCard] = useState<Card | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setRecap(null)
    setCard(null)
    setFlipped(false)
    setError(null)
    fetchRecap(month)
      .then(async (next) => {
        if (cancelled) return
        setRecap(next)
        if (next.places === 0) return
        const { front, back } = await drawRecapCards(next)
        if (!cancelled) setCard({ front, back, frontUrl: URL.createObjectURL(front), backUrl: URL.createObjectURL(back) })
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [month])

  // 미리보기 주소는 카드가 바뀌거나 닫힐 때 푼다
  useEffect(() => {
    if (!card) return
    return () => {
      URL.revokeObjectURL(card.frontUrl)
      URL.revokeObjectURL(card.backUrl)
    }
  }, [card])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  // 넘겨 볼 수 있는 달 — 후기가 있는 달 + 이번 달 (최근 달부터)
  const months = useMemo(() => {
    const list = new Set([kstMonth(), ...(recap?.months ?? [])])
    list.add(month)
    return [...list].sort().reverse()
  }, [recap, month])
  const index = months.indexOf(month)
  const older = months[index + 1]
  const newer = index > 0 ? months[index - 1] : undefined

  async function share() {
    if (!card || busy) return
    setBusy(true)
    try {
      const result = await shareImages(
        [
          { blob: card.front, name: `intermap-${month}-1.png` },
          { blob: card.back, name: `intermap-${month}-2.png` },
        ],
        `${monthLabel(month)} 맛집 결산`,
      )
      if (result === 'saved') setToast('앞·뒤 이미지를 저장했어요')
    } catch (e) {
      setToast((e as Error).message || '공유하지 못했어요')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet modal-sheet--tall recap-sheet" role="dialog" aria-modal="true" aria-labelledby="recap-title">
        <header className="modal-sheet__header">
          <h2 id="recap-title" className="modal-sheet__title">
            월간 결산
          </h2>
          <button type="button" className="modal-sheet__icon-btn" onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </header>

        <nav className="recap-months" aria-label="달 고르기">
          <button type="button" className="recap-months__btn" onClick={() => older && setMonth(older)} disabled={!older} aria-label="이전 달">
            <Chevron dir="left" />
          </button>
          <span className="recap-months__label" aria-live="polite">
            {monthLabel(month)}
          </span>
          <button type="button" className="recap-months__btn" onClick={() => newer && setMonth(newer)} disabled={!newer} aria-label="다음 달">
            <Chevron dir="right" />
          </button>
        </nav>

        <div className="modal-sheet__body recap-sheet__body">
          {error ? (
            <p className="modal-sheet__error" role="alert">
              {error}
            </p>
          ) : !recap || (recap.places > 0 && !card) ? (
            <div className="recap-flip recap-flip--loading" role="status" aria-label="결산을 만드는 중" />
          ) : recap.places === 0 ? (
            <div className="recap-empty">
              <p className="recap-empty__title">{monthLabel(month)}엔 남긴 후기가 없어요</p>
              <p className="recap-empty__text">다녀온 가게에 후기를 남기면 장르·동네·별점이 결산 카드로 모여요.</p>
            </div>
          ) : (
            card && (
              <button
                type="button"
                className={`recap-flip${flipped ? ' recap-flip--back' : ''}`}
                onClick={() => setFlipped((f) => !f)}
                aria-label={flipped ? '앞면 보기' : '뒷면 보기'}
              >
                <span className="recap-flip__inner">
                  <img className="recap-flip__face" src={card.frontUrl} alt={flipped ? '' : recapAltText(recap)} />
                  <img className="recap-flip__face recap-flip__face--back" src={card.backUrl} alt={flipped ? recapAltText(recap) : ''} />
                </span>
              </button>
            )
          )}
        </div>
        {card && <p className="recap-sheet__hint">카드를 누르면 {flipped ? '앞면' : '뒷면'}이 보여요</p>}

        <div className="recap-sheet__footer">
          <button
            type="button"
            className="modal-sheet__btn modal-sheet__btn--primary recap-sheet__share"
            onClick={share}
            disabled={!card || busy}
          >
            <ShareIcon size={20} /> {busy ? '준비 중…' : '앞·뒤 이미지로 공유하기'}
          </button>
        </div>
        {toast && (
          <p className="poll-toast recap-toast" role="status">
            {toast}
          </p>
        )}
      </div>
    </div>
  )
}
