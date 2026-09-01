import { useEffect, useRef, useState } from 'react'
import type { Review } from '../data/model'
import { photoUrl } from '../lib/api'
import { timeAgo } from '../lib/time'
import Stars from './Stars'

// 시트·스토리 뷰어가 같은 카드를 쓴다. 스타일은 RestaurantSheet.css(.review-card*)
// onEdit이 있으면 (내 후기) 수정 버튼이 붙는다
export default function ReviewCard({ review, onEdit }: { review: Review; onEdit?: () => void }) {
  // 크게 보기: 누른 사진 index. 같은 후기의 사진들을 좌우 스냅으로 넘긴다
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [shown, setShown] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)
  // 열릴 때 누른 사진으로 바로 이동 (스냅 트랙이라 scrollIntoView 한 번이면 된다)
  useEffect(() => {
    if (lightbox === null) return
    setShown(lightbox)
    trackRef.current?.children[lightbox]?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [lightbox])

  return (
    <article
      className={`review-card${review.author.owner ? ' review-card--owner' : ''}`}
      style={{ ['--group-color' as string]: '#8B6BFF' }}
    >
      <header className="review-card__header">
        <span className="review-card__avatar">{review.author.name.slice(0, 1)}</span>
        <div>
          <p className="review-card__name">{review.author.name}</p>
          <p className="review-card__time">{timeAgo(review.createdAt)}</p>
        </div>
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
      {lightbox !== null && (
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
        </div>
      )}
    </article>
  )
}
