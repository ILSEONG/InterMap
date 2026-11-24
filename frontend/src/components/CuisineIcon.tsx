import type { ReactNode } from 'react'

// 업종 그림 (선 그림, 24×24) — 코드는 lib/cuisine의 업종 코드, 그리고 카페 화면의 종류(lib/cafe의 CAFE_KINDS)
const SHAPES: Record<string, ReactNode> = {
  // 카페 종류 — 김 나는 잔
  COFFEE: (
    <>
      <path d="M5 9h12v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />
      <path d="M17 10h1a3 3 0 0 1 0 6h-1M8 5v1M11 4v2M14 5v1" />
    </>
  ),
  // 카페 종류 — 바게트
  BAKERY: (
    <>
      <path d="M5.3 18.7a2.9 2.9 0 0 1 0-4.1L14.6 5.3a2.9 2.9 0 0 1 4.1 4.1L9.4 18.7a2.9 2.9 0 0 1-4.1 0z" />
      <path d="M9.6 12.4l2 2M12.4 9.6l2 2M15.2 6.8l1.6 1.6" />
    </>
  ),
  // 카페 종류 — 조각 케이크
  DESSERT: (
    <>
      <path d="M3.5 19.5v-6L18 7.5a2.5 2.5 0 0 1 2.5 2.5v9.5z" />
      <path d="M3.5 15.5h17M15 5.2a1.3 1.3 0 1 1 2.2 1" />
    </>
  ),
  // 밥그릇과 김
  KOREAN: (
    <>
      <path d="M4 11h16v1a8 8 0 0 1-16 0z" />
      <path d="M9 7c0-1.5 1.5-1.5 1.5-3M13.5 7c0-1.5 1.5-1.5 1.5-3" />
    </>
  ),
  // 불꽃
  MEAT: (
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  ),
  // 냄비
  SOUP: (
    <>
      <path d="M5 10h14v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" />
      <path d="M3 10h18M9 6c0-1 1-1 1-2M14 6c0-1 1-1 1-2" />
    </>
  ),
  // 그릇과 젓가락
  NOODLE: (
    <>
      <path d="M4 12h16v1a8 8 0 0 1-16 0z" />
      <path d="M9 12l8-9M12.5 12 20 5" />
    </>
  ),
  // 물고기
  SEAFOOD: (
    <>
      <path d="M3 12c3-5 9-6 14-3l4-3v12l-4-3c-5 3-11 2-14-3z" />
      <path d="M8 11v.5" />
    </>
  ),
  // 만두
  CHINESE: (
    <>
      <path d="M3 15a9 9 0 0 1 18 0z" />
      <path d="M8 9.5c1 1 1 2 .5 3M12 8.5V12M16 9.5c-1 1-1 2-.5 3M3 18h18" />
    </>
  ),
  // 초밥
  JAPANESE: (
    <>
      <rect x="3" y="12" width="18" height="6" rx="3" />
      <path d="M5 12.5c2-5 12-5 14 0M10.5 8.8V18M13.5 8.8V18" />
    </>
  ),
  // 포크와 나이프
  WESTERN: <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7" />,
  // 잎
  ASIAN: (
    <>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </>
  ),
  // 떡꼬치
  SNACK: (
    <>
      <path d="M12 2v20" />
      <rect x="8" y="5" width="8" height="4" rx="2" />
      <rect x="8" y="10.5" width="8" height="4" rx="2" />
      <rect x="8" y="16" width="8" height="4" rx="2" />
    </>
  ),
  // 닭다리
  CHICKEN: (
    <>
      <path d="M15.4 15.63a7.875 6 135 1 1 6.23-6.23 4.5 3.43 135 0 0-6.23 6.23" />
      <path d="m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59" />
    </>
  ),
  // 피자 조각
  PIZZA_BURGER: (
    <>
      <path d="M12 21 4 6c5-3 11-3 16 0z" />
      <path d="M10 10v.5M14 11v.5M12 15v.5" />
    </>
  ),
  // 맥주잔
  BAR: (
    <>
      <path d="M6 8h9v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z" />
      <path d="M15 11h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2M9.5 12v5M12 12v5M6 8a2.5 2.5 0 0 1 1.5-4.5 3.2 3.2 0 0 1 6 0A2.5 2.5 0 0 1 15 8" />
    </>
  ),
}

export default function CuisineIcon({ code, size = 22 }: { code: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {SHAPES[code]}
    </svg>
  )
}
