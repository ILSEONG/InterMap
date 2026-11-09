import { useEffect, useMemo, useState } from 'react'
import { fetchRecap } from '../lib/api'
import type { Recap } from '../lib/api'
import { RECAP_THEMES, defaultThemeId, drawRecapCards, recapAltText } from '../lib/recapCard'
import { shareImages } from '../lib/share'
import { kstMonth, monthLabel } from '../lib/time'
import { ShareIcon } from './PollIcons'
import RecapFlipCard from './RecapFlipCard'
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
  // 서버에서 막 받은 결산
  const [fetched, setFetched] = useState<Recap | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 화면에 보이는 결산과 카드 — 새 카드가 다 그려져야 둘을 한꺼번에 바꾼다.
  // 달·테마를 바꾸는 동안엔 이전 화면(카드나 "후기가 없어요")을 살짝 흐리게 두고, 노란 자리표시는 처음 열 때만
  const [view, setView] = useState<{ recap: Recap; card: Card | null } | null>(null)
  const recap = view?.recap ?? null
  const card = view?.card ?? null
  const [flipped, setFlipped] = useState(false)
  // 고른 테마 — 없으면 달마다 바뀌는 기본 테마
  const [themeId, setThemeId] = useState<string | null>(null)
  const theme = themeId ?? defaultThemeId(month)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // 그리는 중인 테마 — 다 그려지면 view와 맞는다
  const [drawn, setDrawn] = useState<{ recap: Recap; theme: string } | null>(null)
  const loading = !error && (fetched === null || fetched.month !== month || (fetched.places > 0 && (drawn?.recap !== fetched || drawn.theme !== theme)))

  // 넘겨 볼 수 있는 달 — 받은 결산마다 합쳐 둔다 (달을 바꾸는 동안에도 화살표가 꺼지지 않게)
  const [knownMonths, setKnownMonths] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    setError(null)
    fetchRecap(month)
      .then((next) => {
        if (cancelled) return
        // 서버는 요청한 달을 돌려준다 — 화면 비교는 요청한 달 기준으로
        const recapForMonth = { ...next, month }
        setFetched(recapForMonth)
        setKnownMonths((prev) => [...new Set([...prev, ...next.months])])
        if (next.places === 0) setView({ recap: recapForMonth, card: null })
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [month])

  // 카드 그리기 — 결산을 받았거나 테마를 바꿀 때마다 (앞·뒤 상태는 그대로).
  // 이미지를 미리 풀어(decode) 두고 바꿔 끼워서, 바꾸는 순간 빈 프레임이 끼지 않게
  useEffect(() => {
    if (!fetched || fetched.places === 0) return
    let cancelled = false
    drawRecapCards(fetched, theme)
      .then(async ({ front, back }) => {
        const frontUrl = URL.createObjectURL(front)
        const backUrl = URL.createObjectURL(back)
        await Promise.all(
          [frontUrl, backUrl].map((src) => {
            const img = new Image()
            img.src = src
            return img.decode().catch(() => {})
          }),
        )
        if (cancelled) {
          URL.revokeObjectURL(frontUrl)
          URL.revokeObjectURL(backUrl)
          return
        }
        setView({ recap: fetched, card: { front, back, frontUrl, backUrl } })
        setDrawn({ recap: fetched, theme })
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [fetched, theme])

  // 다른 달 카드가 들어오면 앞면부터 (테마만 바꿀 땐 보던 면 그대로)
  const [cardMonth, setCardMonth] = useState<string | null>(null)
  if (card && recap && recap.month !== cardMonth) {
    setCardMonth(recap.month)
    if (cardMonth !== null) setFlipped(false)
  }

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
    const list = new Set([kstMonth(), ...knownMonths])
    list.add(month)
    return [...list].sort().reverse()
  }, [knownMonths, month])
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

        <div className="recap-themes" role="radiogroup" aria-label="카드 테마">
          {RECAP_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={theme === t.id}
              aria-label={t.name}
              title={t.name}
              className={`recap-themes__swatch${theme === t.id ? ' recap-themes__swatch--on' : ''}`}
              style={{ background: t.bg }}
              onClick={() => setThemeId(t.id)}
            >
              <span style={{ background: t.shape }} />
            </button>
          ))}
        </div>

        <div className={`modal-sheet__body recap-sheet__body${loading && recap ? ' recap-sheet__body--loading' : ''}`} aria-busy={loading}>
          {error ? (
            <p className="modal-sheet__error" role="alert">
              {error}
            </p>
          ) : !recap ? (
            <div className="recap-flip recap-flip--loading" role="status" aria-label="결산을 만드는 중" />
          ) : recap.places === 0 ? (
            <div className="recap-empty">
              <p className="recap-empty__title">{monthLabel(recap.month)}엔 남긴 후기가 없어요</p>
              <p className="recap-empty__text">다녀온 가게에 후기를 남기면 장르·동네·별점이 결산 카드로 모여요.</p>
            </div>
          ) : (
            card && (
              <RecapFlipCard
                frontUrl={card.frontUrl}
                backUrl={card.backUrl}
                alt={recapAltText(recap)}
                flipped={flipped}
                onFlippedChange={setFlipped}
              />
            )
          )}
        </div>
        {card && <p className="recap-sheet__hint">카드를 누르거나 옆으로 밀면 {flipped ? '앞면' : '뒷면'}이 보여요</p>}

        <div className="recap-sheet__footer">
          <button
            type="button"
            className="modal-sheet__btn modal-sheet__btn--primary recap-sheet__share"
            onClick={share}
            disabled={!card || busy || loading}
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
