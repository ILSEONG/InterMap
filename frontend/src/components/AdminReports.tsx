import { useCallback, useEffect, useState } from 'react'
import { REPORT_REASONS, fetchAdminReports, resolveReport } from '../lib/api'
import type { AdminReport, ReportStatus } from '../lib/api'
import { timeAgo } from '../lib/time'
import './ModalSheet.css'
import './AdminReports.css'

const TABS: { value: ReportStatus; label: string }[] = [
  { value: 'OPEN', label: '처리 전' },
  { value: 'REMOVED', label: '삭제함' },
  { value: 'DISMISSED', label: '문제 없음' },
]

const reasonLabel = (value: string) => REPORT_REASONS.find((r) => r.value === value)?.label ?? value

// 운영자(주인장) 전용 — 들어온 신고를 보고 글을 지우거나 기각한다.
// 같은 글에 걸린 신고는 하나만 처리해도 모두 같이 닫힌다.
export default function AdminReports({ onChanged, onClose }: { onChanged: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<ReportStatus>('OPEN')
  const [list, setList] = useState<AdminReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async (status: ReportStatus) => {
    setList(null)
    setError(null)
    try {
      setList(await fetchAdminReports(status))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load(tab)
  }, [tab, load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function act(report: AdminReport, action: 'REMOVE' | 'DISMISS') {
    if (busyId !== null) return
    const what = report.targetType === 'REVIEW' ? '후기' : '댓글'
    if (action === 'REMOVE' && !window.confirm(`이 ${what}을 지울까요? 되돌릴 수 없어요.`)) return
    setBusyId(report.id)
    setError(null)
    try {
      await resolveReport(report.id, action)
      if (action === 'REMOVE') onChanged()
      await load(tab)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="modal-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet modal-sheet--tall" role="dialog" aria-modal="true" aria-labelledby="admin-reports-title">
        <header className="modal-sheet__header">
          <h2 id="admin-reports-title" className="modal-sheet__title">
            신고 관리
          </h2>
          <button type="button" className="modal-sheet__icon-btn" onClick={onClose} aria-label="닫기">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="admin-reports__tabs" role="group" aria-label="신고 상태">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`admin-reports__tab${tab === t.value ? ' admin-reports__tab--on' : ''}`}
              aria-pressed={tab === t.value}
              onClick={() => setTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="modal-sheet__body">
          {error && (
            <p className="modal-sheet__error" role="alert">
              {error}
            </p>
          )}
          {list === null ? (
            !error && (
              <p className="modal-sheet__lead" role="status">
                불러오는 중…
              </p>
            )
          ) : list.length === 0 ? (
            <p className="admin-reports__empty">{tab === 'OPEN' ? '처리할 신고가 없어요.' : '내역이 없어요.'}</p>
          ) : (
            <ul className="admin-reports__list">
              {list.map((r) => (
                <li key={r.id} className="admin-reports__item">
                  <div className="admin-reports__meta">
                    <span className="admin-reports__type">{r.targetType === 'REVIEW' ? '후기' : '댓글'}</span>
                    <span className="admin-reports__reason">{reasonLabel(r.reason)}</span>
                    {r.openCount > 1 && <span className="admin-reports__count">신고 {r.openCount}건</span>}
                    <span className="admin-reports__time">{timeAgo(r.createdAt)}</span>
                  </div>
                  <p className="admin-reports__author">
                    작성자 <strong>{r.targetAuthorName ?? '탈퇴한 사용자'}</strong> · 신고자 {r.reporterName}
                  </p>
                  <blockquote className="admin-reports__content">{r.content || '(내용 없음)'}</blockquote>
                  {r.detail && <p className="admin-reports__detail">신고 내용: {r.detail}</p>}
                  {tab === 'OPEN' && (
                    <div className="admin-reports__actions">
                      {r.targetExists ? (
                        <>
                          <button
                            type="button"
                            className="modal-sheet__btn modal-sheet__btn--plain"
                            onClick={() => act(r, 'DISMISS')}
                            disabled={busyId !== null}
                          >
                            문제 없음
                          </button>
                          <button
                            type="button"
                            className="modal-sheet__btn modal-sheet__btn--primary"
                            onClick={() => act(r, 'REMOVE')}
                            disabled={busyId !== null}
                          >
                            {busyId === r.id ? '처리 중…' : '글 삭제'}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="modal-sheet__btn modal-sheet__btn--plain"
                          onClick={() => act(r, 'REMOVE')}
                          disabled={busyId !== null}
                        >
                          이미 지워진 글 — 닫기
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
