import { useEffect, useState } from 'react'
import { CUISINES, toggleCuisine } from '../lib/cuisine'
import { CAFE_KINDS, CAFE_TAGS, toggleCode } from '../lib/cafe'
import CuisineIcon from './CuisineIcon'
import SheetGrip from './SheetGrip'
import type { ReviewFilter } from './TopBar'
import './ModalSheet.css'
import './FilterSheet.css'

interface FilterSheetProps {
  // 카페 화면에서 열었는지 — 업종 대신 카페의 종류(카페·베이커리·디저트)와 꼬리표를 고른다
  cafe: boolean
  reviewFilter: ReviewFilter
  // "초기화"가 돌아가는 값 — 맛집은 후기 있는 곳. 카페는 이웃의 카페 후기가 아직 없으면 모든 카페
  defaultReviewFilter: ReviewFilter
  // 로그인 전이거나 이웃 한 명의 지도를 보는 중엔 "가게" 고르기가 무의미하다 — 업종만 보인다
  showReviewFilter: boolean
  // 서버가 아직 업종(카페 화면이면 종류)을 안 주는 버전이면 그 고르기를 숨긴다
  showKinds: boolean
  // 고른 업종 코드들 (카페 화면이면 종류 코드들)
  kinds: string[]
  // 카페 화면: 이웃이 후기에 고른 꼬리표로 거르기. 꼬리표가 달린 후기가 아직 하나도 없으면 숨긴다
  showTags: boolean
  tags: string[]
  // "적용하기"를 눌렀을 때만 부른다 — 그냥 닫으면 고르던 것은 버린다
  onApply: (reviewFilter: ReviewFilter, kinds: string[], tags: string[]) => void
  onClose: () => void
}

// 상단 "필터" 칩으로 여는 시트 — 어떤 가게를 볼지(후기 유무)와 업종을 한곳에서 고른다.
// 업종은 "모든 가게"든 "후기 있는 곳"이든 그 안에서 한 번 더 거른다.
// 카페 화면에서는 같은 자리에 카페의 종류가 오고, 그 아래 이웃이 후기에 좋다고 고른 점("작업·공부" …)이 붙는다.
export default function FilterSheet({
  cafe,
  reviewFilter,
  defaultReviewFilter,
  showReviewFilter,
  showKinds,
  kinds,
  showTags,
  tags,
  onApply,
  onClose,
}: FilterSheetProps) {
  const [review, setReview] = useState(reviewFilter)
  const [picked, setPicked] = useState(kinds)
  const [pickedTags, setPickedTags] = useState(tags)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const untouched = picked.length === 0 && pickedTags.length === 0 && (!showReviewFilter || review === defaultReviewFilter)
  const place = cafe ? '카페' : '가게'
  const options = cafe ? CAFE_KINDS : CUISINES
  const toggle = (code: string) => setPicked(cafe ? toggleCode(CAFE_KINDS, picked, code) : toggleCuisine(picked, code))

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
              setPickedTags([])
              if (showReviewFilter) setReview(defaultReviewFilter)
            }}
            disabled={untouched}
          >
            초기화
          </button>
        </header>

        <div className="modal-sheet__body filter-sheet__body">
          {showReviewFilter && (
            <section className="filter-sheet__section">
              <h3 className="filter-sheet__label">{place}</h3>
              <div className="filter-sheet__segments" role="radiogroup" aria-label={place}>
                {(['all', 'with'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={review === value}
                    className={`filter-sheet__segment${review === value ? ' filter-sheet__segment--on' : ''}`}
                    onClick={() => setReview(value)}
                  >
                    {value === 'all' ? `모든 ${place}` : '후기 있는 곳'}
                  </button>
                ))}
              </div>
            </section>
          )}

          {showKinds && (
            <section className="filter-sheet__section">
              <h3 className="filter-sheet__label">{cafe ? '종류' : '업종'}</h3>
              <div className={`filter-sheet__grid${cafe ? ' filter-sheet__grid--three' : ''}`}>
                {options.map(([code, label]) => {
                  const on = picked.includes(code)
                  return (
                    <button
                      key={code}
                      type="button"
                      aria-pressed={on}
                      className={`filter-sheet__tile${on ? ' filter-sheet__tile--on' : ''}`}
                      onClick={() => toggle(code)}
                    >
                      <CuisineIcon code={code} />
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {cafe && showTags && (
            <section className="filter-sheet__section">
              <h3 className="filter-sheet__label">이웃이 좋다고 한 점</h3>
              <div className="filter-sheet__chips">
                {CAFE_TAGS.map(([code, label]) => {
                  const on = pickedTags.includes(code)
                  return (
                    <button
                      key={code}
                      type="button"
                      aria-pressed={on}
                      className={`filter-sheet__chip${on ? ' filter-sheet__chip--on' : ''}`}
                      onClick={() => setPickedTags(toggleCode(CAFE_TAGS, pickedTags, code))}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          <button type="button" className="modal-sheet__btn filter-sheet__apply" onClick={() => onApply(review, picked, pickedTags)}>
            적용하기
          </button>
        </div>
      </div>
    </div>
  )
}
