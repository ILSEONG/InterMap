import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import Header from './components/Header'
import SearchResults from './components/SearchResults'
import StoryStrip from './components/StoryStrip'
import MapCanvas from './components/MapCanvas'
import GroupFilterSheet from './components/GroupFilterSheet'
import AuthModal from './components/AuthModal'
import type { AuthMode } from './components/AuthModal'
import RestaurantSheet from './components/RestaurantSheet'
import MeetupSheet from './components/MeetupSheet'
import { groups, friends, me, restaurants as initialRestaurants, groupById, friendById } from './data/mock'
import type { GroupId, Restaurant } from './data/mock'
import { fetchRestaurants, fetchRestaurantCells, fetchMe, logout, SUMMARY_MAX_ZOOM } from './lib/api'
import type { AuthSession, BBox, ClusterCell, RestaurantRecord, SocialLink } from './lib/api'
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

function mergeRecords(prev: Restaurant[], records: RestaurantRecord[]): Restaurant[] {
  // 이동(idle)마다 수천 건이 들어오므로 매 건 find로 훑지 않고 이름+주소 인덱스로 찾는다
  const byKey = new Map<string, Restaurant>()
  for (const r of prev) byKey.set(`${r.name}|${r.address}`, r)
  const merged = [...prev]
  let changed = false
  for (const record of records) {
    const existing = byKey.get(`${record.name}|${record.roadAddress}`) ?? byKey.get(`${record.name}|${record.address}`)
    if (existing) {
      const closed = record.status === 'CLOSED'
      if (existing.closed !== closed) {
        existing.closed = closed
        changed = true
      }
    } else {
      const added = toRestaurant(record)
      merged.push(added)
      byKey.set(`${added.name}|${added.address}`, added)
      changed = true
    }
  }
  // 달라진 게 없으면 이전 배열을 그대로 돌려줘서 재군집·마커 재생성을 막는다
  return changed ? merged : prev
}

// bbox를 고정 격자에 스냅한다. 조금만 움직여도 URL이 통째로 바뀌면
// 서버의 6시간 HTTP 캐시가 한 번도 안 맞는다 — 같은 타일이면 같은 URL이 되게.
const SNAP_DEG = 0.02
const snapBBox = (b: BBox): BBox => ({
  minLat: Number((Math.floor(b.minLat / SNAP_DEG) * SNAP_DEG).toFixed(5)),
  maxLat: Number((Math.ceil(b.maxLat / SNAP_DEG) * SNAP_DEG).toFixed(5)),
  minLng: Number((Math.floor(b.minLng / SNAP_DEG) * SNAP_DEG).toFixed(5)),
  maxLng: Number((Math.ceil(b.maxLng / SNAP_DEG) * SNAP_DEG).toFixed(5)),
})

export default function App() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>(initialRestaurants)

  // 낮은 줌에서 받는 서버 요약 셀. 격자 인덱스 키로 누적한다 — 통째로 갈아끼우면
  // 응답이 올 때까지 마커가 사라져서 이동할 때마다 화면이 깜빡인다.
  const [cellStore, setCellStore] = useState<{ zoom: number; byKey: Map<string, ClusterCell> } | null>(null)
  // 같은 타일을 연달아 요청하지 않기 위한 마지막 요청 키
  const lastFetchKey = useRef('')

  // 전체를 한 번에 받는 대신, 지도가 멈출 때마다 보이는 영역만 받아 누적한다.
  // 한 번 본 영역의 가게는 목록에 남으므로 검색·필터는 본 영역 기준으로 동작한다.
  // 줌이 낮으면(넓은 영역) 개별 가게 대신 서버 격자 요약만 받는다.
  const loadViewport = useCallback((bbox: BBox, zoom: number) => {
    const snapped = snapBBox(bbox)
    const cellMode = zoom <= SUMMARY_MAX_ZOOM
    const key = `${cellMode ? `s${zoom}` : 'r'}:${snapped.minLat},${snapped.minLng},${snapped.maxLat},${snapped.maxLng}`
    if (key === lastFetchKey.current) return
    lastFetchKey.current = key
    if (cellMode) {
      // zoom-1로 요청하면 서버 셀 한 변이 2배(52px)가 되어 셀 수가 1/4로 준다 —
      // 밀집 지역에서 마커 수백 개가 깔리면 모바일 WebView가 깜빡인다
      fetchRestaurantCells(snapped, zoom - 1)
        .then((fresh) => {
          // 서버와 같은 격자 인덱스로 키를 만들어 누적한다. 같은 셀은 최신 응답으로
          // 덮어써서 bbox 경계에 걸려 잘렸던 건수를 교정한다. 줌이 바뀌면 격자가
          // 달라지므로 처음부터 다시 쌓는다.
          const cellDeg = (360 * 26) / (256 * 2 ** (zoom - 1))
          setCellStore((prev) => {
            const byKey = prev && prev.zoom === zoom ? new Map(prev.byKey) : new Map<string, ClusterCell>()
            for (const c of fresh) byKey.set(`${Math.floor(c.lat / cellDeg)}:${Math.floor(c.lng / cellDeg)}`, c)
            return { zoom, byKey }
          })
        })
        .catch(() => {})
    } else {
      fetchRestaurants(snapped)
        .then((records) => setRestaurants((prev) => mergeRecords(prev, records)))
        .catch(() => {
          // 백엔드 미기동 시 목데이터만으로 동작
        })
    }
  }, [])
  // 누적된 셀을 배열로. byKey 자체가 바뀔 때만 다시 만든다.
  const cellList = useMemo(() => (cellStore ? [...cellStore.byKey.values()] : []), [cellStore])
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
  // 검색어를 가게 이름/주소로 볼지, 후기 작성자 이름으로 볼지
  const [searchMode, setSearchMode] = useState<'restaurant' | 'person'>('restaurant')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 같은 가게를 다시 골라도 지도가 이동하도록 매번 새 객체를 만든다.
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null)
  const [meetupRestaurant, setMeetupRestaurant] = useState<Restaurant | null>(null)

  // 로그인 세션. 앱을 껐다 켜도 유지되도록 localStorage에 둔다.
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('intermap.session') ?? 'null')
    } catch {
      return null
    }
  })
  // 소셜 로그인은 했지만 아직 우리 계정과 연결 안 된 경우의 서버 티켓 (계정 연결 화면용)
  const [socialLink, setSocialLink] = useState<SocialLink | null>(null)
  const handleAuthed = useCallback((next: AuthSession) => {
    setSession(next)
    setAuthMode(null)
    setSocialLink(null)
    try {
      localStorage.setItem('intermap.session', JSON.stringify(next))
    } catch {
      // 저장 실패해도 이번 실행 동안은 로그인 상태 유지
    }
  }, [])
  const handleLogout = useCallback(() => {
    // 서버 토큰부터 지운다 — authHeaders()가 localStorage를 읽으므로 삭제 전에 호출해야 한다
    void logout()
    setSession(null)
    try {
      localStorage.removeItem('intermap.session')
    } catch {
      // 무시
    }
  }, [])

  // 앱 시작 시 저장된 세션이 서버에서도 유효한지 확인. 만료·다른 기기 로그아웃이면 조용히 로그아웃 상태로.
  useEffect(() => {
    if (!session) return
    fetchMe()
      .then((me) => {
        if (me === null) handleLogout()
      })
      .catch(() => {
        // 네트워크 오류는 세션 유지 — 다음 요청에서 다시 판단
      })
    // 최초 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 소셜 로그인 완료 후 백엔드가 연결된 회원이면 ?token=&email=&nickname=, 아니면 ?linkTicket=&provider=&email=,
  // 실패 시 ?authError= 를 달고 돌려보낸다
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    const linkTicket = params.get('linkTicket')
    const provider = params.get('provider') as SocialLink['provider'] | null
    const email = params.get('email')
    const nickname = params.get('nickname')
    const authError = params.get('authError')
    if (!token && !linkTicket && !authError) return
    if (token && email && nickname) handleAuthed({ token, email, nickname })
    if (linkTicket && provider) {
      setSocialLink({ ticket: linkTicket, provider, email: email ?? undefined })
      setAuthMode('link')
    }
    if (authError) alert(authError)
    window.history.replaceState(null, '', window.location.pathname)
  }, [handleAuthed])

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
            (searchMode === 'restaurant'
              ? `${r.name} ${r.category} ${r.address}`.toLowerCase().includes(keyword)
              : r.reviews.some((rev) => friendById(rev.friendId)?.name.toLowerCase().includes(keyword)))),
      )
    },
    [restaurants, activeGroupIds, reviewFilter, searchMode, deferredQuery],
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
      <MapCanvas
        restaurants={visibleRestaurants}
        groups={groups}
        // 요약 셀 = 후기 없는 그룹 미지정 가게 덩어리. 필터·검색으로 그런 가게가
        // 안 보이는 상태면 셀도 같이 숨긴다 (개별 핀과 기준을 맞춘다).
        cells={
          reviewFilter !== 'with' && activeGroupIds.has('none') && deferredQuery.trim().length < MIN_QUERY_LENGTH
            ? cellList
            : []
        }
        onPick={pickRestaurant}
        focus={focusTarget ?? undefined}
        onViewportChange={loadViewport}
      />

      <div className="app__chrome">
        <Header
          query={query}
          onQueryChange={setQuery}
          searchMode={searchMode}
          onSearchModeChange={setSearchMode}
          nickname={session?.nickname ?? null}
          onLogin={() => setAuthMode('login')}
          onSignup={() => setAuthMode('signup')}
          onLogout={handleLogout}
        />
        <div className="bottom-controls">
          <button type="button" className="map-filter-btn" onClick={() => setFilterOpen(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 6H20M7 12H17M10 18H14" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
            맵필터
            {activeGroupIds.size > 0 && <span className="map-filter-btn__badge">{activeGroupIds.size}</span>}
          </button>
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

      <AuthModal
        mode={authMode}
        link={socialLink}
        onClose={() => {
          setAuthMode(null)
          setSocialLink(null)
        }}
        onSwitch={(next) => {
          setSocialLink(null)
          setAuthMode(next)
        }}
        onAuthed={handleAuthed}
      />
    </div>
  )
}
