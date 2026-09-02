import { useEffect, useRef } from 'react'
import type { Review, Story } from '../data/model'
import { restaurantKey } from '../lib/api'
import ReviewCard from './ReviewCard'
import Stars from './Stars'
import './StoryViewer.css'

interface StoryViewerProps {
  // 스토리 띠 순서 그대로. 한 사람의 마지막 후기에서 더 넘기면 다음 사람으로 이어진다
  stories: Story[]
  story: Story | null
  // 가게 평균 별점·평가 수를 내기 위한 전체 후기
  allReviews: Review[]
  // "지도에서 보기" — 스토리를 닫고 그 후기의 가게로 지도를 옮긴다
  onFocusRestaurant: (review: Review) => void
  onClose: () => void
}

// 스토리를 누르면 그 사람의 24시간 내 후기를 가게 헤더 + 후기 카드 한 장씩, 좌우로 넘겨 본다.
// 넘기기는 CSS scroll-snap — 터치·휠·키보드 전부 브라우저가 처리한다.
// 모든 스토리의 후기를 한 트랙에 펼쳐 두고 누른 사람의 첫 후기로 이동한다 — 사람 경계를 넘는 제스처 코드가 필요 없다.
export default function StoryViewer({ stories, story, allReviews, onFocusRestaurant, onClose }: StoryViewerProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const slides = stories.flatMap((s) => s.reviews.map((review) => ({ story: s, review })))
  const start = story ? slides.findIndex((s) => s.story.id === story.id) : -1
  useEffect(() => {
    if (start < 0) return
    trackRef.current?.children[start]?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [start, story])

  if (!story) return null

  return (
    <div className="story-viewer" onClick={onClose} role="dialog" aria-label={`${story.name}의 후기`}>
      <button type="button" className="story-viewer__close" onClick={onClose} aria-label="닫기">
        ✕
      </button>
      <div ref={trackRef} className="story-viewer__track" onClick={(e) => e.stopPropagation()}>
        {slides.map(({ story: owner, review }) => {
          const key = restaurantKey(review.restaurant)
          const neighbors = allReviews.filter((r) => !r.author.owner && restaurantKey(r.restaurant) === key)
          const avg = neighbors.reduce((sum, r) => sum + r.rating, 0) / (neighbors.length || 1)
          return (
            <article key={review.id} className="story-viewer__slide">
              <p className="story-viewer__author">{owner.name}의 스토리</p>
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
              <button
                type="button"
                className="story-viewer__map-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  onFocusRestaurant(review)
                }}
              >
                지도에서 보기
              </button>
              <h3 className="restaurant-sheet__section-title">{review.author.owner ? '주인장의 후기' : '이웃들의 후기'}</h3>
              <ReviewCard review={review} />
            </article>
          )
        })}
      </div>
      {slides.length > 1 && <p className="story-viewer__hint">좌우로 넘겨서 다음 후기·스토리 보기</p>}
    </div>
  )
}
