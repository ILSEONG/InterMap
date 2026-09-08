import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Review } from '../data/model'
import { photoUrl } from '../lib/api'
import { useOpenProfile } from '../lib/openProfile'
import { timeAgo } from '../lib/time'
import Stars from './Stars'
import Avatar from './Avatar'

// 시트·스토리 뷰어가 같은 카드를 쓴다. 스타일은 RestaurantSheet.css(.review-card*)
// onEdit이 있으면 (내 후기) 수정 버튼이 붙는다
export default function ReviewCard({ review, onEdit }: { review: Review; onEdit?: () => void }) {
  // 크게 보기: 누른 사진 index. 같은 후기의 사진들을 좌우 스냅으로 넘긴다
  const [lightbox, setLightbox] = useState<number | null>(null)
  // 작성자 프로필 열기 (App이 컨텍스트로 내려준다). 없으면 이름은 눌러도 아무 일 없다.
  const openProfile = useOpenProfile()
  const [shown, setShown] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)
  // 열릴 때 누른 사진으로 바로 이동 (스냅 트랙이라 scrollIntoView 한 번이면 된다)
  useEffect(() => {
    if (lightbox === null) return
    setShown(lightbox)
    trackRef.current?.children[lightbox]?.scrollIntoView({ inline: 'center', block: 'nearest' })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLightbox(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [lightbox])

  return (
    <article
      className={`review-card${review.author.owner ? ' review-card--owner' : ''}`}
      style={{ ['--group-color' as string]: '#8B6BFF' }}
    >
      <header className="review-card__header">
        <button
          type="button"
          className="review-card__profile"
          onClick={() => openProfile?.(review.author.id)}
          disabled={!openProfile}
          aria-label={`${review.author.name}님 프로필`}
        >
          <Avatar className="review-card__avatar" src={review.author.avatar} name={review.author.name} />
          <span>
            <span className="review-card__name">{review.author.name}</span>
            <span className="review-card__time">{timeAgo(review.createdAt)}</span>
          </span>
        </button>
        <span className="review-card__rating">
          <Stars value={review.rating} />
          <em>{review.rating.toFixed(1)}</em>
        </span>
      </header>
      <p className="review-card__text">{review.text}</p>
      {onEdit && (
        <button type="button" className="review-card__edit" onClick={onEdit}>
          수정
        </button>
      )}
      {review.photoIds.length > 0 && (
        <div className="review-card__photos">
          {review.photoIds.map((id, i) => (
            <button type="button" key={id} className="review-card__photo" onClick={() => setLightbox(i)} aria-label="사진 크게 보기">
              <img src={photoUrl(id)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {review.menu && (
        <p className="review-card__menu">
          <span className="review-card__menu-label">추천메뉴</span>
          {review.menu}
        </p>
      )}
      {/* 시트가 transform으로 올라오는 요소라 그 안의 position: fixed는 시트 상자에 갇힌다 — body로 빼서 화면 전체를 덮는다 */}
      {lightbox !== null && createPortal(
        <div className="photo-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="사진">
          <div
            ref={trackRef}
            className="photo-lightbox__track"
            onScroll={(e) => {
              const el = e.currentTarget
              setShown(Math.round(el.scrollLeft / el.clientWidth))
            }}
          >
            {review.photoIds.map((id) => (
              <div key={id} className="photo-lightbox__slide">
                <img src={photoUrl(id)} alt="" />
              </div>
            ))}
          </div>
          {review.photoIds.length > 1 && (
            <p className="photo-lightbox__count">
              {shown + 1} / {review.photoIds.length}
            </p>
          )}
        </div>,
        document.body,
      )}
    </article>
  )
}
