// 0.1점 단위 별점을 채워진 별 너비로 그린다. 스타일은 RestaurantSheet.css의 .stars
export default function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-hidden="true">
      <span className="stars__base">★★★★★</span>
      <span className="stars__fill" style={{ width: `${(value / 5) * 100}%` }}>
        ★★★★★
      </span>
    </span>
  )
}
