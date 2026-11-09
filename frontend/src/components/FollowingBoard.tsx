import { useEffect, useMemo, useState } from 'react'
import type { Review } from '../data/model'
import type { Person } from '../lib/api'
import { tasteTag } from '../lib/taste'
import { timeAgo } from '../lib/time'
import Avatar from './Avatar'
import { RatingStar } from './Stars'
import './ModalSheet.css'
import './FollowingBoard.css'

interface FollowingBoardProps {
  people: Person[]
  // 앱이 받은 후기 전체 (팔로우한 사람 + 나). 사람마다 최근 후기·개수·입맛 꼬리표를 여기서 뽑는다
  reviews: Review[]
  onShowOnMap: (userId: number) => void
  onOpenProfile: (userId: number) => void
  onFindPeople: () => void
  // 위에 프로필이 열려 있으면 잠시 숨긴다 (정렬·검색 상태는 그대로)
  hidden?: boolean
  onClose: () => void
}

type Sort = 'recent' | 'count' | 'name'
const SORTS: [Sort, string][] = [
  ['recent', '최근 활동순'],
  ['count', '후기 많은순'],
  ['name', '이름순'],
]

// 마지막으로 현황판을 연 때 — 그 뒤에 올라온 후기를 "새 후기"로 센다
const SEEN_KEY = 'intermap.boardSeen'
const WEEK = 7 * 24 * 3_600_000

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0
  } catch {
    return 0
  }
}

interface Row {
  person: Person
  name: string
  latest: Review | null
  count: number
  newCount: number
  tag: string | null
}

// 헤더의 팔로잉 버튼 → 팔로잉 현황판. 누가 요즘 어디를 다녀왔는지 한눈에 보고, 그 사람 지도로 바로 간다
export default function FollowingBoard({ people, reviews, onShowOnMap, onOpenProfile, onFindPeople, hidden, onClose }: FollowingBoardProps) {
  const [sort, setSort] = useState<Sort>('recent')
  const [query, setQuery] = useState('')
  // 처음 열 땐 기준이 없으니 하루 안에 올라온 후기를 새 후기로 본다
  const [seenAt] = useState(() => readSeen() || Date.now() - 24 * 3_600_000)

  // 열었으면 지금까지의 후기는 본 것으로 — 다음에 열 때부터 그 뒤 후기만 새 후기
  useEffect(() => {
    try {
      localStorage.setItem(SEEN_KEY, String(Date.now()))
    } catch {
      // 저장 못 해도 다음에 하루치를 새 후기로 보일 뿐
    }
  }, [])

  useEffect(() => {
    if (hidden) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, hidden])

  const rows = useMemo<Row[]>(() => {
    const byAuthor = new Map<number, Review[]>()
    for (const rv of reviews) {
      if (rv.author.owner) continue
      const list = byAuthor.get(rv.author.id)
      if (list) list.push(rv)
      else byAuthor.set(rv.author.id, [rv])
    }
    return people.map((person) => {
      const list = (byAuthor.get(person.id) ?? []).slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      return {
        person,
        name: person.alias ?? person.nickname,
        latest: list[0] ?? null,
        count: list.length,
        newCount: list.filter((rv) => Date.parse(rv.createdAt) > seenAt).length,
        tag: tasteTag(list),
      }
    })
  }, [people, reviews, seenAt])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? rows.filter((r) => r.name.toLowerCase().includes(q) || r.person.nickname.toLowerCase().includes(q))
      : rows
    const at = (r: Row) => (r.latest ? Date.parse(r.latest.createdAt) : 0)
    return filtered.slice().sort((a, b) =>
      sort === 'recent'
        ? at(b) - at(a)
        : sort === 'count'
          ? b.count - a.count || at(b) - at(a)
          : a.name.localeCompare(b.name, 'ko'),
    )
  }, [rows, query, sort])

  // 최근 활동순일 때만 묶음 제목을 단다
  const now = Date.now()
  const sections: { title: string | null; accent?: boolean; rows: Row[] }[] =
    sort === 'recent'
      ? [
          { title: '새 후기를 올린 사람', accent: true, rows: shown.filter((r) => r.newCount > 0) },
          { title: '이번 주', rows: shown.filter((r) => r.newCount === 0 && r.latest && now - Date.parse(r.latest.createdAt) < WEEK) },
          { title: '그 전', rows: shown.filter((r) => r.newCount === 0 && r.latest && now - Date.parse(r.latest.createdAt) >= WEEK) },
          { title: '아직 후기가 없어요', rows: shown.filter((r) => !r.latest) },
        ].filter((s) => s.rows.length > 0)
      : [{ title: null, rows: shown }]

  return (
    <div className="modal-layer board-layer" hidden={hidden} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet modal-sheet--tall board" role="dialog" aria-modal="true" aria-labelledby="board-title">
        <header className="modal-sheet__header">
          <h2 id="board-title" className="modal-sheet__title">
            팔로잉 <span className="board__count">{people.length}</span>
          </h2>
          <button type="button" className="board__find" onClick={onFindPeople}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            사람 찾기
          </button>
          <button type="button" className="modal-sheet__icon-btn" onClick={onClose} aria-label="닫기">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {people.length > 0 && (
          <div className="board__tools">
            <label className="board__search">
              <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="닉네임으로 찾기"
                aria-label="닉네임으로 찾기"
                enterKeyHint="search"
              />
            </label>
            <div className="segmented board__sort" role="group" aria-label="정렬">
              {SORTS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`segmented__item${sort === value ? ' segmented__item--active' : ''}`}
                  aria-pressed={sort === value}
                  onClick={() => setSort(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="modal-sheet__body board__body">
          {people.length === 0 ? (
            <div className="board__empty">
              <p className="board__empty-title">아직 팔로우한 사람이 없어요</p>
              <p className="board__empty-text">팔로우하면 그 사람이 다녀온 가게가 지도와 스토리에 나타나요.</p>
              <button type="button" className="modal-sheet__btn modal-sheet__btn--primary" onClick={onFindPeople}>
                사람 찾기
              </button>
            </div>
          ) : shown.length === 0 ? (
            <p className="board__none">‘{query.trim()}’ 닉네임을 가진 사람이 없어요</p>
          ) : (
            sections.map((section) => (
              <section key={section.title ?? 'all'} className="board__section">
                {section.title && (
                  <h3 className={`board__section-title${section.accent ? ' board__section-title--accent' : ''}`}>{section.title}</h3>
                )}
                <ul className="board__list">
                  {section.rows.map((r) => (
                    <li key={r.person.id} className="board__row">
                      <button type="button" className="board__open" onClick={() => onOpenProfile(r.person.id)}>
                        <span className={`board__avatar-wrap${r.newCount > 0 ? ' board__avatar-wrap--new' : ''}`}>
                          <Avatar className={`board__avatar tone-${Math.abs(r.person.id) % 4}`} src={r.person.avatar} name={r.name} />
                          {r.newCount > 0 && <span className="board__new-dot" aria-hidden="true" />}
                        </span>
                        <span className="board__meta">
                          <span className="board__name-line">
                            <span className="board__name">{r.name}</span>
                            {r.person.followsMe && <span className="board__tag board__tag--mutual">맞팔</span>}
                            {r.newCount > 0 && <span className="board__tag board__tag--new">새 후기 {r.newCount}개</span>}
                          </span>
                          {r.latest ? (
                            <span className="board__latest">
                              <span className="board__when">{timeAgo(r.latest.createdAt)} ·</span> {r.latest.restaurant.name}{' '}
                              <RatingStar />
                              {r.latest.rating.toFixed(1)}
                            </span>
                          ) : (
                            <span className="board__latest board__when">아직 남긴 후기가 없어요</span>
                          )}
                          {r.count > 0 && (
                            <span className="board__tags">
                              <span className="board__tag">후기 {r.count}개</span>
                              {r.tag && <span className="board__tag">{r.tag}</span>}
                            </span>
                          )}
                        </span>
                      </button>
                      {r.count > 0 && (
                        <button type="button" className="board__map" onClick={() => onShowOnMap(r.person.id)}>
                          지도 보기
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
