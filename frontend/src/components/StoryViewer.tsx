import type { Review, Story } from '../data/model'
import { restaurantKey } from '../lib/api'
import ReviewCard from './ReviewCard'
import Stars from './Stars'
import './StoryViewer.css'

interface StoryViewerProps {
  story: Story | null
  // 가게 평균 별점·평가 수를 내기 위한 전체 후기
  allReviews: Review[]
  onClose: () => void
}

// 스토리를 누르면 그 사람의 24시간 내 후기를 가게 헤더 + 후기 카드 한 장씩, 좌우로 넘겨 본다.
// 넘기기는 CSS scroll-snap — 터치·휠·키보드 전부 브라우저가 처리한다.
export default function StoryViewer({ story, allReviews, onClose }: StoryViewerProps) {
  if (!story) return null

  return (
    <div className="story-viewer" onClick={onClose} role="dialog" aria-label={`${story.name}의 후기`}>
      <button type="button" className="story-viewer__close" onClick={onClose} aria-label="닫기">
        ✕
      </button>
      <div className="story-viewer__track" onClick={(e) => e.stopPropagation()}>
        {story.reviews.map((review) => {
          const key = restaurantKey(review.restaurant)
          const neighbors = allReviews.filter((r) => !r.author.owner && restaurantKey(r.restaurant) === key)
          const avg = neighbors.reduce((sum, r) => sum + r.rating, 0) / (neighbors.length || 1)
          return (
            <article key={review.id} className="story-viewer__slide">
              <h2 className="restaurant-sheet__name">{review.restaurant.name}</h2>
              <p className="restaurant-sheet__meta">
                {review.restaurant.category} · {review.restaurant.address}
              </p>
              {neighbors.length > 0 ? (
                <div className="restaurant-sheet__rating">
                  <Stars value={avg} />
                  <span className="restaurant-sheet__rating-value">
                    {avg.toFixed(1)} · 이웃 {neighbors.length}명 평가
                  </span>
                </div>
              ) : (
                <p className="restaurant-sheet__rating-value restaurant-sheet__rating-value--empty">아직 평가한 이웃이 없어요</p>
              )}
              <h3 className="restaurant-sheet__section-title">{review.author.owner ? '주인장의 후기' : '이웃들의 후기'}</h3>
              <ReviewCard review={review} />
            </article>
          )
        })}
      </div>
      {story.reviews.length > 1 && <p className="story-viewer__hint">좌우로 넘겨서 {story.reviews.length}개 후기 보기</p>}
    </div>
  )
}
