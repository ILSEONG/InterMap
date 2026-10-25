import type { CSSProperties } from 'react'

// 둥근 별 모양 (24×24) — 별점 표시·후기 카드·별점 고르기가 같이 쓴다
export const STAR_SHAPE = 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'

// 0.1점 단위 별점을 별마다 채운 비율로 그린다. 크기는 글자 크기(1em)를 따른다. 스타일은 RestaurantSheet.css의 .stars
export default function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="stars__star"
          style={{ '--f': Math.min(Math.max(value - i, 0), 1) } as CSSProperties}
        >
          <svg className="stars__base" viewBox="0 0 24 24">
            <path d={STAR_SHAPE} />
          </svg>
          <svg className="stars__fill" viewBox="0 0 24 24">
            <path d={STAR_SHAPE} />
          </svg>
        </span>
      ))}
    </span>
  )
}
