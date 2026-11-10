import { useEffect, useMemo, useState } from 'react'
import type { Review } from '../data/model'
import type { Person } from '../lib/api'
import { tasteTag } from '../lib/taste'
import { timeAgo } from '../lib/time'
import Avatar from './Avatar'
import { RatingStar } from './Stars'
import './ModalSheet.css'
import './FollowingBoard.css'
import { markBoardSeen, readBoardSeen } from '../lib/boardSeen'
import SheetGrip from './SheetGrip'

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
  const [seenAt] = useState(readBoardSeen)

  // 열었으면 지금까지의 후기는 본 것으로 — 다음에 열 때부터 그 뒤 후기만 새 후기
  useEffect(markBoardSeen, [])

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

  return (
    <div className="modal-layer board-layer" hidden={hidden} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet modal-sheet--tall board" role="dialog" aria-modal="true" aria-labelledby="board-title">
        <SheetGrip onClose={onClose} />
        <header className="modal-sheet__header">
          <h2 id="board-title" className="modal-sheet__title">
            팔로잉 <span className="board__count">{people.length}</span>
          </h2>
          <button type="button" className="board__find" onClick={onFindPeople}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            이웃 찾기
          </button>
          <button type="button" className="modal-sheet__icon-btn board__close" onClick={onClose} aria-label="닫기">
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
            <div className="board__sort" role="group" aria-label="정렬">
              {SORTS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`board__sort-tab${sort === value ? ' board__sort-tab--on' : ''}`}
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
              <p className="board__empty-title">아직 팔로우한 이웃이 없어요</p>
              <p className="board__empty-text">팔로우하면 그 이웃이 다녀온 가게가 지도와 스토리에 나타나요.</p>
              <button type="button" className="modal-sheet__btn modal-sheet__btn--primary" onClick={onFindPeople}>
                이웃 찾기
              </button>
            </div>
          ) : shown.length === 0 ? (
            <p className="board__none">‘{query.trim()}’ 닉네임을 가진 이웃이 없어요</p>
          ) : (
            // 새 후기·이번 주·그 전으로 나누지 않고 한 목록으로 (정렬만 바꾼다)
            <ul className="board__list">
              {shown.map((r) => (
                <li key={r.person.id} className="board__row">
                  <button type="button" className="board__open" onClick={() => onOpenProfile(r.person.id)}>
                    <span className={`board__avatar-wrap${r.newCount > 0 ? ' board__avatar-wrap--new' : ''}`}>
                      <Avatar className={`board__avatar tone-${Math.abs(r.person.id) % 4}`} src={r.person.avatar} name={r.name} />
                    </span>
                    <span className="board__meta">
                      <span className="board__name-line">
                        <span className="board__name">{r.name}</span>
                        {r.person.followsMe && <span className="board__flag board__flag--mutual">맞팔</span>}
                        {r.newCount > 0 && <span className="board__flag board__flag--new">새 후기 {r.newCount}개</span>}
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
                        <span className="board__sub">
                          후기 {r.count}개{r.tag && ` · ${r.tag}`}
                        </span>
                      )}
                    </span>
                  </button>
                  {r.count > 0 && (
                    <button type="button" className="board__map" onClick={() => onShowOnMap(r.person.id)}>
                      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z" />
                        <path d="M9 4v13.5M15 6.5V20" />
                      </svg>
                      지도 보기
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
