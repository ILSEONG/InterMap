import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Review } from '../data/model'
import { photoUrl } from '../lib/api'
import { useOpenProfile } from '../lib/openProfile'
import { useBackLayer } from '../lib/backLayer'
import { canReport, useModeration } from '../lib/moderation'
import { timeAgo } from '../lib/time'
import { STAR_SHAPE } from './Stars'
import Avatar from './Avatar'
import './ReportSheet.css'

// 시트·스토리 뷰어가 같은 카드를 쓴다. 스타일은 RestaurantSheet.css(.review-card*)
// onEdit이 있으면 (내 후기) 수정 버튼이 붙는다
export default function ReviewCard({ review, onEdit }: { review: Review; onEdit?: () => void }) {
  // 크게 보기: 누른 사진 index. 같은 후기의 사진들을 좌우 스냅으로 넘긴다
  const [lightbox, setLightbox] = useState<number | null>(null)
  // 작성자 프로필 열기 (App이 컨텍스트로 내려준다). 없으면 이름은 눌러도 아무 일 없다.
  const openProfile = useOpenProfile()
  // 남의 후기면 신고 버튼 (로그인했을 때만)
  const moderation = useModeration()
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

  // 안드로이드 뒤로가기는 사진부터 닫는다 (아래 가게 시트가 먼저 닫히고 사진만 남지 않게)
  useBackLayer(lightbox !== null, () => setLightbox(null))

  const owner = review.author.owner

  return (
    <article className={`review-card${owner ? ' review-card--owner' : ''}`}>
      <header className="review-card__header">
        <button
          type="button"
          className="review-card__profile"
          onClick={() => openProfile?.(review.author.id)}
          disabled={!openProfile}
          aria-label={`${review.author.name}님 프로필`}
        >
          {/* 사진이 없을 때 첫 글자 칸의 파스텔 색 — 사람마다 고정 */}
          <Avatar
            className={`review-card__avatar tone-${Math.abs(review.author.id) % 4}`}
            src={review.author.avatar}
            name={review.author.name}
          />
          <span className="review-card__who">
            <span className="review-card__name">
              {review.author.name}
              {owner && <span className="review-card__owner-tag">주인장</span>}
            </span>
            <span className="review-card__time">{timeAgo(review.createdAt)}</span>
          </span>
        </button>
        <span className="review-card__rating" role="img" aria-label={`별점 ${review.rating.toFixed(1)}`}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d={STAR_SHAPE} />
          </svg>
          <em>{review.rating.toFixed(1)}</em>
        </span>
        {canReport(moderation, review.author.id) && (
          <button
            type="button"
            className="report-trigger review-card__report"
            onClick={() =>
              moderation.report({ type: 'REVIEW', id: review.id, authorId: review.author.id, authorName: review.author.name })
            }
            aria-label={`${review.author.name}님의 후기 신고`}
          >
            {/* 사이렌 — 반구 몸체 + 받침 + 위로 퍼지는 빛 세 줄 */}
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 18v-5a5 5 0 0 1 10 0v5" />
              <path d="M4.5 18h15v3h-15z" />
              <path d="M12 13v2" />
              <path d="M12 3v2.5M4.6 6.1l1.8 1.6M19.4 6.1l-1.8 1.6" />
            </svg>
          </button>
        )}
        {onEdit && (
          <button type="button" className="review-card__edit" onClick={onEdit}>
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 20h4L19 9l-4-4L4 16z" />
            </svg>
            수정
          </button>
        )}
      </header>
      <p className="review-card__text">{review.text}</p>
      {/* 시트에선 CSS order로 사진이 글 위에 온다 (스토리 뷰어는 글 → 사진 순서 그대로) */}
      {review.photoIds.length > 0 && (
        <div className="review-card__photos">
          {review.photoIds.map((id, i) => (
            <button type="button" key={id} className="review-card__photo" onClick={() => setLightbox(i)} aria-label="사진 크게 보기">
              <img src={photoUrl(review.photoUrls[i])} alt="" loading="lazy" />
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
          <button type="button" className="photo-lightbox__close" onClick={() => setLightbox(null)} aria-label="닫기">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <div
            ref={trackRef}
            className="photo-lightbox__track"
            onScroll={(e) => {
              const el = e.currentTarget
              setShown(Math.round(el.scrollLeft / el.clientWidth))
            }}
          >
            {review.photoIds.map((id, i) => (
              <div key={id} className="photo-lightbox__slide">
                <img src={photoUrl(review.photoUrls[i])} alt="" />
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
