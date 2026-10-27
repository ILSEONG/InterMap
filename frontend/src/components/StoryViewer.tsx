import { useEffect, useRef, useState } from 'react'
import type { Comment, Review, Story } from '../data/model'
import { photoUrl, restaurantKey } from '../lib/api'
import { useOpenProfile } from '../lib/openProfile'
import { timeAgo } from '../lib/time'
import Avatar from './Avatar'
import ReviewCard from './ReviewCard'
import ReviewComments from './ReviewComments'
import './StoryViewer.css'

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
  onAddComment: (reviewId: number, text: string, parentId?: number) => void
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

  if (!story) return null

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
          {slides.map(({ story: owner, review }) => {
            const key = restaurantKey(review.restaurant)
            const favored = favorites.has(key)
            const neighbors = allReviews.filter((r) => !r.author.owner && restaurantKey(r.restaurant) === key)
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
                    <img src={photoUrl(photoPath)} alt={`${owner.name}님이 올린 사진`} />
                  </div>
                ) : (
                  <div className="story-viewer__media story-viewer__media--empty" aria-hidden="true">
                    {/* 사진 없는 후기 — 시안의 "[사진]" 자리. 회색 바탕에 숟가락·포크만 흐리게 */}
                    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20" />
                      <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />
                    </svg>
                  </div>
                )}

                {/* 힌트 + 카드를 아래에서부터 쌓는다. 카드가 길어지면(댓글을 펴면) 위 헤더 밑까지만 커지고 안에서 스크롤 */}
                <div className="story-viewer__bottom">
                {slides.length > 1 && (
                  <p className="story-viewer__hint">
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
                    </svg>
                    좌우로 넘겨서 다음 후기 보기
                  </p>
                )}

                <div className="story-viewer__card">
                  <div className="story-viewer__panel">
                    <div className="story-viewer__title-row">
                      <h2 className="story-viewer__name">{review.restaurant.name}</h2>
                      <span className="story-viewer__rating">
                        <span aria-hidden="true">★</span>
                        <span className="story-viewer__sr">{owner.name}님 별점 </span>
                        {review.rating.toFixed(1)}
                      </span>
                    </div>
                    <p className="story-viewer__meta">
                      {review.restaurant.category} · {review.restaurant.address}
                    </p>
                    {showNeighbors && (
                      <p className="story-viewer__meta">
                        이웃 {neighbors.length}명 평균 ★{avg.toFixed(1)}
                      </p>
                    )}
                    {/* 작성자·별점은 위 작성자 줄과 별점 칩이 보여주므로 카드 머리는 CSS에서 숨긴다. 본문·사진·추천메뉴만 쓴다 */}
                    <ReviewCard review={review} />
                  </div>

                  {/* --sv-count: 댓글 버튼(아래 ReviewComments의 토글)에 CSS로 "댓글 N"을 그리기 위한 개수 */}
                  <div
                    className="story-viewer__actions"
                    style={{ ['--sv-count' as string]: `"${(comments[review.id] ?? []).length || ''}"` }}
                  >
                    <button
                      type="button"
                      className="story-viewer__action story-viewer__action--primary"
                      onClick={(e) => {
                        e.stopPropagation()
                        onFocusRestaurant(review)
                      }}
                    >
                      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
                        <circle cx="12" cy="9.5" r="2.5" />
                      </svg>
                      지도에서 보기
                    </button>
                    <button
                      type="button"
                      className={`story-viewer__action story-viewer__action--fav${favored ? ' story-viewer__action--on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleFavorite({ name: review.restaurant.name, address: review.restaurant.address })
                      }}
                      aria-pressed={favored}
                    >
                      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill={favored ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
                      </svg>
                      찜하기
                    </button>
                    {/* 댓글 트레이를 그대로 쓴다 — CSS display: contents로 트레이의 "댓글 N개 보기" 토글이 세 번째 동작 버튼 자리에 들어가고,
                        펼친 목록·입력칸은 버튼 줄 아래 한 줄씩 붙는다. 화면 글자는 시안대로 "댓글 N"(스크린리더는 원래 문구를 읽는다) */}
                    <ReviewComments
                      comments={comments[review.id] ?? []}
                      myUserId={myUserId}
                      onAdd={(text, parentId) => onAddComment(review.id, text, parentId)}
                      onDelete={(commentId) => onDeleteComment(review.id, commentId)}
                    />
                  </div>
                </div>
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
