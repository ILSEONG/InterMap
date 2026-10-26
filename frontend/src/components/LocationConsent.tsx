import { useEffect, useRef, useState } from 'react'
import { useLocationConsent } from '../lib/locationConsent'
import LocationTerms from './LocationTerms'
import './LocationConsent.css'

// gps: GPS 버튼을 눌렀는데 아직 동의 전 — 동의하면 바로 내 위치로 간다
// settings: 내 계정 메뉴에서 연 동의 내역 — 동의하거나 철회한다
export type LocationSheetMode = 'gps' | 'settings'

interface LocationConsentProps {
  mode: LocationSheetMode | null
  onAgree: () => void
  onWithdraw: () => void
  onClose: () => void
}

function LocateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 4L4 11l7 2 2 7z" />
    </svg>
  )
}

const formatAgreedAt = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// 위치기반서비스 이용약관 + 개인위치정보 이용 동의 시트.
// 위치정보법 제19조: 약관을 밝히고 동의를 받은 뒤에만 개인위치정보를 쓴다. 제24조: 언제든 철회할 수 있어야 한다.
export default function LocationConsent({ mode, onAgree, onWithdraw, onClose }: LocationConsentProps) {
  const open = mode !== null
  // 닫히는 애니메이션 동안 내용이 유지되도록 마지막 모드를 기억한다
  const lastModeRef = useRef<LocationSheetMode>('gps')
  if (mode) lastModeRef.current = mode
  const shown = mode ?? lastModeRef.current

  const consent = useLocationConsent()
  const [termsOpen, setTermsOpen] = useState(false)
  // 방금 철회했는지 — 시트가 "동의 전" 화면으로 바뀌므로 무슨 일이 있었는지 한 줄 남긴다
  const [withdrew, setWithdrew] = useState(false)

  useEffect(() => {
    setTermsOpen(false)
    setWithdrew(false)
  }, [open])

  const summary = (
    <ul className="loc-sheet__points">
      <li>지도에 내 위치를 보여주고, 검색 결과를 가까운 순으로 정렬해요.</li>
      <li>위치는 이 기기 안에서만 쓰고 서버로 보내거나 저장하지 않아요.</li>
      <li>언제든 내 계정 메뉴의 "위치정보 이용 동의"에서 철회할 수 있어요.</li>
    </ul>
  )

  const terms = (
    <>
      <button type="button" className="loc-sheet__terms-toggle" onClick={() => setTermsOpen((v) => !v)} aria-expanded={termsOpen}>
        위치기반서비스 이용약관 {termsOpen ? '접기' : '전문 보기'}
      </button>
      {termsOpen && (
        <div className="loc-sheet__terms">
          <LocationTerms />
        </div>
      )}
    </>
  )

  return (
    <div className={`loc-overlay${open ? ' loc-overlay--open' : ''}`} onClick={onClose}>
      <div className="loc-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="위치정보 이용 동의">
        <span className="loc-sheet__tile" aria-hidden="true">
          <LocateIcon />
        </span>
        {consent ? (
          <>
            <h2 className="loc-sheet__title">위치정보 이용 동의</h2>
            <p className="loc-sheet__desc">{formatAgreedAt(consent.agreedAt)}에 동의했어요.</p>
            {summary}
            {terms}
            <p className="loc-sheet__note">
              철회하면 내 위치 표시와 가까운 순 정렬이 꺼지고, 기기에 있던 위치도 바로 지워져요. 기기의 위치 권한까지 끄려면
              휴대폰 설정에서 바꿔주세요.
            </p>
            <div className="loc-sheet__actions">
              <button
                type="button"
                className="loc-sheet__btn loc-sheet__btn--danger"
                onClick={() => {
                  setWithdrew(true)
                  onWithdraw()
                }}
              >
                동의 철회하기
              </button>
              <button type="button" className="loc-sheet__btn loc-sheet__btn--plain" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="loc-sheet__title">
              {withdrew ? '위치정보 이용 동의를 철회했어요' : '내 위치를 쓰려면 동의가 필요해요'}
            </h2>
            {summary}
            {terms}
            <p className="loc-sheet__note">
              만 14세 이상이고 위치기반서비스 이용약관과 개인위치정보 이용에 동의하면 아래 버튼을 눌러주세요. 동의하지
              않아도 지도와 후기는 그대로 쓸 수 있어요.
            </p>
            <div className="loc-sheet__actions">
              <button type="button" className="loc-sheet__btn loc-sheet__btn--primary" onClick={onAgree}>
                {shown === 'gps' ? '동의하고 내 위치 보기' : '동의하기'}
              </button>
              <button type="button" className="loc-sheet__btn loc-sheet__btn--plain" onClick={onClose}>
                {shown === 'gps' ? '다음에' : '닫기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
