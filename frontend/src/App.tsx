import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import Header from './components/Header'
import SearchResults from './components/SearchResults'
import StoryStrip from './components/StoryStrip'
import MapCanvas from './components/MapCanvas'
import GroupFilterSheet from './components/GroupFilterSheet'
import RestaurantSheet from './components/RestaurantSheet'
import MeetupSheet from './components/MeetupSheet'
import { groups, friends, me, restaurants as initialRestaurants, groupById } from './data/mock'
import type { GroupId, Restaurant } from './data/mock'
import { fetchRestaurants } from './lib/api'
import type { RestaurantRecord } from './lib/api'
import './App.css'

// 한 글자로는 결과가 너무 많이 걸려 두 글자부터 검색한다.
const MIN_QUERY_LENGTH = 2

/*
  THESIS: the map is a lively neighborhood scene where a friend's pick pops up
  like a doodle character you tap, not a data dashboard of pins.
  OWN-WORLD: chunky ink-outlined shapes, candy-bright per-group color, soft
  floating shadows, Jua display type over Pretendard body text.
  STORY: open app -> see illustrated map with friends' story chips and
  colored pins -> tap a pin -> read neighbor reviews/menu -> start a meetup.
  FIRST VIEWPORT: full-bleed illustrated map, floating pill header (필터 +
  multicolor 인터맵 wordmark), story strip riding just below it.
  FORM: Google Doodle interactive-scene, user-pinned via reference URL.
  FINISH: unreviewed and undocumented is unfinished; this build ends with
  the finish review, the verdict, DESIGN.md, and every shipping raster
  carrying its provenance.
*/

function toRestaurant(record: RestaurantRecord): Restaurant {
  return {
    id: `db-${record.id}`,
    name: record.name,
    category: record.category || '음식점',
    address: record.roadAddress || record.address,
    lat: record.lat,
    lng: record.lng,
    groupIds: [],
    reviews: [],
    comments: [],
    closed: record.status === 'CLOSED',
  }
}

export default function App() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>(initialRestaurants)

  useEffect(() => {
    fetchRestaurants()
      .then((records) => {
        setRestaurants((prev) => {
          const merged = [...prev]
          for (const record of records) {
            const existing = merged.find(
              (r) => r.name === record.name && (r.address === record.roadAddress || r.address === record.address),
            )
            if (existing) {
              existing.closed = record.status === 'CLOSED'
            } else {
              merged.push(toRestaurant(record))
            }
          }
          return merged
        })
      })
      .catch(() => {
        // 백엔드 미기동 시 목데이터만으로 동작
      })
  }, [])
  const [activeGroupIds, setActiveGroupIds] = useState<Set<GroupId>>(new Set(groups.map((g) => g.id)))
  const [filterOpen, setFilterOpen] = useState(false)
  // 그룹별 마커 색. --gc-* CSS 변수로 앱 루트에 내려가고 모든 컴포넌트가 var()로 참조한다.
  const [groupColors, setGroupColors] = useState<Record<GroupId, string>>({
    close: '#FF5D73',
    work: '#2FBFA6',
    college: '#8B6BFF',
    none: '#A9746E',
  })
  // 후기 유무 필터: 전체 / 후기 있는 곳만 / 없는 곳만
  const [reviewFilter, setReviewFilter] = useState<'all' | 'with' | 'without'>('with')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 같은 가게를 다시 골라도 지도가 이동하도록 매번 새 객체를 만든다.
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null)
  const [meetupRestaurant, setMeetupRestaurant] = useState<Restaurant | null>(null)

  // 입력은 즉시 반영하고 지도 마커 재생성처럼 무거운 작업만 뒤로 미룬다.
  const deferredQuery = useDeferredValue(query)
  const selectedRestaurant = useMemo(
    () => restaurants.find((r) => r.id === selectedId) ?? null,
    [restaurants, selectedId],
  )

  const visibleRestaurants = useMemo(
    () => {
      const raw = deferredQuery.trim()
      const keyword = raw.length >= MIN_QUERY_LENGTH ? raw.toLowerCase() : ''
      return restaurants.filter(
        (r) =>
          (r.groupIds.length === 0 ? activeGroupIds.has('none') : r.groupIds.some((g) => activeGroupIds.has(g))) &&
          (reviewFilter === 'all' || (reviewFilter === 'with') === r.reviews.length > 0) &&
          (keyword === '' ||
            `${r.name} ${r.category} ${r.address}`.toLowerCase().includes(keyword)),
      )
    },
    [restaurants, activeGroupIds, reviewFilter, deferredQuery],
  )

  const todayStories = useMemo(() => {
    const activeFriendIds = new Set(
      restaurants.flatMap((r) => r.reviews.filter((rev) => rev.postedHoursAgo <= 24).map((rev) => rev.friendId)),
    )
    return friends
      .filter((f) => activeFriendIds.has(f.id) && activeGroupIds.has(f.groupId))
      .map((f) => ({ ...f, group: groupById(f.groupId) }))
  }, [restaurants, activeGroupIds])

  // 매 렌더마다 새 함수를 넘기면 MapCanvas가 마커를 통째로 다시 그린다.
  const pickRestaurant = useCallback((restaurant: Restaurant) => setSelectedId(restaurant.id), [])
  // 검색 결과 선택은 지도만 옮긴다. 상세는 지도에서 핀을 눌러 연다.
  // 고르고 나면 결과 목록이 지도를 가리지 않도록 검색어를 비운다.
  const focusFromSearch = useCallback((restaurant: Restaurant) => {
    setFocusTarget({ id: restaurant.id })
    setQuery('')
  }, [])

  function toggleGroup(id: GroupId) {
    setActiveGroupIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function addReview(restaurantId: string, rating: number, text: string) {
    setRestaurants((prev) =>
      prev.map((r) =>
        r.id === restaurantId
          ? {
              ...r,
              reviews: [{ id: `rv-${Date.now()}`, friendId: me.id, rating, text, postedHoursAgo: 0 }, ...r.reviews],
            }
          : r,
      ),
    )
  }

  function addComment(restaurantId: string, text: string, parentId?: string) {
    setRestaurants((prev) =>
      prev.map((r) =>
        r.id === restaurantId
          ? { ...r, comments: [...r.comments, { id: `c-${Date.now()}`, friendId: me.id, text, parentId }] }
          : r,
      ),
    )
  }

  return (
    <div
      className="app"
      style={Object.fromEntries(Object.entries(groupColors).map(([id, c]) => [`--gc-${id}`, c])) as React.CSSProperties}
    >
      <MapCanvas restaurants={visibleRestaurants} groups={groups} onPick={pickRestaurant} focus={focusTarget ?? undefined} />

      <div className="app__chrome">
        <Header
          onOpenFilter={() => setFilterOpen(true)}
          activeGroupCount={activeGroupIds.size}
          query={query}
          onQueryChange={setQuery}
        />
        <div className="review-filter" role="group" aria-label="후기 유무 필터">
          {(
            [
              ['all', '전체'],
              ['with', '후기 있음'],
              ['without', '후기 없음'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`review-filter__chip${reviewFilter === value ? ' review-filter__chip--active' : ''}`}
              aria-pressed={reviewFilter === value}
              onClick={() => setReviewFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {query.trim() ? (
          <SearchResults
            results={visibleRestaurants}
            groups={groups}
            tooShort={query.trim().length < MIN_QUERY_LENGTH}
            minLength={MIN_QUERY_LENGTH}
            onPick={focusFromSearch}
          />
        ) : (
          <StoryStrip stories={todayStories} />
        )}
      </div>

      <GroupFilterSheet
        open={filterOpen}
        groups={groups}
        activeGroupIds={activeGroupIds}
        colors={groupColors}
        onToggle={toggleGroup}
        onColorChange={(id, color) => setGroupColors((prev) => ({ ...prev, [id]: color }))}
        onClose={() => setFilterOpen(false)}
      />

      <RestaurantSheet
        restaurant={selectedRestaurant}
        groups={groups}
        onClose={() => setSelectedId(null)}
        onStartMeetup={(restaurant) => setMeetupRestaurant(restaurant)}
        onAddReview={addReview}
        onAddComment={addComment}
      />

      <MeetupSheet restaurant={meetupRestaurant} friends={friends} onClose={() => setMeetupRestaurant(null)} />
    </div>
  )
}
