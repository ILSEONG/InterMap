import { useState } from 'react'
import type { Restaurant, FriendGroup } from '../data/mock'
import { friendById, groupById } from '../data/mock'
import './RestaurantSheet.css'

interface RestaurantSheetProps {
  restaurant: Restaurant | null
  groups: FriendGroup[]
  onClose: () => void
  onStartMeetup: (restaurant: Restaurant) => void
}

export default function RestaurantSheet({ restaurant, groups, onClose, onStartMeetup }: RestaurantSheetProps) {
  const [draftComment, setDraftComment] = useState('')
  const [localComments, setLocalComments] = useState<{ id: string; text: string }[]>([])

  const open = restaurant !== null

  const avgRating = restaurant
    ? restaurant.reviews.reduce((sum, r) => sum + r.rating, 0) / (restaurant.reviews.length || 1)
    : 0

  function handleSubmitComment() {
    if (!draftComment.trim()) return
    setLocalComments((prev) => [...prev, { id: `local-${prev.length}`, text: draftComment.trim() }])
    setDraftComment('')
  }

  return (
    <div className={`restaurant-sheet-overlay${open ? ' restaurant-sheet-overlay--open' : ''}`} onClick={onClose}>
      <div
        className="restaurant-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={restaurant ? `${restaurant.name} 상세` : '음식점 상세'}
        aria-hidden={!open}
      >
        {restaurant && (
          <>
            <div className="restaurant-sheet__handle" />
            <button type="button" className="restaurant-sheet__close" onClick={onClose} aria-label="닫기">
              ✕
            </button>

            <div className="restaurant-sheet__scroll">
              <div className="restaurant-sheet__groups">
                {groups
                  .filter((g) => restaurant.groupIds.includes(g.id))
                  .map((g) => (
                    <span key={g.id} className="restaurant-sheet__group-chip" style={{ ['--group-color' as string]: g.color }}>
                      {g.label}
                    </span>
                  ))}
              </div>

              <h2 className="restaurant-sheet__name">
                {restaurant.name}
                {restaurant.closed && <span className="restaurant-sheet__closed-badge">폐업</span>}
              </h2>
              <p className="restaurant-sheet__meta">
                {restaurant.category} · {restaurant.address}
              </p>

              {restaurant.reviews.length > 0 ? (
                <div className="restaurant-sheet__rating">
                  <span className="restaurant-sheet__rating-stars" aria-hidden="true">
                    {'★'.repeat(Math.round(avgRating))}
                    {'☆'.repeat(5 - Math.round(avgRating))}
                  </span>
                  <span className="restaurant-sheet__rating-value">
                    {avgRating.toFixed(1)} · 이웃 {restaurant.reviews.length}명 평가
                  </span>
                </div>
              ) : (
                <p className="restaurant-sheet__rating-value restaurant-sheet__rating-value--empty">아직 평가한 이웃이 없어요</p>
              )}

              <button type="button" className="restaurant-sheet__meetup-cta" onClick={() => onStartMeetup(restaurant)}>
                🎉 여기서 약속잡기
              </button>

              <section className="restaurant-sheet__section">
                <h3 className="restaurant-sheet__section-title">메뉴</h3>
                {restaurant.menu.length > 0 ? (
                  <ul className="restaurant-sheet__menu">
                    {restaurant.menu.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="restaurant-sheet__empty">아직 등록된 메뉴가 없어요.</p>
                )}
              </section>

              <section className="restaurant-sheet__section">
                <h3 className="restaurant-sheet__section-title">이웃들의 후기</h3>
                {restaurant.reviews.length === 0 && <p className="restaurant-sheet__empty">아직 이웃 후기가 없어요. 첫 후기를 남겨보세요!</p>}
                <div className="restaurant-sheet__reviews">
                  {restaurant.reviews.map((review) => {
                    const friend = friendById(review.friendId)
                    const group = friend ? groupById(friend.groupId) : undefined
                    return (
                      <article key={review.id} className="review-card" style={{ ['--group-color' as string]: group?.color ?? '#8B6BFF' }}>
                        <header className="review-card__header">
                          <span className="review-card__avatar">{friend?.initials.slice(0, 1)}</span>
                          <div>
                            <p className="review-card__name">{friend?.name}</p>
                            <p className="review-card__time">{review.postedHoursAgo}시간 전</p>
                          </div>
                          <span className="review-card__rating" aria-hidden="true">
                            {'★'.repeat(review.rating)}
                          </span>
                        </header>
                        <p className="review-card__text">{review.text}</p>
                      </article>
                    )
                  })}
                </div>
              </section>

              <section className="restaurant-sheet__section">
                <h3 className="restaurant-sheet__section-title">댓글</h3>
                <ul className="restaurant-sheet__comments">
                  {restaurant.comments.map((comment) => {
                    const friend = friendById(comment.friendId)
                    return (
                      <li key={comment.id}>
                        <strong>{friend?.name}</strong> {comment.text}
                      </li>
                    )
                  })}
                  {localComments.map((comment) => (
                    <li key={comment.id}>
                      <strong>나</strong> {comment.text}
                    </li>
                  ))}
                </ul>
                <div className="restaurant-sheet__comment-form">
                  <input
                    type="text"
                    value={draftComment}
                    onChange={(e) => setDraftComment(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSubmitComment()}
                    placeholder="댓글을 남겨보세요"
                    aria-label="댓글 입력"
                  />
                  <button type="button" onClick={handleSubmitComment} disabled={!draftComment.trim()}>
                    등록
                  </button>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
