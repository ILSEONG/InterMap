import { useEffect, useState } from 'react'
import { REPORT_REASONS, blockUser, reportContent } from '../lib/api'
import type { ReportReason } from '../lib/api'
import type { ReportTarget } from '../lib/moderation'
import './ModalSheet.css'
import './ReportSheet.css'

interface ReportSheetProps {
  target: ReportTarget
  // 신고가 접수되면 — App이 그 글을 바로 숨기고 목록을 다시 받는다
  onReported: (target: ReportTarget) => void
  // 이어서 작성자를 차단했을 때
  onBlocked: (userId: number) => void
  onClose: () => void
}

const MAX_DETAIL = 500

// 후기·댓글 신고. 사유를 고르고(필수) 자세한 내용(선택)을 적는다.
// 접수되면 그 자리에서 작성자 차단도 이어서 할 수 있다.
export default function ReportSheet({ target, onReported, onBlocked, onClose }: ReportSheetProps) {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const what = target.type === 'REVIEW' ? '후기' : '댓글'

  async function submit() {
    if (!reason || busy) return
    setBusy(true)
    setError(null)
    try {
      setDone(await reportContent(target.type, target.id, reason, detail.trim()))
      onReported(target)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function block() {
    if (busy) return
    if (!window.confirm(`${target.authorName}님을 차단할까요?\n서로의 후기와 댓글이 보이지 않고, 팔로우도 끊겨요.`)) return
    setBusy(true)
    setError(null)
    try {
      await blockUser(target.authorId)
      setBlocked(true)
      onBlocked(target.authorId)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="report-sheet-title">
        <header className="modal-sheet__header">
          <h2 id="report-sheet-title" className="modal-sheet__title">
            {done ? '신고했어요' : `${what} 신고`}
          </h2>
          <button type="button" className="modal-sheet__icon-btn" onClick={onClose} aria-label="닫기">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="modal-sheet__body">
          {error && (
            <p className="modal-sheet__error" role="alert">
              {error}
            </p>
          )}

          {done ? (
            <>
              <div className="report-sheet__done" role="status">
                <span className="report-sheet__done-icon" aria-hidden="true">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <p className="report-sheet__done-text">
                  {done}
                  <br />
                  신고한 {what}은 이제 나에게 보이지 않아요.
                </p>
              </div>
              {blocked ? (
                <p className="report-sheet__blocked" role="status">
                  {target.authorName}님을 차단했어요. 마이페이지에서 언제든 풀 수 있어요.
                </p>
              ) : (
                <p className="modal-sheet__lead">
                  {target.authorName}님의 글을 더 보고 싶지 않다면 차단할 수 있어요.
                </p>
              )}
              <div className="modal-sheet__actions">
                {!blocked && (
                  <button type="button" className="modal-sheet__btn modal-sheet__btn--plain" onClick={block} disabled={busy}>
                    {target.authorName}님 차단
                  </button>
                )}
                <button type="button" className="modal-sheet__btn modal-sheet__btn--dark" onClick={onClose}>
                  확인
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="modal-sheet__lead">
                {target.authorName}님의 {what}을 신고하는 이유를 골라주세요. 신고한 사람은 상대에게 알려지지 않아요.
              </p>
              <fieldset className="report-sheet__reasons">
                <legend className="report-sheet__sr">신고 사유</legend>
                {REPORT_REASONS.map((r) => (
                  <label key={r.value} className={`report-sheet__reason${reason === r.value ? ' report-sheet__reason--on' : ''}`}>
                    <input
                      type="radio"
                      name="report-reason"
                      value={r.value}
                      checked={reason === r.value}
                      onChange={() => setReason(r.value)}
                    />
                    <span className="report-sheet__radio" aria-hidden="true" />
                    {r.label}
                  </label>
                ))}
              </fieldset>
              <label className="report-sheet__detail-label" htmlFor="report-detail">
                자세한 내용 <span>(선택)</span>
              </label>
              <textarea
                id="report-detail"
                className="report-sheet__detail"
                value={detail}
                maxLength={MAX_DETAIL}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="운영자가 확인할 때 참고할 내용을 적어주세요"
                rows={3}
              />
              <div className="modal-sheet__actions">
                <button type="button" className="modal-sheet__btn modal-sheet__btn--primary" onClick={submit} disabled={!reason || busy}>
                  {busy ? '보내는 중…' : '신고하기'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
