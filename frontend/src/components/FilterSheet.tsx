import { useEffect, useState } from 'react'
import { CUISINES, toggleCuisine } from '../lib/cuisine'
import CuisineIcon from './CuisineIcon'
import SheetGrip from './SheetGrip'
import type { ReviewFilter } from './TopBar'
import './ModalSheet.css'
import './FilterSheet.css'

interface FilterSheetProps {
  reviewFilter: ReviewFilter
  // 로그인 전이거나 이웃 한 명의 지도를 보는 중엔 "가게" 고르기가 무의미하다 — 업종만 보인다
  showReviewFilter: boolean
  // 서버가 아직 업종을 안 주는 버전이면 업종 고르기를 숨긴다
  showCuisines: boolean
  cuisines: string[]
  // "적용하기"를 눌렀을 때만 부른다 — 그냥 닫으면 고르던 것은 버린다
  onApply: (reviewFilter: ReviewFilter, cuisines: string[]) => void
  onClose: () => void
}

const REVIEW_CHOICES: [ReviewFilter, string][] = [
  ['all', '모든 가게'],
  ['with', '후기 있는 곳'],
]

// 처음 상태 — 후기 있는 곳, 업종은 전부
const DEFAULT_REVIEW: ReviewFilter = 'with'

// 상단 "필터" 칩으로 여는 시트 — 어떤 가게를 볼지(후기 유무)와 업종을 한곳에서 고른다.
// 업종은 "모든 가게"든 "후기 있는 곳"이든 그 안에서 한 번 더 거른다.
export default function FilterSheet({ reviewFilter, showReviewFilter, showCuisines, cuisines, onApply, onClose }: FilterSheetProps) {
  const [review, setReview] = useState(reviewFilter)
  const [picked, setPicked] = useState(cuisines)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const untouched = picked.length === 0 && (!showReviewFilter || review === DEFAULT_REVIEW)

  return (
    <div className="modal-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet filter-sheet" role="dialog" aria-modal="true" aria-labelledby="filter-title">
        <SheetGrip onClose={onClose} />
        <header className="modal-sheet__header">
          <h2 id="filter-title" className="modal-sheet__title">
            필터
          </h2>
          <button
            type="button"
            className="filter-sheet__reset"
            onClick={() => {
              setPicked([])
              if (showReviewFilter) setReview(DEFAULT_REVIEW)
            }}
            disabled={untouched}
          >
            초기화
          </button>
        </header>

        <div className="modal-sheet__body filter-sheet__body">
          {showReviewFilter && (
            <section className="filter-sheet__section">
              <h3 className="filter-sheet__label">가게</h3>
              <div className="filter-sheet__segments" role="radiogroup" aria-label="가게">
                {REVIEW_CHOICES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={review === value}
                    className={`filter-sheet__segment${review === value ? ' filter-sheet__segment--on' : ''}`}
                    onClick={() => setReview(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {showCuisines && (
            <section className="filter-sheet__section">
              <h3 className="filter-sheet__label">업종</h3>
              <div className="filter-sheet__grid">
                {CUISINES.map(([code, label]) => {
                  const on = picked.includes(code)
                  return (
                    <button
                      key={code}
                      type="button"
                      aria-pressed={on}
                      className={`filter-sheet__tile${on ? ' filter-sheet__tile--on' : ''}`}
                      onClick={() => setPicked(toggleCuisine(picked, code))}
                    >
                      <CuisineIcon code={code} />
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          <button type="button" className="modal-sheet__btn filter-sheet__apply" onClick={() => onApply(review, picked)}>
            적용하기
          </button>
        </div>
      </div>
    </div>
  )
}
