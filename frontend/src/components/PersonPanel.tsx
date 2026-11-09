import { useState } from 'react'
import type { Restaurant } from '../data/model'
import { categoryName, iGa } from '../lib/taste'
import { timeAgo } from '../lib/time'
import Avatar from './Avatar'
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

// 현황판 "지도 보기" 뒤 — 지도 위쪽 칩: "민지가 간 곳 24곳 ×" + 팔로잉 목록으로 돌아가기
export function PersonMapChip({
  person,
  count,
  onClose,
  onOpenBoard,
}: {
  person: PersonPerson
  count: number
  onClose: () => void
  onOpenBoard: () => void
}) {
  return (
    <div className="person-map-chip">
      <div className="person-map-chip__main glass">
        <Avatar className={`person-map-chip__avatar tone-${Math.abs(person.id) % 4}`} src={person.avatar} name={person.name} />
        <span className="person-map-chip__label">
          {iGa(person.name)} 간 곳 {count}곳
        </span>
        <button type="button" className="person-map-chip__close" onClick={onClose} aria-label={`${person.name} 지도 닫기`}>
          <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <button type="button" className="person-map-chip__board glass" onClick={onOpenBoard}>
        팔로잉 목록
      </button>
    </div>
  )
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
}: {
  person: PersonPerson
  places: PersonPlace[]
  reviewCount: number
  tag: string | null
  onPick: (restaurant: Restaurant) => void
  onOpenProfile: () => void
}) {
  const [tab, setTab] = useState<Tab>('recent')
  const [open, setOpen] = useState(true)
  const list = places
    .slice()
    .sort((a, b) => (tab === 'recent' ? Date.parse(b.at) - Date.parse(a.at) : b.rating - a.rating || Date.parse(b.at) - Date.parse(a.at)))
    .slice(0, 3)

  return (
    <section className="person-panel glass glass--strong" aria-label={`${iGa(person.name)} 다녀온 곳`}>
      <div className="person-panel__head">
        <Avatar className={`person-panel__avatar tone-${Math.abs(person.id) % 4}`} src={person.avatar} name={person.name} />
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
        <button
          type="button"
          className="person-panel__fold"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? '목록 접기' : '목록 펼치기'}
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? undefined : 'rotate(180deg)' }}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>
      {open && (
        <>
          <div className="segmented person-panel__tabs" role="group" aria-label="정렬">
            {(
              [
                ['recent', '최근 다녀온 곳'],
                ['best', '별점 높은 곳'],
              ] as [Tab, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`segmented__item${tab === value ? ' segmented__item--active' : ''}`}
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
                      {categoryName(p.restaurant.category) ?? '음식점'} · {timeAgo(p.at)}
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
        </>
      )}
    </section>
  )
}
