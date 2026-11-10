import { useEffect, useMemo, useRef, useState } from 'react'
import type { Comment, Review, Story } from '../data/model'
import { photoUrl, restaurantKey } from '../lib/api'
import { useOpenProfile } from '../lib/openProfile'
import { timeAgo } from '../lib/time'
import Avatar from './Avatar'
import ReviewCard from './ReviewCard'
import ReviewComments from './ReviewComments'
import './StoryViewer.css'
import { RatingStar } from './Stars'

interface StoryViewerProps {
  // 스토리 띠 순서 그대로. 한 사람의 마지막 후기에서 더 넘기면 다음 사람으로 이어진다
  stories: Story[]
  story: Story | null
  // 가게 평균 별점·평가 수를 내기 위한 전체 후기
  allReviews: Review[]
  // "지도에서 보기" — 스토리를 닫고 그 후기의 가게로 지도를 옮긴다
  onFocusRestaurant: (review: Review) => void
  // 후기별 댓글 — 가게 시트와 같은 데이터를 쓴다
  comments: Record<number, Comment[]>
  // 내 댓글 판별용 로그인 사용자 id
  myUserId?: number
  onAddComment: (reviewId: number, text: string, parentId?: number) => Promise<boolean>
  onDeleteComment: (reviewId: number, commentId: number) => void
  // 찜한 가게 키("이름|주소") 모음 + 별 버튼 토글
  favorites: Set<string>
  onToggleFavorite: (place: { name: string; address: string }) => void
  onClose: () => void
}

// 스토리를 누르면 그 사람의 24시간 내 후기를 한 장씩, 좌우로 넘겨 본다 (인스타그램 스토리 모양).
// 사진이 화면 전체를 덮고, 그 위에 진행 막대·작성자·닫기, 아래에 가게·후기 유리 카드가 뜬다.
// 넘기기는 CSS scroll-snap — 터치·휠·키보드 전부 브라우저가 처리한다.
// 모든 스토리의 후기를 한 트랙에 펼쳐 두고 누른 사람의 첫 후기로 이동한다 — 사람 경계를 넘는 제스처 코드가 필요 없다.
// 진행 막대·작성자 줄은 트랙 밖에 고정해 두고, 지금 보이는 슬라이드(스크롤 위치)를 따라 바뀐다.
export default function StoryViewer({
  stories,
  story,
  allReviews,
  onFocusRestaurant,
  comments,
  myUserId,
  onAddComment,
  onDeleteComment,
  favorites,
  onToggleFavorite,
  onClose,
}: StoryViewerProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const openProfile = useOpenProfile()
  const slides = stories.flatMap((s) => s.reviews.map((review) => ({ story: s, review })))
  const start = story ? slides.findIndex((s) => s.story.id === story.id) : -1

  // 지금 화면에 보이는 슬라이드 index. 다른 스토리를 열면 그 사람의 첫 후기로 되돌린다 (렌더 중 상태 맞추기)
  const [active, setActive] = useState(Math.max(start, 0))
  const [shownStory, setShownStory] = useState(story)
  if (story !== shownStory) {
    setShownStory(story)
    setActive(Math.max(start, 0))
  }

  useEffect(() => {
    if (start < 0) return
    trackRef.current?.children[start]?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [start, story])

  // 보고 있던 사람을 차단·신고해서 그 사람 후기가 빠지면 남의 슬라이드나 빈 화면이 남지 않게 닫는다
  useEffect(() => {
    if (story && start < 0) onClose()
  }, [story, start, onClose])

  // 가게별 이웃 후기 — 넘길 때마다 슬라이드마다 전체 후기를 훑지 않게 한 번만 묶는다
  const neighborsByKey = useMemo(() => {
    const map = new Map<string, Review[]>()
    for (const r of allReviews) {
      if (r.author.owner) continue
      const key = restaurantKey(r.restaurant)
      const list = map.get(key)
      if (list) list.push(r)
      else map.set(key, [r])
    }
    return map
  }, [allReviews])

  if (!story || start < 0) return null

  const current = slides[Math.min(active, slides.length - 1)]
  const ownerSlides = current ? slides.filter((s) => s.story.id === current.story.id) : []
  const position = current ? ownerSlides.findIndex((s) => s.review.id === current.review.id) : 0
  const ownerName = current?.story.name ?? story.name

  return (
    <div className="story-viewer" onClick={onClose} role="dialog" aria-label={`${ownerName}의 후기`}>
      <div className="story-viewer__stage" onClick={(e) => e.stopPropagation()}>
        <div
          ref={trackRef}
          className="story-viewer__track"
          onScroll={(e) => {
            const el = e.currentTarget
            if (el.clientWidth > 0) setActive(Math.round(el.scrollLeft / el.clientWidth))
          }}
        >
          {slides.map(({ story: owner, review }, slideIndex) => {
            const key = restaurantKey(review.restaurant)
            const favored = favorites.has(key)
            const neighbors = neighborsByKey.get(key) ?? []
            const avg = neighbors.reduce((sum, r) => sum + r.rating, 0) / (neighbors.length || 1)
            // 이웃 평가가 이 후기 하나뿐이면 위 별점과 같은 숫자라 굳이 다시 보이지 않는다
            const showNeighbors = neighbors.some((r) => r.id !== review.id)
            const photoPath = review.photoUrls[0]
            return (
              <article
                key={review.id}
                className="story-viewer__slide"
                aria-label={`${owner.name}의 후기 · ${review.restaurant.name}`}
              >
                {photoPath !== undefined ? (
                  <div className="story-viewer__media story-viewer__media--photo">
                    {/* 슬라이드 전부를 한 번에 받지 않되, 지금 장과 양옆 장은 미리 받아 넘길 때 빈 화면이 번쩍이지 않게 */}
                    <img
                      className="story-viewer__photo"
                      src={photoUrl(photoPath)}
                      alt={`${owner.name}님이 올린 사진`}
                      loading={Math.abs(slideIndex - active) <= 1 ? 'eager' : 'lazy'}
                      decoding="async"
                    />
                  </div>
                ) : (
                  <div className="story-viewer__media story-viewer__media--empty" aria-hidden="true">
                    {/* 사진 없는 후기 — 어두운 바탕에 숟가락·포크만 흐리게 */}
                    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20" />
                      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
                    </svg>
                  </div>
                )}

                {/* 사진 칸 위에 얹는 것 — 넘기기 힌트, 사진과 판 경계에 걸친 점수 도장 */}
                <div className="story-viewer__overlay">
                  {slides.length > 1 && (
                    <p className="story-viewer__hint">
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 6l-6 6 6 6" />
                      </svg>
                      좌우로 넘겨서 다음 후기
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </p>
                  )}
                  <span className="story-viewer__stamp" role="img" aria-label={`${owner.name}님 별점 ${review.rating.toFixed(1)}`}>
                    <b aria-hidden="true">{review.rating.toFixed(1)}</b>
                  </span>
                </div>

                {/* 사진 아래 어두운 판 — 가게·후기, 동작 세 개, 댓글. 길어지면 판 안에서 스크롤 */}
                <div className="story-viewer__sheet">
                  <div className="story-viewer__panel">
                    <h2 className="story-viewer__name">{review.restaurant.name}</h2>
                    <p className="story-viewer__meta">
                      {review.restaurant.category} · {review.restaurant.address}
                    </p>
                    {showNeighbors && (
                      <p className="story-viewer__meta">
                        이웃 {neighbors.length}명 평균 <RatingStar />
                        {avg.toFixed(1)}
                      </p>
                    )}
                    {/* 작성자·별점은 위 작성자 줄과 점수 도장이 보여주므로 카드 머리는 CSS에서 숨긴다 */}
                    <ReviewCard review={review} />
                  </div>

                  <div className="story-viewer__actions">
                    <button
                      type="button"
                      className="story-viewer__action"
                      onClick={(e) => {
                        e.stopPropagation()
                        onFocusRestaurant(review)
                      }}
                    >
                      <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z" />
                        <path d="M9 4v13.5M15 6.5V20" />
                      </svg>
                      지도에서 보기
                    </button>
                    <button
                      type="button"
                      className={`story-viewer__action${favored ? ' story-viewer__action--on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleFavorite({ name: review.restaurant.name, address: review.restaurant.address })
                      }}
                      aria-pressed={favored}
                    >
                      <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill={favored ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
                      </svg>
                      {favored ? '찜했어요' : '찜하기'}
                    </button>
                    <button
                      type="button"
                      className="story-viewer__action"
                      onClick={(e) => {
                        e.stopPropagation()
                        const input = document.getElementById(`story-comment-${review.id}`)
                        input?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                        input?.focus({ preventScroll: true })
                      }}
                    >
                      <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.2A8 8 0 1 1 20 12z" />
                      </svg>
                      댓글 {(comments[review.id] ?? []).length || ''}
                    </button>
                  </div>

                  <ReviewComments
                    inline
                    inputId={`story-comment-${review.id}`}
                    comments={comments[review.id] ?? []}
                    myUserId={myUserId}
                    onAdd={(text, parentId) => onAddComment(review.id, text, parentId)}
                    onDelete={(commentId) => onDeleteComment(review.id, commentId)}
                  />
                </div>
              </article>
            )
          })}
        </div>

        <div className="story-viewer__chrome">
          {current && (
            <div
              className="story-viewer__progress"
              role="progressbar"
              aria-label={`스토리 ${position + 1} / ${ownerSlides.length}`}
              aria-valuemin={1}
              aria-valuemax={ownerSlides.length}
              aria-valuenow={position + 1}
            >
              {ownerSlides.map((s, i) => (
                <span key={s.review.id} className={`story-viewer__segment${i <= position ? ' story-viewer__segment--on' : ''}`} />
              ))}
            </div>
          )}

          <div className="story-viewer__header">
            {current &&
              (openProfile ? (
                <button
                  type="button"
                  className="story-viewer__author"
                  onClick={() => openProfile(current.review.author.id)}
                  aria-label={`${ownerName}님 프로필, ${timeAgo(current.review.createdAt)}`}
                >
                  <AuthorContent story={current.story} review={current.review} />
                </button>
              ) : (
                <div className="story-viewer__author">
                  <AuthorContent story={current.story} review={current.review} />
                </div>
              ))}
            <button type="button" className="story-viewer__close" onClick={onClose} aria-label="스토리 닫기">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// 작성자 알약 안쪽 — 동그란 프로필 + 이름 / (주인장 ·) 몇 시간 전
function AuthorContent({ story, review }: { story: Story; review: Review }) {
  return (
    <>
      <Avatar
        className={`story-viewer__avatar tone-${Math.abs(story.id) % 4}`}
        src={story.avatar ?? review.author.avatar}
        name={story.name}
      />
      <span className="story-viewer__author-text">
        <span className="story-viewer__author-name">{story.name}</span>
        <span className="story-viewer__author-time">
          {review.author.owner && '주인장 · '}
          {timeAgo(review.createdAt)}
        </span>
      </span>
    </>
  )
}
