import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchRecap } from '../lib/api'
import type { Recap } from '../lib/api'
import { RECAP_THEMES, defaultThemeId, drawRecapCards, recapAltText } from '../lib/recapCard'
import { cacheKey, memory, queryClient, readCache, writeCache } from '../lib/query'
import { shareImages } from '../lib/share'
import { kstMonth, monthLabel } from '../lib/time'
import { ShareIcon } from './PollIcons'
import RecapFlipCard from './RecapFlipCard'
import './ModalSheet.css'
import './Poll.css'
import './RecapSheet.css'
import SheetGrip from './SheetGrip'

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
type Blobs = { front: Blob; back: Blob }
const toCard = (b: Blobs): Card => ({ ...b, frontUrl: URL.createObjectURL(b.front), backUrl: URL.createObjectURL(b.back) })
// 그린 카드 기억 키 — 테마와 결산 내용이 같으면 같은 카드 (Blob이라 메모리에만)
const cardKey = (r: Recap, theme: string) => `recapCard:${theme}:${JSON.stringify(r)}`
// 결산 숫자는 기기에도 남긴다 (lib/query가 'recap' 키를 저장)
const recapKey = (month: string) => cacheKey('recap', month)
const knownRecap = (month: string) => readCache<Recap>(recapKey(month))

export default function RecapSheet({ month: initialMonth, onClose }: RecapSheetProps) {
  const [month, setMonth] = useState(initialMonth ?? kstMonth())
  // 전에 본 달이면 기억해 둔 결산·카드로 바로 그린다 — 새 값은 뒤에서 받아, 내용이 달라졌을 때만 바꾼다 (lib/query)
  const [initial] = useState(() => {
    const r = knownRecap(month)
    if (!r) return null
    if (r.places === 0) return { recap: r, card: null, key: null }
    const key = cardKey(r, defaultThemeId(month))
    const blobs = memory.get(key) as Blobs | undefined
    return blobs ? { recap: r, card: toCard(blobs), key } : null
  })
  // 서버에서 막 받은 결산
  const [fetched, setFetched] = useState<Recap | null>(() => initial?.recap ?? null)
  const [error, setError] = useState<string | null>(null)
  // 화면에 보이는 결산과 카드 — 새 카드가 다 그려져야 둘을 한꺼번에 바꾼다.
  // 달·테마를 바꾸는 동안엔 이전 화면(카드나 "후기가 없어요")을 살짝 흐리게 두고, 자리표시는 처음 열 때만
  const [view, setView] = useState<{ recap: Recap; card: Card | null } | null>(() =>
    initial ? { recap: initial.recap, card: initial.card } : null,
  )
  const recap = view?.recap ?? null
  const card = view?.card ?? null
  const [flipped, setFlipped] = useState(false)
  // 고른 테마 — 없으면 달마다 바뀌는 기본 테마
  const [themeId, setThemeId] = useState<string | null>(null)
  const theme = themeId ?? defaultThemeId(month)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // 그리는 중인 테마 — 다 그려지면 view와 맞는다
  const [drawn, setDrawn] = useState<{ recap: Recap; theme: string } | null>(() =>
    initial?.card ? { recap: initial.recap, theme: defaultThemeId(month) } : null,
  )
  // 지금 화면에 있는 카드가 어떤 내용·테마로 그린 것인지 — 같은 내용을 새로 받으면 다시 그리지 않는다
  const shownKey = useRef<string | null>(initial?.key ?? null)
  const loading = !error && (fetched === null || fetched.month !== month || (fetched.places > 0 && (drawn?.recap !== fetched || drawn.theme !== theme)))

  // 넘겨 볼 수 있는 달 — 받은 결산마다 합쳐 둔다 (달을 바꾸는 동안에도 화살표가 꺼지지 않게)
  const [knownMonths, setKnownMonths] = useState<string[]>(() => initial?.recap.months ?? [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    const show = (r: Recap) => {
      setFetched(r)
      setKnownMonths((prev) => [...new Set([...prev, ...r.months])])
      if (r.places === 0) setView({ recap: r, card: null })
    }
    const known = knownRecap(month)
    if (known && known !== fetched) show(known)
    // 같은 달을 동시에 여러 번 불러도 요청은 한 번, 실패하면 두 번까지 다시 시도
    queryClient
      .fetchQuery({ queryKey: [...recapKey(month), 'fresh'], queryFn: () => fetchRecap(month), staleTime: 0, gcTime: 0, retry: 2 })
      .then((next) => {
        if (cancelled) return
        // 서버는 요청한 달을 돌려준다 — 화면 비교는 요청한 달 기준으로
        const recapForMonth = { ...next, month }
        // 기억해 둔 것과 내용이 같으면 그대로 둔다 (카드를 다시 그리지 않게)
        if (known && JSON.stringify(known) === JSON.stringify(recapForMonth)) return
        writeCache(recapKey(month), recapForMonth)
        show(recapForMonth)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month])

  // 카드 그리기 — 결산을 받았거나 테마를 바꿀 때마다 (앞·뒤 상태는 그대로).
  // 그린 카드는 내용·테마별로 기억해 두고, 이미지를 미리 풀어(decode) 둔 뒤 바꿔 끼워 빈 프레임이 끼지 않게
  useEffect(() => {
    if (!fetched || fetched.places === 0) return
    const key = cardKey(fetched, theme)
    if (shownKey.current === key) {
      setDrawn({ recap: fetched, theme })
      setView((v) => (v ? { ...v, recap: fetched } : v))
      return
    }
    let cancelled = false
    const cached = memory.get(key) as Blobs | undefined
    const blobs = cached
      ? Promise.resolve(cached)
      : drawRecapCards(fetched, theme).then((b) => {
          memory.set(key, b)
          return b
        })
    blobs
      .then(async (b) => {
        const next = toCard(b)
        await Promise.all(
          [next.frontUrl, next.backUrl].map((src) => {
            const img = new Image()
            img.src = src
            return img.decode().catch(() => {})
          }),
        )
        if (cancelled) {
          URL.revokeObjectURL(next.frontUrl)
          URL.revokeObjectURL(next.backUrl)
          return
        }
        shownKey.current = key
        setView({ recap: fetched, card: next })
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
        <SheetGrip onClose={onClose} />
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
            // 카드를 그리는 동안 — 그 달 테마의 바탕색 그대로(깜빡이지 않게). 카드가 뜨면 같은 색 위에 그림만 얹힌 것처럼 보인다
            <div
              className="recap-flip recap-flip--loading"
              style={{ background: (RECAP_THEMES.find((t) => t.id === theme) ?? RECAP_THEMES[0]).bg }}
              role="status"
              aria-label="결산을 만드는 중"
            />
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
        {/* 자리를 늘 잡아 둔다 — 카드가 뜰 때 이 줄이 생기면 카드 칸이 줄어 카드 크기가 한 번 튄다 */}
        <p className="recap-sheet__hint" style={card ? undefined : { visibility: 'hidden' }} aria-hidden={!card}>
          카드를 누르거나 옆으로 밀면 {flipped ? '앞면' : '뒷면'}이 보여요
        </p>

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
