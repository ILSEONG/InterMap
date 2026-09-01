import { useEffect, useMemo, useRef, useState } from 'react'
import type { Comment, Restaurant, FriendGroup, Review } from '../data/model'
import { photoUrl } from '../lib/api'
import ReviewCard from './ReviewCard'
import Stars from './Stars'
import './RestaurantSheet.css'

interface RestaurantSheetProps {
  restaurant: Restaurant | null
  // 이 가게에 달린 주인장 후기. 비어 있으면 영역 자체를 숨긴다
  ownerReviews: Review[]
  // 주인장(admin)으로 로그인한 상태 — 후기 폼이 주인장 후기로 저장된다
  asOwner: boolean
  groups: FriendGroup[]
  onClose: () => void
  onStartMeetup: (restaurant: Restaurant) => void
  // 서버 저장이 끝나면 resolve. 실패하면 reject (입력값을 지우지 않기 위해)
  onAddReview: (restaurantId: string, rating: number, text: string, photos: File[]) => Promise<void>
  // 내 후기 수정. 로그인 사용자 id와 후기 작성자 id가 같을 때만 수정 버튼이 보인다
  myUserId?: number
  onEditReview: (reviewId: number, rating: number, text: string, keepPhotoIds: number[], photos: File[]) => Promise<void>
  onAddComment: (restaurantId: string, text: string, parentId?: string) => void
}

// 후기 한 개에 붙일 수 있는 사진 수 (서버 ReviewController.MAX_PHOTOS와 같게)
const MAX_PHOTOS = 10
// 손잡이를 이보다 아래로 끌어내리면 시트를 닫는다.
const MIN_SHEET_HEIGHT = 140
// 이 속도(px/ms) 이상으로 튕기면 끝까지 펼치거나 닫는다.
const FLICK_VELOCITY = 0.5

export default function RestaurantSheet({
  restaurant,
  ownerReviews,
  asOwner,
  groups,
  onClose,
  onStartMeetup,
  onAddReview,
  myUserId,
  onEditReview,
  onAddComment,
}: RestaurantSheetProps) {
  const open = restaurant !== null
  // 닫힐 때 restaurant이 즉시 null이 되는데 패널은 애니메이션으로 내려간다.
  // 내용을 바로 비우면 빈 패널이 한 프레임 번쩍이므로 마지막 가게를 유지한 채 닫는다.
  const lastRestaurantRef = useRef<Restaurant | null>(null)
  if (restaurant) lastRestaurantRef.current = restaurant
  const shown = restaurant ?? lastRestaurantRef.current

  const sheetRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    startY: number
    startHeight: number
    lastY: number
    lastT: number
    velocity: number
  } | null>(null)
  // null이면 CSS 기본 높이(마커 바로 아래까지). 손잡이를 끌면 사용자가 정한 높이로.
  const [height, setHeight] = useState<number | null>(null)
  // 드래그 중에는 height transition을 꺼서 손가락을 그대로 따라오게 한다.
  const [dragging, setDragging] = useState(false)

  // 열릴 때마다 이전에 끌어놓은 높이를 버리고 기본 높이에서 시작한다.
  // (닫힌 상태에서 리셋되므로 화면에는 보이지 않음)
  const wasOpenRef = useRef(open)
  if (open !== wasOpenRef.current) {
    wasOpenRef.current = open
    if (open && height !== null) setHeight(null)
  }

  function onGrabDown(e: React.PointerEvent<HTMLDivElement>) {
    const sheet = sheetRef.current
    if (!sheet) return
    dragRef.current = {
      startY: e.clientY,
      startHeight: sheet.getBoundingClientRect().height,
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
    }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onGrabMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    const dt = e.timeStamp - drag.lastT
    if (dt > 0) {
      // 위로 움직이면 양수. 최근 움직임 위주로 지수 평활해 놓는 순간의 속도를 얻는다.
      drag.velocity = 0.2 * drag.velocity + 0.8 * ((drag.lastY - e.clientY) / dt)
      drag.lastY = e.clientY
      drag.lastT = e.timeStamp
    }
    const next = drag.startHeight + (drag.startY - e.clientY)
    setHeight(Math.min(Math.max(next, MIN_SHEET_HEIGHT), window.innerHeight * 0.92))
  }

  function onGrabUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (!drag) return
    // 위로 튕기면 끝까지 펼친다 (transition이 다시 켜져 부드럽게 올라감)
    if (drag.velocity > FLICK_VELOCITY) {
      setHeight(window.innerHeight * 0.92)
      return
    }
    // 아래로 튕기거나 최소 높이 아래로 끌어내리면 닫는다.
    if (drag.velocity < -FLICK_VELOCITY || drag.startHeight + (drag.startY - e.clientY) < MIN_SHEET_HEIGHT) {
      onClose()
    }
  }

  return (
    <div className={`restaurant-sheet-overlay${open ? ' restaurant-sheet-overlay--open' : ''}`} onClick={onClose}>
      <div
        ref={sheetRef}
        className={`restaurant-sheet${dragging ? ' restaurant-sheet--dragging' : ''}`}
        style={height !== null ? { height } : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={shown ? `${shown.name} 상세` : '음식점 상세'}
        aria-hidden={!open}
      >
        {shown && (
          <>
            <div
              className="restaurant-sheet__grab"
              onPointerDown={onGrabDown}
              onPointerMove={onGrabMove}
              onPointerUp={onGrabUp}
              onPointerCancel={onGrabUp}
            >
              <div className="restaurant-sheet__handle" />
            </div>
            <button type="button" className="restaurant-sheet__close" onClick={onClose} aria-label="닫기">
              ✕
            </button>
            {/* key를 걸어 가게가 바뀌면 작성 중이던 후기·댓글 입력값이 비워지도록 한다 */}
            <SheetBody
              key={shown.id}
              restaurant={shown}
              ownerReviews={ownerReviews}
              asOwner={asOwner}
              groups={groups}
              onStartMeetup={onStartMeetup}
              onAddReview={onAddReview}
              myUserId={myUserId}
              onEditReview={onEditReview}
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
  ownerReviews: Review[]
  asOwner: boolean
  groups: FriendGroup[]
  onStartMeetup: (restaurant: Restaurant) => void
  // 서버 저장이 끝나면 resolve. 실패하면 reject (입력값을 지우지 않기 위해)
  onAddReview: (restaurantId: string, rating: number, text: string, photos: File[]) => Promise<void>
  // 내 후기 수정. 로그인 사용자 id와 후기 작성자 id가 같을 때만 수정 버튼이 보인다
  myUserId?: number
  onEditReview: (reviewId: number, rating: number, text: string, keepPhotoIds: number[], photos: File[]) => Promise<void>
  onAddComment: (restaurantId: string, text: string, parentId?: string) => void
}

function SheetBody({
  restaurant,
  ownerReviews,
  asOwner,
  groups,
  onStartMeetup,
  onAddReview,
  myUserId,
  onEditReview,
  onAddComment,
}: SheetBodyProps) {
  const [draftRating, setDraftRating] = useState(5)
  const [draftReview, setDraftReview] = useState('')
  const [draftComment, setDraftComment] = useState('')
  const [draftPhotos, setDraftPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  // 수정 중인 내 후기. 같은 폼을 재사용 — 기존 사진은 keepPhotoIds로, 새 사진은 draftPhotos로
  const [editing, setEditing] = useState<Review | null>(null)
  const [keepPhotoIds, setKeepPhotoIds] = useState<number[]>([])
  const formRef = useRef<HTMLDivElement>(null)
  // 선택한 사진 미리보기 URL. 목록이 바뀔 때마다 이전 URL은 해제한다
  const previews = useMemo(() => draftPhotos.map((f) => URL.createObjectURL(f)), [draftPhotos])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  const avgRating = restaurant.reviews.reduce((sum, r) => sum + r.rating, 0) / (restaurant.reviews.length || 1)
  const rootComments = restaurant.comments.filter((c) => !c.parentId)

  function resetForm() {
    setDraftReview('')
    setDraftRating(5)
    setDraftPhotos([])
    setEditing(null)
    setKeepPhotoIds([])
  }

  function fillFrom(review: Review) {
    setEditing(review)
    setDraftRating(review.rating)
    setDraftReview(review.text)
    setDraftPhotos([])
    setKeepPhotoIds(review.photoIds)
  }

  function startEdit(review: Review) {
    fillFrom(review)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  // 한 가게에 후기는 하나만 (서버도 409로 막는다). 이미 썼으면 폼에 그 내용을 채워 수정 모드로 연다.
  const myReview =
    myUserId === undefined ? undefined : [...restaurant.reviews, ...ownerReviews].find((r) => r.author.id === myUserId)
  // 후기 목록이 나중에 오거나 방금 등록·수정해서 myReview가 바뀌면 다시 채운다. 편집 중엔 입력을 덮어쓰지 않는다.
  useEffect(() => {
    if (myReview && !editing) fillFrom(myReview)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myReview, editing])

  // 내 후기면 수정 버튼을 붙인다
  const editHandler = (review: Review) =>
    myUserId !== undefined && review.author.id === myUserId ? () => startEdit(review) : undefined

  async function submitReview() {
    if (!draftReview.trim() || submitting) return
    setSubmitting(true)
    try {
      if (editing) await onEditReview(editing.id, draftRating, draftReview.trim(), keepPhotoIds, draftPhotos)
      else await onAddReview(restaurant.id, draftRating, draftReview.trim(), draftPhotos)
      resetForm()
    } catch {
      // App이 이미 alert로 알렸다. 입력값은 그대로 둔다
    } finally {
      setSubmitting(false)
    }
  }

  function addPhotos(list: FileList | null) {
    if (!list) return
    setDraftPhotos((prev) => [...prev, ...Array.from(list)].slice(0, MAX_PHOTOS - keepPhotoIds.length))
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
          {restaurant.reviews.map((review) => (
            <ReviewCard key={review.id} review={review} onEdit={editHandler(review)} />
          ))}
        </div>

        <div className="review-form" ref={formRef}>
          {editing && <p className="review-form__editing">내가 남긴 후기 — 고친 뒤 수정 완료를 눌러주세요</p>}
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
            placeholder={asOwner ? '주인장으로 남기는 후기 — 모두에게 보여요' : '이 가게 어땠어요? 이웃들에게 알려주세요'}
            aria-label="후기 입력"
            rows={2}
          />
          <div className="review-form__photos">
            {keepPhotoIds.map((id) => (
              <span key={id} className="review-form__thumb">
                <img src={photoUrl(id)} alt="올려둔 사진" />
                <button type="button" onClick={() => setKeepPhotoIds((prev) => prev.filter((k) => k !== id))} aria-label="사진 빼기">
                  ✕
                </button>
              </span>
            ))}
            {previews.map((url, i) => (
              <span key={url} className="review-form__thumb">
                <img src={url} alt={`선택한 사진 ${i + 1}`} />
                <button
                  type="button"
                  onClick={() => setDraftPhotos((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="사진 빼기"
                >
                  ✕
                </button>
              </span>
            ))}
            {keepPhotoIds.length + draftPhotos.length < MAX_PHOTOS && (
              <label className="review-form__add-photo">
                📷 사진
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    addPhotos(e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
            )}
          </div>
          <div className="review-form__actions">
            {editing && (
              <button type="button" className="review-form__cancel" onClick={resetForm} disabled={submitting}>
                되돌리기
              </button>
            )}
            <button
              type="button"
              className="review-form__submit"
              onClick={submitReview}
              disabled={!draftReview.trim() || submitting}
            >
              {submitting ? '저장 중…' : editing ? '수정 완료' : asOwner ? '주인장 후기 등록' : '후기 등록'}
            </button>
          </div>
        </div>
      </section>

      {ownerReviews.length > 0 && (
        <section className="restaurant-sheet__section">
          <h3 className="restaurant-sheet__section-title">주인장의 후기</h3>
          <div className="restaurant-sheet__reviews">
            {ownerReviews.map((review) => (
              <ReviewCard key={review.id} review={review} onEdit={editHandler(review)} />
            ))}
          </div>
        </section>
      )}

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
              placeholder={`${comment.authorName}님에게 답글`}
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
  return (
    <div className={`comment${small ? ' comment--small' : ''}`} style={{ ['--group-color' as string]: '#8B6BFF' }}>
      <span className="comment__avatar" aria-hidden="true">
        {comment.authorName.slice(0, 1)}
      </span>
      <div className="comment__body">
        <p className="comment__author">{comment.authorName}</p>
        <p className="comment__text">{comment.text}</p>
        {children}
      </div>
    </div>
  )
}
