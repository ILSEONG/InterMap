import { useEffect, useState } from 'react'
import type { Notice } from '../lib/api'
import { timeAgo } from '../lib/time'
import Avatar from './Avatar'
import './ModalSheet.css'
import './NoticeSheet.css'
import SheetGrip from './SheetGrip'

interface NoticeSheetProps {
  notices: Notice[]
  // 열었을 때 아직 안 읽은 수 — 위에서부터 그만큼을 새 알림으로 표시한다
  unread: number
  // 내가 붙인 이름이 있으면 그 이름으로
  nameOf: (id: number, nickname: string) => string
  busy: boolean
  onAccept: (userId: number) => void
  onReject: (userId: number) => void
  onOpenProfile: (userId: number) => void
  // 댓글·답글 알림 — 그 후기가 있는 가게를 연다
  onOpenReview: (reviewId: number) => void
  // 위에 프로필이 열려 있으면 잠시 숨긴다
  hidden?: boolean
  onClose: () => void
}

// 한 줄 문구 — 이름과 가게만 굵게
function Line({ notice, name }: { notice: Notice; name: string }) {
  const who = <b>{name}</b>
  switch (notice.type) {
    case 'COMMENT':
      return (
        <>
          {who}님이 <b>{notice.restaurantName}</b> 후기에 댓글을 남겼어요
        </>
      )
    case 'REPLY':
      return <>{who}님이 내 댓글에 답글을 남겼어요</>
    case 'FOLLOW_REQUEST':
      return <>{who}님이 팔로우를 요청했어요</>
    case 'FOLLOW_ACCEPTED':
      return <>{who}님이 팔로우 요청을 수락했어요</>
    default:
      return <>{who}님이 나를 팔로우하기 시작했어요</>
  }
}

// 지도 오른쪽 아래 종 버튼으로 여는 알림 목록 — 댓글·답글·팔로우 요청·새 팔로워
export default function NoticeSheet({
  notices,
  unread,
  nameOf,
  busy,
  onAccept,
  onReject,
  onOpenProfile,
  onOpenReview,
  hidden,
  onClose,
}: NoticeSheetProps) {
  // 여는 순간 "어디까지가 새 알림인지"를 시각으로 붙잡아 둔다 — 읽음 처리가 끝나 0이 돼도,
  // 요청을 수락·거절해 줄이 빠져도 이번에 연 동안은 같은 알림에 새 표시가 남게
  const [freshFrom] = useState(() => (unread > 0 && notices[unread - 1] ? Date.parse(notices[unread - 1].createdAt) : Infinity))

  useEffect(() => {
    if (hidden) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, hidden])

  return (
    <div className="modal-layer notice-layer" hidden={hidden} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet modal-sheet--tall notice" role="dialog" aria-modal="true" aria-labelledby="notice-title">
        <SheetGrip onClose={onClose} />
        <header className="modal-sheet__header">
          <h2 id="notice-title" className="modal-sheet__title">
            알림
          </h2>
          <button type="button" className="modal-sheet__icon-btn notice__close" onClick={onClose} aria-label="닫기">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="modal-sheet__body notice__body">
          {notices.length === 0 ? (
            <div className="notice__empty">
              <p className="notice__empty-title">아직 알림이 없어요</p>
              <p className="notice__empty-text">이웃이 내 후기에 댓글을 남기거나 나를 팔로우하면 여기서 알려드려요.</p>
            </div>
          ) : (
            <ul className="notice__list">
              {notices.map((n) => {
                const name = nameOf(n.actor.id, n.actor.nickname)
                const isComment = n.type === 'COMMENT' || n.type === 'REPLY'
                return (
                  <li key={`${n.type}-${n.actor.id}-${n.createdAt}`} className={`notice__row${Date.parse(n.createdAt) >= freshFrom ? ' notice__row--new' : ''}`}>
                    <button
                      type="button"
                      className="notice__open"
                      onClick={() => (isComment && n.reviewId !== null ? onOpenReview(n.reviewId) : onOpenProfile(n.actor.id))}
                    >
                      <Avatar className={`notice__avatar tone-${Math.abs(n.actor.id) % 4}`} src={n.actor.avatar} name={name} />
                      <span className="notice__text">
                        <span className="notice__line">
                          <Line notice={n} name={name} />
                        </span>
                        {isComment && n.text && <span className="notice__quote">“{n.text}”</span>}
                        <span className="notice__when">{timeAgo(n.createdAt)}</span>
                      </span>
                    </button>
                    {n.type === 'FOLLOW_REQUEST' && (
                      <span className="notice__actions">
                        <button
                          type="button"
                          className="notice__btn notice__btn--primary"
                          onClick={() => onAccept(n.actor.id)}
                          disabled={busy}
                          aria-label={`${name}님의 팔로우 요청 수락`}
                        >
                          수락
                        </button>
                        <button
                          type="button"
                          className="notice__btn"
                          onClick={() => onReject(n.actor.id)}
                          disabled={busy}
                          aria-label={`${name}님의 팔로우 요청 거절`}
                        >
                          거절
                        </button>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
