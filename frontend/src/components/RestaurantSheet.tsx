import { useState } from 'react'
import type { Comment, Restaurant, FriendGroup } from '../data/mock'
import { friendById, groupById } from '../data/mock'
import './RestaurantSheet.css'

interface RestaurantSheetProps {
  restaurant: Restaurant | null
  groups: FriendGroup[]
  onClose: () => void
  onStartMeetup: (restaurant: Restaurant) => void
  onAddReview: (restaurantId: string, rating: number, text: string) => void
  onAddComment: (restaurantId: string, text: string, parentId?: string) => void
}

// 0.1점 단위 별점을 채워진 별 너비로 그린다.
function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-hidden="true">
      <span className="stars__base">★★★★★</span>
      <span className="stars__fill" style={{ width: `${(value / 5) * 100}%` }}>
        ★★★★★
      </span>
    </span>
  )
}

export default function RestaurantSheet({
  restaurant,
  groups,
  onClose,
  onStartMeetup,
  onAddReview,
  onAddComment,
}: RestaurantSheetProps) {
  const open = restaurant !== null

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
            {/* key를 걸어 가게가 바뀌면 작성 중이던 후기·댓글 입력값이 비워지도록 한다 */}
            <SheetBody
              key={restaurant.id}
              restaurant={restaurant}
              groups={groups}
              onStartMeetup={onStartMeetup}
              onAddReview={onAddReview}
              onAddComment={onAddComment}
            />
          </>
        )}
      </div>
    </div>
  )
}

interface SheetBodyProps {
  restaurant: Restaurant
  groups: FriendGroup[]
  onStartMeetup: (restaurant: Restaurant) => void
  onAddReview: (restaurantId: string, rating: number, text: string) => void
  onAddComment: (restaurantId: string, text: string, parentId?: string) => void
}

function SheetBody({ restaurant, groups, onStartMeetup, onAddReview, onAddComment }: SheetBodyProps) {
  const [draftRating, setDraftRating] = useState(5)
  const [draftReview, setDraftReview] = useState('')
  const [draftComment, setDraftComment] = useState('')

  const avgRating = restaurant.reviews.reduce((sum, r) => sum + r.rating, 0) / (restaurant.reviews.length || 1)
  const rootComments = restaurant.comments.filter((c) => !c.parentId)

  function submitReview() {
    if (!draftReview.trim()) return
    onAddReview(restaurant.id, draftRating, draftReview.trim())
    setDraftReview('')
    setDraftRating(5)
  }

  function submitComment() {
    if (!draftComment.trim()) return
    onAddComment(restaurant.id, draftComment.trim())
    setDraftComment('')
  }

  return (
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
          <Stars value={avgRating} />
          <span className="restaurant-sheet__rating-value">
            {avgRating.toFixed(1)} · 이웃 {restaurant.reviews.length}명 평가
          </span>
        </div>
      ) : (
        <p className="restaurant-sheet__rating-value restaurant-sheet__rating-value--empty">아직 평가한 이웃이 없어요</p>
      )}

      <section className="restaurant-sheet__section">
        <h3 className="restaurant-sheet__section-title">이웃들의 후기</h3>
        {restaurant.reviews.length === 0 && (
          <p className="restaurant-sheet__empty">아직 이웃 후기가 없어요. 첫 후기를 남겨보세요!</p>
        )}
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
                    <p className="review-card__time">
                      {review.postedHoursAgo === 0 ? '방금 전' : `${review.postedHoursAgo}시간 전`}
                    </p>
                  </div>
                  <span className="review-card__rating">
                    <Stars value={review.rating} />
                    <em>{review.rating.toFixed(1)}</em>
                  </span>
                </header>
                <p className="review-card__text">{review.text}</p>
              </article>
            )
          })}
        </div>

        <div className="review-form">
          <div className="review-form__stars">
            <Stars value={draftRating} />
            <input
              className="review-form__slider"
              type="range"
              min={0.1}
              max={5}
              step={0.1}
              value={draftRating}
              onChange={(e) => setDraftRating(Number(e.target.value))}
              aria-label="별점"
            />
            <span className="review-form__score">{draftRating.toFixed(1)}</span>
          </div>
          <textarea
            className="review-form__text"
            value={draftReview}
            onChange={(e) => setDraftReview(e.target.value)}
            placeholder="이 가게 어땠어요? 이웃들에게 알려주세요"
            aria-label="후기 입력"
            rows={2}
          />
          <button type="button" className="review-form__submit" onClick={submitReview} disabled={!draftReview.trim()}>
            후기 등록
          </button>
        </div>
      </section>

      <section className="restaurant-sheet__section">
        <h3 className="restaurant-sheet__section-title">댓글</h3>
        <ul className="restaurant-sheet__comments">
          {rootComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              replies={restaurant.comments.filter((c) => c.parentId === comment.id)}
              onReply={(text) => onAddComment(restaurant.id, text, comment.id)}
            />
          ))}
        </ul>
        <div className="restaurant-sheet__comment-form">
          <input
            type="text"
            value={draftComment}
            onChange={(e) => setDraftComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitComment()}
            placeholder="댓글을 남겨보세요"
            aria-label="댓글 입력"
          />
          <button type="button" onClick={submitComment} disabled={!draftComment.trim()}>
            등록
          </button>
        </div>
      </section>

      <button type="button" className="restaurant-sheet__meetup-cta" onClick={() => onStartMeetup(restaurant)}>
        🎉 여기서 약속잡기
      </button>
    </div>
  )
}

interface CommentItemProps {
  comment: Comment
  replies: Comment[]
  onReply: (text: string) => void
}

function CommentItem({ comment, replies, onReply }: CommentItemProps) {
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState('')
  const friend = friendById(comment.friendId)

  function submit() {
    if (!draft.trim()) return
    onReply(draft.trim())
    setDraft('')
    setReplying(false)
  }

  return (
    <li>
      <CommentRow comment={comment}>
        <button type="button" className="comment__reply-toggle" onClick={() => setReplying((prev) => !prev)}>
          {replying ? '취소' : '답글 달기'}
        </button>

        {replying && (
          <div className="restaurant-sheet__comment-form comment__reply-form">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder={`${friend?.name ?? ''}님에게 답글`}
              aria-label="답글 입력"
              autoFocus
            />
            <button type="button" onClick={submit} disabled={!draft.trim()}>
              등록
            </button>
          </div>
        )}

        {replies.length > 0 && (
          <ul className="comment__replies">
            {replies.map((reply) => (
              <li key={reply.id}>
                <CommentRow comment={reply} small />
              </li>
            ))}
          </ul>
        )}
      </CommentRow>
    </li>
  )
}

interface CommentRowProps {
  comment: Comment
  small?: boolean
  children?: React.ReactNode
}

// 프로필 사진 왼쪽, 이름 위 / 내용 아래, 답글은 내용 밑에 붙는 인스타그램식 배치
function CommentRow({ comment, small, children }: CommentRowProps) {
  const friend = friendById(comment.friendId)
  const group = friend ? groupById(friend.groupId) : undefined

  return (
    <div className={`comment${small ? ' comment--small' : ''}`} style={{ ['--group-color' as string]: group?.color ?? '#8B6BFF' }}>
      <span className="comment__avatar" aria-hidden="true">
        {friend?.initials.slice(0, 1)}
      </span>
      <div className="comment__body">
        <p className="comment__author">{friend?.name}</p>
        <p className="comment__text">{comment.text}</p>
        {children}
      </div>
    </div>
  )
}
