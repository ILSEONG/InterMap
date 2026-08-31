import { useState } from 'react'
import type { Review } from '../data/model'
import { photoUrl } from '../lib/api'
import { timeAgo } from '../lib/time'
import Stars from './Stars'

// 시트·스토리 뷰어가 같은 카드를 쓴다. 스타일은 RestaurantSheet.css(.review-card*)
export default function ReviewCard({ review }: { review: Review }) {
  const [lightbox, setLightbox] = useState<number | null>(null)

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
      {review.photoIds.length > 0 && (
        <div className="review-card__photos">
          {review.photoIds.map((id) => (
            <button type="button" key={id} className="review-card__photo" onClick={() => setLightbox(id)} aria-label="사진 크게 보기">
              <img src={photoUrl(id)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {lightbox !== null && (
        <div className="photo-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="사진">
          <img src={photoUrl(lightbox)} alt="" />
        </div>
      )}
    </article>
  )
}
