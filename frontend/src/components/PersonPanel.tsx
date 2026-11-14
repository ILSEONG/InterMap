import { useState } from 'react'
import type { Restaurant } from '../data/model'
import { categoryName, iGa } from '../lib/taste'
import { reviewDate } from '../lib/time'
import Avatar from './Avatar'
import SheetGrip from './SheetGrip'
import { RatingStar } from './Stars'
import './PersonPanel.css'

export interface PersonPlace {
  restaurant: Restaurant
  rating: number
  // 그 사람이 이 가게에 남긴 마지막 후기 시각 (ISO)
  at: string
}

interface PersonPerson {
  id: number
  name: string
  avatar?: string | null
  mutual: boolean
}

type Tab = 'recent' | 'best'

// 지도 아래쪽 패널 — 그 사람 요약 + 최근 다녀온 곳 / 별점 높은 곳. 가게를 누르면 지도가 그리로 간다
export default function PersonPanel({
  person,
  places,
  reviewCount,
  tag,
  onPick,
  onOpenProfile,
  onClose,
}: {
  person: PersonPerson
  places: PersonPlace[]
  reviewCount: number
  tag: string | null
  onPick: (restaurant: Restaurant) => void
  onOpenProfile: () => void
  // 손잡이로 끌어내리면 닫는다 (이웃 지도 보기 해제)
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('recent')
  const list = places
    .slice()
    .sort((a, b) =>
      tab === 'recent'
        ? Date.parse(b.at) - Date.parse(a.at)
        : b.rating - a.rating || Date.parse(b.at) - Date.parse(a.at),
    )
    .slice(0, 3)

  return (
    <section className="person-panel" aria-label={`${iGa(person.name)} 다녀온 곳`}>
      <SheetGrip onClose={onClose} />
      <div className="person-panel__head">
        <Avatar
          className={`person-panel__avatar tone-${Math.abs(person.id) % 4}`}
          src={person.avatar}
          name={person.name}
        />
        <div className="person-panel__who">
          <p className="person-panel__name">
            <span className="person-panel__name-text">{person.name}</span>
            {person.mutual && <span className="person-panel__tag">맞팔</span>}
          </p>
          <p className="person-panel__sub">
            후기 {reviewCount}개{tag ? ` · ${tag}` : ''}
          </p>
        </div>
        <button type="button" className="person-panel__profile" onClick={onOpenProfile}>
          프로필
        </button>
      </div>
      <div className="person-panel__tabs" role="group" aria-label="정렬">
        {(
          [
            ['recent', '최근 다녀온 곳'],
            ['best', '별점 높은 곳'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`person-panel__tab${tab === value ? ' person-panel__tab--on' : ''}`}
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <ol className="person-panel__list">
        {list.map((p, i) => (
          <li key={p.restaurant.id}>
            <button type="button" className="person-panel__place" onClick={() => onPick(p.restaurant)}>
              <span className="person-panel__rank">{i + 1}</span>
              <span className="person-panel__place-text">
                <span className="person-panel__place-name">{p.restaurant.name}</span>
                <span className="person-panel__place-sub">
                  {categoryName(p.restaurant.category) ?? '음식점'} · {reviewDate(p.at)}
                </span>
              </span>
              <span className="person-panel__rating">
                <RatingStar />
                {p.rating.toFixed(1)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
