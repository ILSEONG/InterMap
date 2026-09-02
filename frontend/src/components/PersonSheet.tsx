import type { Restaurant, FriendGroup } from '../data/model'
import type { TopPick } from '../lib/topPicks'
import PlaceRow from './PlaceRow'
import TopPicksCard from './TopPicksCard'
import './PersonSheet.css'

interface PersonSheetProps {
  name: string
  // 그 사람이 후기 쓴 가게 전부, 별점 높은 순
  all: TopPick[]
  groups: FriendGroup[]
  onPick: (restaurant: Restaurant) => void
  onClose: () => void
}

// 시안 B — 화면 아래 비모달 시트. 지도는 그대로 보이고 핀도 눌린다. 닫으면 사람 선택 해제.
export default function PersonSheet({ name, all, groups, onPick, onClose }: PersonSheetProps) {
  return (
    <section className="person-sheet" aria-label={`${name}의 후기 가게`}>
      <div className="person-sheet__handle" />
      <div className="person-sheet__head">
        <h2 className="person-sheet__title">
          <span aria-hidden="true">👥</span> {name}의 후기 {all.length}곳
        </h2>
        <button type="button" className="person-sheet__close" onClick={onClose} aria-label="닫기">
          ✕
        </button>
      </div>
      <div className="person-sheet__scroll">
        {all.length > 1 && <TopPicksCard name={name} picks={all.slice(0, 5)} onPick={onPick} />}
        <ul className="person-sheet__list">
          {all.map(({ restaurant }) => (
            <li key={restaurant.id}>
              <PlaceRow restaurant={restaurant} groups={groups} onSelect={onPick} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
