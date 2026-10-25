import { useState } from 'react'
import type { Comment } from '../data/model'
import { useOpenProfile } from '../lib/openProfile'

interface ReviewCommentsProps {
  comments: Comment[]
  // 로그인 사용자 id — 내 댓글에만 삭제 버튼이 보인다
  myUserId?: number
  onAdd: (text: string, parentId?: number) => void
  onDelete: (commentId: number) => void
}

// 위로 보내기 화살표 — 댓글·답글 등록 버튼
function SendIcon() {
  return (
    <svg className="comment__send-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  )
}

// 후기 카드 아래에 붙는 댓글 트레이 — 후기 단위로 접고 편다.
// 접힌 상태에선 "댓글 N개 보기"(없으면 "댓글 달기")만 보이고, 펴면 목록과 입력이 나온다.
// 가게 시트와 스토리 뷰어가 같이 쓴다. 스타일은 RestaurantSheet.css에 있다.
export default function ReviewComments({ comments, myUserId, onAdd, onDelete }: ReviewCommentsProps) {
  const [open, setOpen] = useState(false)
  const [writing, setWriting] = useState(false)
  const [draft, setDraft] = useState('')
  const roots = comments.filter((c) => !c.parentId)

  function stopWriting() {
    setDraft('')
    setWriting(false)
  }

  // 쓰다 취소했는데 보여줄 댓글도 없으면 빈 트레이가 남지 않게 같이 접는다
  function cancelWriting() {
    stopWriting()
    if (comments.length === 0) setOpen(false)
  }

  function toggleOpen() {
    if (open) {
      stopWriting()
      setOpen(false)
      return
    }
    setOpen(true)
    // 댓글이 하나도 없으면 펴자마자 바로 쓸 수 있게
    if (comments.length === 0) setWriting(true)
  }

  function submit() {
    if (!draft.trim()) return
    onAdd(draft.trim())
    stopWriting()
  }

  // 펼친 상태에서도 개수를 보여준다 (펼침 여부는 aria-expanded와 화살표로)
  const toggleLabel = open
    ? comments.length > 0
      ? `댓글 ${comments.length}개`
      : '댓글 접기'
    : comments.length > 0
      ? `댓글 ${comments.length}개 보기`
      : '댓글 달기'

  // 자식 순서(펼침 토글 → 목록 → 댓글 달기/취소 토글 → 입력칸)는 스토리 뷰어 CSS가 기대는 구조라 그대로 둔다
  return (
    <div className="review-comments">
      {/* 펼침 화살표는 시트 CSS가 그린다 (스토리 뷰어는 이 버튼의 ::before/::after를 자체 아이콘·문구로 쓴다) */}
      <button type="button" className="comment__reply-toggle comment__tray-toggle" onClick={toggleOpen} aria-expanded={open}>
        {toggleLabel}
      </button>
      {open && (
        <>
          {roots.length > 0 && (
            <ul className="restaurant-sheet__comments">
              {roots.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  replies={comments.filter((c) => c.parentId === comment.id)}
                  myUserId={myUserId}
                  onReply={(text) => onAdd(text, comment.id)}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          )}
          <button
            type="button"
            className={`comment__reply-toggle comment__compose${writing ? ' comment__compose--cancel' : ''}`}
            onClick={() => (writing ? cancelWriting() : setWriting(true))}
          >
            {writing ? '취소' : '댓글 달기'}
            {!writing && (
              <span className="comment__compose-send" aria-hidden="true">
                <SendIcon />
              </span>
            )}
          </button>
          {writing && (
            <div className="restaurant-sheet__comment-form">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                  if (e.key === 'Escape') cancelWriting()
                }}
                placeholder="이 후기에 댓글 남기기"
                aria-label="댓글 입력"
                autoFocus
              />
              <button type="button" className="comment__send" onClick={submit} disabled={!draft.trim()}>
                <SendIcon />
                <span className="comment__send-label">등록</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface CommentItemProps {
  comment: Comment
  replies: Comment[]
  myUserId?: number
  onReply: (text: string) => void
  onDelete: (commentId: number) => void
}

function CommentItem({ comment, replies, myUserId, onReply, onDelete }: CommentItemProps) {
  const [replying, setReplying] = useState(false)
  const [draft, setDraft] = useState('')

  function close() {
    setDraft('')
    setReplying(false)
  }

  function submit() {
    if (!draft.trim()) return
    onReply(draft.trim())
    close()
  }

  function remove() {
    const warning = replies.length > 0 ? '이 댓글을 지울까요? 답글도 함께 지워져요.' : '이 댓글을 지울까요?'
    if (window.confirm(warning)) onDelete(comment.id)
  }

  const mine = myUserId !== undefined && comment.authorId === myUserId

  return (
    <li>
      <CommentRow comment={comment}>
        <div className="comment__actions">
          <button type="button" className="comment__reply-toggle" onClick={() => (replying ? close() : setReplying(true))}>
            {replying ? '취소' : '답글 달기'}
          </button>
          {mine && (
            <button type="button" className="comment__reply-toggle comment__reply-toggle--danger" onClick={remove}>
              삭제
            </button>
          )}
        </div>

        {replying && (
          <div className="restaurant-sheet__comment-form comment__reply-form">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') close()
              }}
              placeholder={`${comment.authorName}님에게 답글`}
              aria-label="답글 입력"
              autoFocus
            />
            <button type="button" className="comment__send" onClick={submit} disabled={!draft.trim()}>
              <SendIcon />
              <span className="comment__send-label">등록</span>
            </button>
          </div>
        )}

        {replies.length > 0 && (
          <ul className="comment__replies">
            {replies.map((reply) => (
              <li key={reply.id}>
                <CommentRow comment={reply} small>
                  {myUserId !== undefined && reply.authorId === myUserId && (
                    <div className="comment__actions">
                      <button
                        type="button"
                        className="comment__reply-toggle comment__reply-toggle--danger"
                        onClick={() => window.confirm('이 답글을 지울까요?') && onDelete(reply.id)}
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </CommentRow>
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

// 프로필 첫 글자 왼쪽, 굵은 이름 + 내용이 한 줄로 이어지고, 답글은 내용 밑에 들여 붙는다
function CommentRow({ comment, small, children }: CommentRowProps) {
  // 이름을 누르면 그 사람 프로필 (App이 컨텍스트로 내려준다)
  const openProfile = useOpenProfile()
  return (
    <div className={`comment${small ? ' comment--small' : ''}`}>
      <span className={`comment__avatar tone-${Math.abs(comment.authorId) % 4}`} aria-hidden="true">
        {comment.authorName.slice(0, 1)}
      </span>
      <div className="comment__body">
        <p className="comment__line">
          {openProfile ? (
            <button type="button" className="comment__author" onClick={() => openProfile(comment.authorId)}>
              {comment.authorName}
            </button>
          ) : (
            <span className="comment__author">{comment.authorName}</span>
          )}{' '}
          <span className="comment__text">{comment.text}</span>
        </p>
        {children}
      </div>
    </div>
  )
}
