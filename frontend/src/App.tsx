import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import Header from './components/Header'
import SearchResults from './components/SearchResults'
import PersonChip from './components/PersonChip'
import StoryStrip from './components/StoryStrip'
import StoryViewer from './components/StoryViewer'
import MapCanvas from './components/MapCanvas'
import AuthModal from './components/AuthModal'
import type { AuthMode } from './components/AuthModal'
import RestaurantSheet from './components/RestaurantSheet'
import MyPage from './components/MyPage'
import { groups } from './data/model'
import type { Comment, GroupId, Restaurant, Review, Story } from './data/model'
import {
  fetchRestaurants,
  searchRestaurants,
  fetchRestaurantCells,
  fetchMe,
  fetchReviews,
  fetchSocial,
  postReview,
  updateReview,
  deleteReview,
  isAdmin,
  restaurantKey,
  logout,
  SUMMARY_MAX_ZOOM,
} from './lib/api'
import { topPicksOf } from './lib/topPicks'
import { shrinkImage } from './lib/image'
import type { AuthSession, BBox, ClusterCell, RestaurantRecord, SocialData, SocialTicket } from './lib/api'
import './App.css'

// 한 글자로는 결과가 너무 많이 걸려 두 글자부터 검색한다.
const MIN_QUERY_LENGTH = 2

/*
  THESIS: the map is a lively neighborhood scene where a friend's pick pops up
  like a doodle character you tap, not a data dashboard of pins.
  OWN-WORLD: chunky ink-outlined shapes, candy-bright per-group color, soft
  floating shadows, Jua display type over Pretendard body text.
  STORY: open app -> see illustrated map with friends' story chips and
  colored pins -> tap a pin -> read neighbor reviews and their comments.
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
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])

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
          // 백엔드 미기동 시 빈 지도
        })
    }
  }, [])
  // 누적된 셀을 배열로. byKey 자체가 바뀔 때만 다시 만든다.
  const cellList = useMemo(() => (cellStore ? [...cellStore.byKey.values()] : []), [cellStore])
  // 그룹별 마커 색. --gc-* CSS 변수로 앱 루트에 내려가고 모든 컴포넌트가 var()로 참조한다.
  // 저채도 연한 파랑 기본값 — 밝은 지도 배경과 명도 대비를 낮춰 핀 밀집 시 "구멍 무리" 착시(환공포증 유발)를 줄인다.
  const [groupColors] = useState<Record<GroupId, string>>({
    close: '#A9C4E3',
    work: '#A9C4E3',
    college: '#A9C4E3',
    none: '#A9C4E3',
  })
  // 후기 유무 필터: 전체 / 후기 있는 곳만 / 없는 곳만
  const [reviewFilter, setReviewFilter] = useState<'all' | 'with' | 'without'>('with')
  // 검색어를 가게 이름/주소로 볼지, 후기 작성자 이름으로 볼지
  const [searchMode, setSearchMode] = useState<'restaurant' | 'person'>('restaurant')
  const [query, setQuery] = useState('')
  // 지도가 추적 중인 내 위치. 검색 결과를 가까운 순으로 정렬하는 데만 쓴다.
  // ~50m 안쪽 흔들림은 무시 — watchPosition이 자주 쏘는데 그때마다 재정렬하면 목록이 떨린다.
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null)
  const handleMyLocation = useCallback((pos: { lat: number; lng: number }) => {
    setMyLocation((prev) => (prev && Math.abs(prev.lat - pos.lat) < 0.0005 && Math.abs(prev.lng - pos.lng) < 0.0005 ? prev : pos))
  }, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 같은 가게를 다시 골라도 지도가 이동하도록 매번 새 객체를 만든다.
  const [focusTarget, setFocusTarget] = useState<{ id: string } | null>(null)
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
  const [socialLink, setSocialLink] = useState<SocialTicket | null>(null)
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

  // 서버 후기 전체 (최신순). 이웃 후기·주인장 후기·스토리가 전부 여기서 나온다.
  // 로그인한 사람에게만 보인다 — 로그아웃하면 마커·스토리도 같이 사라져야 한다.
  const [rawReviews, setRawReviews] = useState<Review[]>([])
  useEffect(() => {
    if (!session) {
      setRawReviews([])
      return
    }
    let cancelled = false
    fetchReviews()
      .then((list) => {
        if (!cancelled) setRawReviews(list)
      })
      .catch(() => {
        // 못 받으면 후기 없는 지도로 동작
      })
    return () => {
      cancelled = true
    }
  }, [session])
  // 마이페이지: 팔로잉·팔로워·별칭. 로그인하면 받아 둔다 — 후기 작성자 이름에 별칭을 씌우는 데 쓴다.
  const [social, setSocial] = useState<SocialData | null>(null)
  const [myPageOpen, setMyPageOpen] = useState(false)
  // 헤더 친구 목록에서 고른 사람. 그 사람이 후기 쓴 가게만 지도·목록에 남긴다.
  const [personId, setPersonId] = useState<number | null>(null)
  const followingPeople = useMemo(
    () => social?.following.map((p) => ({ id: p.id, name: p.alias ?? p.nickname })) ?? null,
    [social],
  )
  // 언팔로우·로그아웃으로 목록에서 빠지면 선택도 자동 해제
  const selectedPerson = followingPeople?.find((p) => p.id === personId) ?? null
  // 사람을 고르면 그 사람 후기 가게만 핀으로. 칩 ✕로 해제.
  const personPins = selectedPerson !== null
  useEffect(() => {
    if (!session) {
      setSocial(null)
      setMyPageOpen(false)
      return
    }
    let cancelled = false
    fetchSocial()
      .then((data) => {
        if (!cancelled) setSocial(data)
      })
      .catch(() => {
        // 못 받으면 별칭 없이 동작
      })
    return () => {
      cancelled = true
    }
  }, [session])
  // 팔로우한 사람(+나, 주인장)의 후기만 남기고, 내가 붙인 이름을 작성자 이름 자리에 씌운다.
  // 가게 시트·스토리·사람 검색이 전부 이 목록을 쓴다. social을 못 받았으면 필터 없이 동작.
  const reviews = useMemo(() => {
    const followingIds = social ? new Set(social.following.map((p) => p.id)) : null
    const filtered = followingIds
      ? rawReviews.filter((rv) => rv.author.owner || rv.author.id === session?.id || followingIds.has(rv.author.id))
      : rawReviews
    const alias = new Map<number, string>()
    for (const p of [...(social?.following ?? []), ...(social?.followers ?? [])]) if (p.alias) alias.set(p.id, p.alias)
    if (alias.size === 0) return filtered
    return filtered.map((rv) => {
      const name = alias.get(rv.author.id)
      return name ? { ...rv, author: { ...rv.author, name } } : rv
    })
  }, [rawReviews, social, session])
  // 이웃 후기를 가게에 붙인다. 주인장 후기는 시트에서 따로 보여주므로 뺀다.
  // 후기 없는 가게는 객체를 그대로 둬서 마커가 다시 그려지지 않게 한다.
  // 후기 있는 가게는 줌·뷰포트와 무관하게 항상 보여야 하므로, 아직 뷰포트로 안 받은 가게는
  // 후기에 실린 좌표로 임시 객체를 만든다 (나중에 같은 가게가 뷰포트로 들어오면 그쪽으로 대체).
  const reviewedRestaurants = useMemo(() => {
    const byKey = new Map<string, Review[]>()
    for (const rv of reviews) {
      if (rv.author.owner) continue
      const key = restaurantKey(rv.restaurant)
      byKey.set(key, [...(byKey.get(key) ?? []), rv])
    }
    const loaded = new Set<string>()
    const merged: Restaurant[] = restaurants.map((r) => {
      const key = restaurantKey(r)
      loaded.add(key)
      const list = byKey.get(key)
      return list ? { ...r, reviews: list } : r
    })
    for (const [key, list] of byKey) {
      const place = list[0].restaurant
      if (loaded.has(key) || place.lat == null || place.lng == null) continue
      merged.push({
        // ponytail: 뷰포트로 같은 가게가 들어오면 id가 db-로 바뀌어 선택이 풀린다. 문제 되면 선택을 키로 추적할 것
        id: `rv-${key}`,
        name: place.name,
        category: place.category,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        groupIds: [],
        reviews: list,
      })
    }
    return merged
  }, [restaurants, reviews])
  // 스토리: 최근 24시간 안에 후기를 남긴 사람마다 하나. reviews가 최신순이라 최근 작성자가 앞에 온다.
  const stories = useMemo(() => {
    const since = Date.now() - 24 * 3_600_000
    const byAuthor = new Map<number, Story>()
    for (const rv of reviews) {
      // 주인장 후기는 가게 시트 전용 — 스토리엔 이웃 후기만
      if (rv.author.owner || Date.parse(rv.createdAt) < since) continue
      const story = byAuthor.get(rv.author.id) ?? { id: rv.author.id, name: rv.author.name, avatar: rv.author.avatar, reviews: [] }
      story.reviews.push(rv)
      byAuthor.set(rv.author.id, story)
    }
    const list = [...byAuthor.values()]
    // 내 스토리가 있으면 맨 앞으로
    const myIndex = session?.id != null ? list.findIndex((s) => s.id === session.id) : -1
    if (myIndex > 0) list.unshift(...list.splice(myIndex, 1))
    return list
  }, [reviews, session?.id])
  const [openStory, setOpenStory] = useState<Story | null>(null)


  // 앱 시작 시 저장된 세션이 서버에서도 유효한지 확인. 만료·다른 기기 로그아웃이면 조용히 로그아웃 상태로.
  useEffect(() => {
    if (!session) return
    fetchMe()
      .then((me) => {
        // 유효하면 서버 값으로 갱신 — 예전에 저장된 세션에 id가 없을 수 있다
        if (me === null) handleLogout()
        else handleAuthed(me)
      })
      .catch(() => {
        // 네트워크 오류는 세션 유지 — 다음 요청에서 다시 판단
      })
    // 최초 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 소셜 로그인 완료 후 백엔드가 연결된 회원이면 ?token=&email=&nickname=,
  // 같은 이메일 계정이 있으면 ?linkTicket=, 처음이면 ?signupTicket= (둘 다 &provider=&email=&nickname= 동반),
  // 실패 시 ?authError= 를 달고 돌려보낸다
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    const linkTicket = params.get('linkTicket')
    const signupTicket = params.get('signupTicket')
    const provider = params.get('provider') as SocialTicket['provider'] | null
    const email = params.get('email')
    const nickname = params.get('nickname')
    const authError = params.get('authError')
    if (!token && !linkTicket && !signupTicket && !authError) return
    if (token && nickname) handleAuthed({ token, email, nickname })
    const ticket = linkTicket ?? signupTicket
    if (ticket && provider) {
      setSocialLink({ ticket, provider, email: email ?? undefined, nickname: nickname ?? undefined })
      setAuthMode(linkTicket ? 'link' : 'social')
    }
    if (authError) alert(authError)
    window.history.replaceState(null, '', window.location.pathname)
  }, [handleAuthed])

  // 입력은 즉시 반영하고 지도 마커 재생성처럼 무거운 작업만 뒤로 미룬다.
  const deferredQuery = useDeferredValue(query)
  // 검색 결과 목록 표시 여부. 입력 중엔 열리고, Enter나 결과 선택으로 닫힌다 — 키워드와 지도 필터는 남는다.
  const [resultsOpen, setResultsOpen] = useState(true)
  const searchActive = deferredQuery.trim().length >= MIN_QUERY_LENGTH

  // 가게 이름 검색은 서버에도 물어본다 — 아직 뷰포트로 안 받은 영역의 가게도 걸리게.
  // 받은 건 누적 목록에 합쳐두고 필터·핀은 기존 경로를 그대로 탄다.
  useEffect(() => {
    if (!searchActive || searchMode !== 'restaurant') return
    let cancelled = false
    searchRestaurants(deferredQuery.trim())
      .then((records) => {
        if (!cancelled) setRestaurants((prev) => mergeRecords(prev, records))
      })
      .catch(() => {
        // 실패하면 클라이언트에 있는 목록만으로 검색
      })
    return () => {
      cancelled = true
    }
  }, [searchActive, searchMode, deferredQuery])
  const selectedRestaurant = useMemo(
    () => reviewedRestaurants.find((r) => r.id === selectedId) ?? null,
    [reviewedRestaurants, selectedId],
  )

  const visibleRestaurants = useMemo(
    () => {
      const raw = deferredQuery.trim()
      const keyword = raw.length >= MIN_QUERY_LENGTH ? raw.toLowerCase() : ''
      const pid = personPins ? selectedPerson.id : null
      return reviewedRestaurants.filter(
        (r) =>
          // 친구 한 명을 골랐으면 그 사람 후기가 있는 가게만 (후기 필터는 무의미하니 건너뛴다)
          (pid === null
            ? // 검색 시작 시 필터가 '전체'로 리셋되므로(Header onQueryChange), 검색 중에도 필터를 그대로 적용한다
              reviewFilter === 'all' || (reviewFilter === 'with') === r.reviews.length > 0
            : r.reviews.some((rev) => rev.author.id === pid)) &&
          (keyword === '' ||
            (searchMode === 'restaurant'
              ? `${r.name} ${r.category} ${r.address}`.toLowerCase().includes(keyword)
              : r.reviews.some((rev) => rev.author.name.toLowerCase().includes(keyword)))),
      )
    },
    [reviewedRestaurants, reviewFilter, searchMode, deferredQuery, selectedPerson, personPins],
  )

  // 고른 친구의 별점 TOP 5 (칩 아래 카드). 핀 필터와 무관하게 전체 목록에서 뽑는다.
  const selectedPersonPicks = useMemo(
    () => (selectedPerson ? topPicksOf(reviewedRestaurants, selectedPerson.id) : []),
    [reviewedRestaurants, selectedPerson],
  )

  // 가게 검색 목록은 후기 있는 가게 먼저, 그 안에서 내 위치에서 가까운 순. 위치를 아직 모르면 원래 순서 유지.
  // 지도 핀엔 순서가 무의미하니 visibleRestaurants는 건드리지 않는다 (마커 재생성 방지).
  const searchResults = useMemo(() => {
    if (searchMode !== 'restaurant') return visibleRestaurants
    // 정렬용이라 정확한 거리 대신 위도 보정한 평면 거리 제곱으로 충분
    const k = myLocation ? Math.cos((myLocation.lat * Math.PI) / 180) : 0
    const d2 = (r: Restaurant) =>
      myLocation ? (r.lat - myLocation.lat) ** 2 + ((r.lng - myLocation.lng) * k) ** 2 : 0
    return [...visibleRestaurants].sort(
      (a, b) => Number(b.reviews.length > 0) - Number(a.reviews.length > 0) || d2(a) - d2(b),
    )
  }, [visibleRestaurants, myLocation, searchMode])

  // 사람 검색이면 이름이 걸린 사람마다 별점 높은 가게 TOP 5를 요약해 보여준다
  const personPicks = useMemo(() => {
    const keyword = deferredQuery.trim().toLowerCase()
    if (searchMode !== 'person' || keyword.length < MIN_QUERY_LENGTH) return []
    const authors = new Map<number, { id: number; name: string }>()
    for (const rv of reviews) if (!rv.author.owner) authors.set(rv.author.id, rv.author)
    return [...authors.values()]
      .filter((a) => a.name.toLowerCase().includes(keyword))
      .map((author) => ({ author, picks: topPicksOf(visibleRestaurants, author.id) }))
      .filter(({ picks }) => picks.length > 0)
  }, [searchMode, deferredQuery, reviews, visibleRestaurants])

  // 매 렌더마다 새 함수를 넘기면 MapCanvas가 마커를 통째로 다시 그린다.
  const pickRestaurant = useCallback((restaurant: Restaurant) => setSelectedId(restaurant.id), [])
  // 검색 결과 선택은 지도만 옮긴다. 상세는 지도에서 핀을 눌러 연다.
  // 고르고 나면 결과 목록이 지도를 가리지 않도록 검색어를 비운다.
  // 결과 하나를 고르면 목록만 닫고 키워드는 남긴다 — 지도는 계속 그 키워드로 걸러진 채 그 가게로 이동
  const focusFromSearch = useCallback((restaurant: Restaurant) => {
    setFocusTarget({ id: restaurant.id })
    setResultsOpen(false)
  }, [])

  // 스토리의 "지도에서 보기" — 후기가 가리키는 가게를 찾아 스토리를 닫고 지도를 옮긴다
  const focusFromStory = useCallback(
    (review: Review) => {
      const key = restaurantKey(review.restaurant)
      const target = reviewedRestaurants.find((r) => restaurantKey(r) === key)
      if (!target) return
      setOpenStory(null)
      focusFromSearch(target)
    },
    [reviewedRestaurants, focusFromSearch],
  )

  // 마이페이지 "내가 쓴 후기" — 눌러서 그 가게 시트를 연다 (수정은 시트의 수정 버튼으로)
  const openMyReview = useCallback(
    (review: Review) => {
      const key = restaurantKey(review.restaurant)
      const target = reviewedRestaurants.find((r) => restaurantKey(r) === key)
      if (!target) return
      setMyPageOpen(false)
      setSelectedId(target.id)
      focusFromSearch(target)
    },
    [reviewedRestaurants, focusFromSearch],
  )

  // 후기는 서버에 저장된다. 로그인 안 했으면 로그인 창을 띄운다. 사진은 줄여서 함께 올린다.
  async function addReview(restaurantId: string, rating: number, text: string, photos: File[]) {
    if (!session) {
      setAuthMode('start')
      // resolve하면 폼이 성공으로 알고 입력(사진·글)을 지운다 — reject로 입력을 지킨다
      throw new Error('로그인 후 다시 등록을 눌러주세요.')
    }
    const target = reviewedRestaurants.find((r) => r.id === restaurantId)
    if (!target) {
      alert('가게 정보를 찾지 못했어요. 잠시 후 다시 시도해주세요.')
      throw new Error('가게 정보를 찾지 못했어요.')
    }
    try {
      const shrunk = await Promise.all(photos.map((f) => shrinkImage(f)))
      const saved = await postReview({ name: target.name, category: target.category, address: target.address }, rating, text, shrunk)
      setRawReviews((prev) => [saved, ...prev])
    } catch (e) {
      alert((e as Error).message)
      throw e
    }
  }

  // 내 후기 수정. 서버가 본인 확인을 하고 바뀐 후기를 돌려준다.
  async function editReview(reviewId: number, rating: number, text: string, keepPhotoIds: number[], photos: File[]) {
    try {
      const shrunk = await Promise.all(photos.map((f) => shrinkImage(f)))
      const saved = await updateReview(reviewId, rating, text, keepPhotoIds, shrunk)
      setRawReviews((prev) => prev.map((r) => (r.id === saved.id ? saved : r)))
    } catch (e) {
      alert((e as Error).message)
      throw e
    }
  }

  async function removeReview(reviewId: number) {
    try {
      await deleteReview(reviewId)
      setRawReviews((prev) => prev.filter((r) => r.id !== reviewId))
    } catch (e) {
      alert((e as Error).message)
      throw e
    }
  }

  // 후기별 댓글 — 아직 클라이언트에만 남는다 (새로고침하면 사라짐)
  const [reviewComments, setReviewComments] = useState<Record<number, Comment[]>>({})
  function addComment(reviewId: number, text: string, parentId?: string) {
    if (!session) {
      setAuthMode('start')
      return
    }
    const authorName = session.nickname
    setReviewComments((prev) => ({
      ...prev,
      [reviewId]: [...(prev[reviewId] ?? []), { id: `c-${Date.now()}`, authorName, text, parentId }],
    }))
  }

  return (
    <div
      className="app"
      style={Object.fromEntries(Object.entries(groupColors).map(([id, c]) => [`--gc-${id}`, c])) as React.CSSProperties}
    >
      <MapCanvas
        restaurants={visibleRestaurants}
        groups={groups}
        // 요약 셀 = 후기 없는 가게 덩어리. 필터·검색으로 그런 가게가
        // 안 보이는 상태면 셀도 같이 숨긴다 (개별 핀과 기준을 맞춘다).
        cells={reviewFilter !== 'with' && !personPins && deferredQuery.trim().length < MIN_QUERY_LENGTH ? cellList : []}
        pinsWhenFar={reviewFilter === 'with' || searchActive || personPins}
        onPick={pickRestaurant}
        focus={focusTarget ?? undefined}
        onViewportChange={loadViewport}
        onMyLocation={handleMyLocation}
      />

      <div className="app__chrome">
        <Header
          query={query}
          onQueryChange={(value) => {
            // 검색이 시작되는 순간 후기 필터를 '전체'로 되돌린다 — 이후 사용자가 고르면 검색 중에도 그 필터가 적용된다
            if (query.trim().length < MIN_QUERY_LENGTH && value.trim().length >= MIN_QUERY_LENGTH) setReviewFilter('all')
            setQuery(value)
            setResultsOpen(true)
          }}
          onSubmit={() => setResultsOpen(false)}
          onSearchFocus={() => setResultsOpen(true)}
          searchMode={searchMode}
          onSearchModeChange={setSearchMode}
          nickname={session?.nickname ?? null}
          onLogin={() => setAuthMode('start')}
          onLogout={handleLogout}
          onMyPage={() => setMyPageOpen(true)}
          following={followingPeople}
          selectedPersonId={selectedPerson?.id ?? null}
          onSelectPerson={setPersonId}
        />
        <div className="bottom-controls" hidden={personPins}>
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
        {query.trim() && resultsOpen ? (
          <SearchResults
            results={searchResults}
            topPicks={personPicks}
            groups={groups}
            // 지연값 기준 — 동기값으로 풀면 키워드 없는 전체 목록(수천 행)이 먼저 동기 렌더돼 입력이 멈춘다
            tooShort={!searchActive}
            minLength={MIN_QUERY_LENGTH}
            onPick={focusFromSearch}
          />
        ) : (
          <StoryStrip stories={stories} onOpen={setOpenStory} />
        )}
        {/* 스토리는 항상 헤더 바로 아래 — 칩은 그 밑에 */}
        {selectedPerson && (
          <PersonChip
            name={selectedPerson.name}
            picks={selectedPersonPicks}
            onPick={focusFromSearch}
            onClose={() => setPersonId(null)}
          />
        )}
      </div>


      <RestaurantSheet
        restaurant={selectedRestaurant}
        ownerReviews={
          selectedRestaurant
            ? reviews.filter((rv) => rv.author.owner && restaurantKey(rv.restaurant) === restaurantKey(selectedRestaurant))
            : []
        }
        asOwner={isAdmin(session)}
        groups={groups}
        onClose={() => setSelectedId(null)}
        myUserId={session?.id}
        onAddReview={addReview}
        onEditReview={editReview}
        onDeleteReview={removeReview}
        comments={reviewComments}
        onAddComment={addComment}
      />

      {session && (
        <MyPage
          open={myPageOpen}
          session={session}
          social={social}
          onSocialChange={setSocial}
          onSessionChange={handleAuthed}
          myReviews={rawReviews.filter((rv) => rv.author.id === session.id)}
          onOpenReview={openMyReview}
          onClose={() => setMyPageOpen(false)}
        />
      )}

      <StoryViewer stories={stories} story={openStory} allReviews={reviews} onFocusRestaurant={focusFromStory} onClose={() => setOpenStory(null)} />

      <AuthModal
        mode={authMode}
        social={socialLink}
        onClose={() => {
          setAuthMode(null)
          setSocialLink(null)
        }}
        onAuthed={handleAuthed}
      />
    </div>
  )
}
