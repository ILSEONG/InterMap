import { useEffect } from 'react'
import './ModalSheet.css'
import SheetGrip from './SheetGrip'

export type PolicyPage = 'privacy' | 'terms' | 'account-deletion'

const TITLES: Record<PolicyPage, string> = {
  privacy: '개인정보처리방침',
  terms: '이용약관',
  'account-deletion': '계정 삭제 안내',
}

// 약관·개인정보처리방침을 앱 안에서 연다. 문서는 public/*.html 정적 페이지라
// 웹(Vercel)에서는 스토어 등록용 주소로 그대로 열리고, 앱에서는 이 시트의 iframe으로 본다
// (앱 WebView에서 페이지를 직접 이동하면 지도 앱 상태가 날아가므로).
export default function PolicyViewer({ page, onClose }: { page: PolicyPage; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet modal-sheet--tall" role="dialog" aria-modal="true" aria-label={TITLES[page]}>
        <SheetGrip onClose={onClose} />
        <header className="modal-sheet__header">
          <h2 className="modal-sheet__title">{TITLES[page]}</h2>
          <button type="button" className="modal-sheet__icon-btn" onClick={onClose} aria-label="닫기">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <iframe className="policy-viewer__frame" src={`/${page}.html`} title={TITLES[page]} />
      </div>
    </div>
  )
}
