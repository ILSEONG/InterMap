import { useEffect, useState } from 'react'
import { useBackLayer } from '../lib/backLayer'
import { shareImages } from '../lib/share'
import { drawTasteCard, TASTE_THEMES } from '../lib/tasteCard'
import type { TasteCardInput } from '../lib/tasteCard'
import { ShareIcon } from './PollIcons'
import './ModalSheet.css'
import './Poll.css'
import './RecapSheet.css'
import './TasteCardSheet.css'

interface TasteCardSheetProps {
  input: TasteCardInput
  onClose: () => void
}

type Card = { blob: Blob; url: string; theme: string }

// 입맛 궁합 공유 — 테마를 고르고 이미지 한 장으로 보낸다 (월간 결산 공유와 같은 흐름)
export default function TasteCardSheet({ input, onClose }: TasteCardSheetProps) {
  const [theme, setTheme] = useState(TASTE_THEMES[0].id)
  const [card, setCard] = useState<Card | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // 안드로이드 뒤로가기는 공유 화면부터 닫는다
  useBackLayer(true, onClose)

  // 테마를 바꾸면 새로 그린다 — 다 그려질 때까지 이전 카드를 그대로 둔다 (깜빡임 없이)
  useEffect(() => {
    let cancelled = false
    drawTasteCard(input, theme)
      .then(async (blob) => {
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.src = url
        await img.decode().catch(() => {})
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        setCard({ blob, url, theme })
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [input, theme])

  useEffect(() => {
    if (!card) return
    return () => URL.revokeObjectURL(card.url)
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

  async function share() {
    if (!card || busy) return
    setBusy(true)
    try {
      const result = await shareImages([{ blob: card.blob, name: 'intermap-taste.png' }], '입맛 궁합')
      if (result === 'saved') setToast('이미지를 저장했어요')
    } catch (e) {
      setToast((e as Error).message || '공유하지 못했어요')
    } finally {
      setBusy(false)
    }
  }

  const loading = !card || card.theme !== theme

  return (
    <div className="modal-layer taste-card-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet modal-sheet--tall recap-sheet" role="dialog" aria-modal="true" aria-labelledby="taste-card-title">
        <header className="modal-sheet__header">
          <h2 id="taste-card-title" className="modal-sheet__title">
            궁합 카드 공유
          </h2>
          <button type="button" className="modal-sheet__icon-btn" onClick={onClose} aria-label="닫기">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="recap-themes" role="radiogroup" aria-label="카드 테마">
          {TASTE_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={theme === t.id}
              aria-label={t.name}
              title={t.name}
              className={`recap-themes__swatch${theme === t.id ? ' recap-themes__swatch--on' : ''}`}
              style={{ background: t.bg }}
              onClick={() => setTheme(t.id)}
            >
              <span style={{ background: t.accent }} />
            </button>
          ))}
        </div>

        <div className={`modal-sheet__body recap-sheet__body${loading && card ? ' recap-sheet__body--loading' : ''}`} aria-busy={loading}>
          {error ? (
            <p className="modal-sheet__error" role="alert">
              {error}
            </p>
          ) : card ? (
            <img className="taste-card__preview" src={card.url} alt={`${input.theirName}님과의 입맛 궁합 ${input.match.score}% 카드`} />
          ) : (
            <div className="recap-flip recap-flip--loading taste-card__placeholder" role="status" aria-label="카드를 만드는 중" />
          )}
        </div>
        <p className="recap-sheet__hint">가게 이름과 각자 준 별점은 카드에 넣지 않아요</p>

        <div className="recap-sheet__footer">
          <button type="button" className="modal-sheet__btn modal-sheet__btn--primary recap-sheet__share taste-card__share" onClick={share} disabled={!card || busy || loading}>
            <ShareIcon size={20} /> {busy ? '준비 중…' : '이미지로 공유하기'}
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
