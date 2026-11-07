// 투표 아이콘들 — 가게 시트의 "투표 담기", 하단 후보 바, 투표 화면이 같이 쓴다

// 체크한 칸 + 빈 칸 — 후보 중에 고르는 투표
export function BallotIcon({ size = 22 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4" width="6.5" height="6.5" rx="1.8" />
      <path d="M5.2 7.3l1.3 1.3 2.1-2.3" />
      <path d="M13.5 7.25h7" />
      <rect x="3.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
      <path d="M13.5 16.75h7" />
    </svg>
  )
}

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

// 왕관 — 결정된 가게
export function CrownIcon({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5z" />
    </svg>
  )
}

// 지도 핀 — 네이버 지도에서 보기
export function PinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  )
}

export function ShareIcon({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V3.5M7.5 8L12 3.5 16.5 8" />
      <path d="M5 12.5V20h14v-7.5" />
    </svg>
  )
}
