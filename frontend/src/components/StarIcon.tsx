// 통통한 별 아이콘 — 헤더 찜 토글과 가게 찜 버튼이 같이 쓴다.
// 안쪽 반지름을 키워 몸통이 두툼하고, 모서리는 둥글려 귀엽게.
export default function StarIcon({ filled = false, size = 20 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 2.5 L14.94 7.96 L21.04 9.06 L16.76 13.55 L17.58 19.69 L12 17 L6.42 19.69 L7.24 13.55 L2.96 9.06 L9.06 7.96 Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
