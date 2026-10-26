import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import Header from './components/Header'
import SearchResults from './components/SearchResults'
import SearchDock from './components/SearchDock'
import PersonChip from './components/PersonChip'
import StoryStrip from './components/StoryStrip'
import StoryViewer from './components/StoryViewer'
import MapCanvas from './components/MapCanvas'
import AuthModal from './components/AuthModal'
import type { AuthMode } from './components/AuthModal'
import RestaurantSheet from './components/RestaurantSheet'
import MyPage from './components/MyPage'
import ProfileSheet from './components/ProfileSheet'
import { OpenProfileContext } from './lib/openProfile'
import { groups } from './data/model'
import type { Comment, GroupId, Restaurant, Review, Story } from './data/model'
import {
  fetchRestaurants,
  searchRestaurants,
  fetchRestaurantCells,
  fetchMe,
  fetchReviews,
  fetchComments,
  postComment,
  deleteComment,
  fetchFavorites,
  toggleFavorite,
  fetchSocial,
  searchUsers,
  followUser,
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
import type { AuthSession, BBox, ClusterCell, RestaurantRecord, SocialData, SocialTicket, UserItem } from './lib/api'
import './App.css'

// 한 글자로는 결과가 너무 많이 걸려 두 글자부터 검색한다.
const MIN_QUERY_LENGTH = 2

/*
  THESIS: the map is always the ground; everything else floats over it as
  Liquid Glass — translucent capsules and sheets that keep the map visible.
  OWN-WORLD: frosted glass controls, concentric radii, one rose accent,
  Noto Sans KR, primary actions gathered in a bottom dock for one-handed use.
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
  }
}

// 서버는 영업 중인 가게만 준다 (폐업은 목록에서 빠진다)
function mergeRecords(prev: Restaurant[], records: RestaurantRecord[]): Restaurant[] {
  // 이동(idle)마다 수천 건이 들어오므로 매 건 find로 훑지 않고 이름+주소 인덱스로 찾는다
  const seen = new Set<string>()
  for (const r of prev) seen.add(`${r.name}|${r.address}`)
  const merged = [...prev]
  let changed = false
  for (const record of records) {
    if (seen.has(`${record.name}|${record.roadAddress}`) || seen.has(`${record.name}|${record.address}`)) continue
    const added = toRestaurant(record)
    merged.push(added)
    seen.add(`${added.name}|${added.address}`)
    changed = true
  }
  // 달라진 게 없으면 이전 배열을 그대로 돌려줘서 재군집·마커 재생성을 막는다
  return changed ? merged : prev
}

// 서버 요약 셀의 격자 인덱스 (서버 summarize의 floor(lat / cell), floor(lng / cell)과 같은 식)
const cellKey = (lat: number, lng: number, cellDeg: number) => `${Math.floor(lat / cellDeg)}:${Math.floor(lng / cellDeg)}`

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
  const [cellStore, setCellStore] = useState<{ zoom: number; cellDeg: number; byKey: Map<string, ClusterCell> } | null>(null)
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
      // zoom-2로 요청하면 서버 셀 한 변이 4배(104px)가 된다 — 셀 핀(38px 원, 네 자리면 더 넓다)이
      // 서로 겹치지 않고, 밀집 지역에서 마커 수백 개가 깔려 모바일 WebView가 깜빡이는 것도 막는다
      const cellZoom = zoom - 2
      fetchRestaurantCells(snapped, cellZoom)
        .then((fresh) => {
          // 서버와 같은 격자 인덱스로 키를 만들어 누적한다. 같은 셀은 최신 응답으로
          // 덮어써서 bbox 경계에 걸려 잘렸던 건수를 교정한다. 줌이 바뀌면 격자가
          // 달라지므로 처음부터 다시 쌓는다.
          const cellDeg = (360 * 26) / (256 * 2 ** cellZoom)
          setCellStore((prev) => {
            const byKey = prev && prev.zoom === zoom ? new Map(prev.byKey) : new Map<string, ClusterCell>()
            for (const c of fresh) byKey.set(cellKey(c.lat, c.lng, cellDeg), c)
            return { zoom, cellDeg, byKey }
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
  // 그룹별 마커 색. --gc-* CSS 변수로 앱 루트에 내려가고 모든 컴포넌트가 var()로 참조한다.
  // 저채도 연한 파랑 기본값 — 밝은 지도 배경과 명도 대비를 낮춰 핀 밀집 시 "구멍 무리" 착시(환공포증 유발)를 줄인다.
  const [groupColors] = useState<Record<GroupId, string>>({
    close: '#FF5D73',
    work: '#2F7BF6',
    college: '#1FA38C',
    // 후기 없는 가게(대부분)는 이 색 — 밀집해도 눈에 덜 띄는 중간 회색
    none: '#A7A7AE',
  })
  // 후기 유무 필터: 전체 / 후기 있는 곳만 / 없는 곳만. 실제 적용값은 아래 reviewFilter (로그아웃이면 '전체')
  const [reviewFilterChoice, setReviewFilter] = useState<'all' | 'with' | 'without'>('with')
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
  // 후기는 로그인해야 받으므로 로그아웃이면 후기 필터가 무의미하다 — 필터를 숨기고 전부 보여준다
  const reviewFilter = session ? reviewFilterChoice : 'all'
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
  // 후기 id → 그 후기의 댓글들 (서버 /api/comments를 후기별로 나눠 둔 것)
  const [reviewComments, setReviewComments] = useState<Record<number, Comment[]>>({})
  // 내가 찜한 가게 키("이름|주소") 모음
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  // 헤더 별 버튼: 켜면 지도에 찜한 가게만 (후기 필터 무시, 초록 별 마커)
  const [favMode, setFavMode] = useState(false)
  // 하단 독이 검색 모드인지 (검색 버튼 → 입력창)
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    if (!session) {
      setRawReviews([])
      setReviewComments({})
      setFavorites(new Set())
      setFavMode(false)
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
    // 후기 댓글도 같이 받아 후기별로 나눠 둔다
    fetchComments()
      .then((records) => {
        if (cancelled) return
        const grouped: Record<number, Comment[]> = {}
        for (const c of records) {
          ;(grouped[c.reviewId] ??= []).push({ id: c.id, authorId: c.author.id, authorName: c.author.name, text: c.text, parentId: c.parentId })
        }
        setReviewComments(grouped)
      })
      .catch(() => {
        // 못 받으면 댓글 없는 상태로 동작
      })
    // 찜 목록도 같이
    fetchFavorites()
      .then((places) => {
        if (!cancelled) setFavorites(new Set(places.map(restaurantKey)))
      })
      .catch(() => {
        // 못 받으면 찜 없는 상태로 동작
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
  // 실패 시 ?authError= 를 달고 돌려보낸다. 웹은 리다이렉트 쿼리로, 앱은 intermap:// 딥링크로 들어온다.
  const applyAuthParams = useCallback(
    (params: URLSearchParams) => {
      const token = params.get('token')
      const linkTicket = params.get('linkTicket')
      const signupTicket = params.get('signupTicket')
      const provider = params.get('provider') as SocialTicket['provider'] | null
      const email = params.get('email')
      const nickname = params.get('nickname')
      const authError = params.get('authError')
      if (!token && !linkTicket && !signupTicket && !authError) return false
      if (token && nickname) {
        handleAuthed({ token, email, nickname })
        // 콜백 파라미터엔 id·avatar가 없다. 내 후기 판별이 session.id에 달려 있으니 서버 값으로 바로 채운다.
        // (handleAuthed가 localStorage에 토큰을 먼저 써야 fetchMe의 Authorization 헤더가 붙는다)
        fetchMe()
          .then((me) => me && handleAuthed(me))
          .catch(() => {
            // 네트워크 오류면 id 없는 세션으로 두고, 다음 실행 때 마운트 fetchMe가 채운다
          })
      }
      const ticket = linkTicket ?? signupTicket
      if (ticket && provider) {
        setSocialLink({ ticket, provider, email: email ?? undefined, nickname: nickname ?? undefined })
        setAuthMode(linkTicket ? 'link' : 'social')
      }
      if (authError) alert(authError)
      return true
    },
    [handleAuthed],
  )

  useEffect(() => {
    if (applyAuthParams(new URLSearchParams(window.location.search))) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [applyAuthParams])

  // 앱(WebView): 외부 브라우저에서 로그인이 끝나면 intermap://auth?... 딥링크로 돌아온다
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const listener = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      try {
        applyAuthParams(new URL(url).searchParams)
      } catch {
        // 딥링크 형식이 아니면 무시
      }
    })
    return () => {
      void listener.then((sub) => sub.remove())
    }
  }, [applyAuthParams])

  // 입력은 즉시 반영하고 지도 마커 재생성처럼 무거운 작업만 뒤로 미룬다.
  const deferredQuery = useDeferredValue(query)
  // 검색 결과 목록 표시 여부. 입력 중엔 열리고, Enter나 결과 선택으로 닫힌다 — 키워드와 지도 필터는 남는다.
  const [resultsOpen, setResultsOpen] = useState(true)
  const searchActive = deferredQuery.trim().length >= MIN_QUERY_LENGTH

  // 키보드가 올라오면 화면 아래 가려진 높이를 --kb로 알린다. 모달·시트가 그만큼 위로 올라온다.
  // 기종마다 창을 줄이기도(adjustResize) 밀어 올리기도(adjustPan) 해서, 어느 쪽이든 맞도록
  // 레이아웃 뷰포트와 실제 보이는 뷰포트의 차이를 직접 잰다. 입력칸은 초점이 오면 가운데로 끌어온다.
  useEffect(() => {
    const vv = window.visualViewport
    const applyKeyboard = () => {
      const overlap = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0
      document.documentElement.style.setProperty('--kb', `${Math.round(overlap)}px`)
    }
    // 키보드가 다 올라오고 레이아웃이 정리된 뒤에 스크롤해야 원하는 자리에 선다
    const scrollToInput = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null
      if (!el?.matches?.('input, textarea')) return
      window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
    }
    applyKeyboard()
    vv?.addEventListener('resize', applyKeyboard)
    vv?.addEventListener('scroll', applyKeyboard)
    document.addEventListener('focusin', scrollToInput)
    return () => {
      vv?.removeEventListener('resize', applyKeyboard)
      vv?.removeEventListener('scroll', applyKeyboard)
      document.removeEventListener('focusin', scrollToInput)
    }
  }, [])

  // 안드로이드 하드웨어 뒤로가기: 열려 있는 레이어를 위에서부터 하나씩 닫고, 닫을 게 없으면 앱을 종료한다.
  // 리스너는 한 번만 등록하고 최신 상태는 ref로 읽는다 — 상태마다 재등록하면 네이티브 리스너가 붙었다 떨어졌다 한다.
  const handleBackRef = useRef<() => boolean>(() => false)
  handleBackRef.current = () => {
    if (profileUserId !== null) return setProfileUserId(null), true
    if (openStory) return setOpenStory(null), true
    if (authMode) return setAuthMode(null), setSocialLink(null), true
    if (myPageOpen) return setMyPageOpen(false), true
    if (selectedId) return setSelectedId(null), true
    if (personId !== null) return setPersonId(null), true
    if (searching || query.trim()) return setQuery(''), setResultsOpen(true), setSearching(false), true
    if (favMode) return setFavMode(false), true
    return false
  }
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const listener = CapacitorApp.addListener('backButton', () => {
      if (!handleBackRef.current()) void CapacitorApp.exitApp()
    })
    return () => {
      void listener.then((sub) => sub.remove())
    }
  }, [])

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

  // 누적된 서버 요약 셀을 배열로. 서버 건수엔 후기 있는 가게도 들어 있다 —
  // '후기 없음'이면 내가 보는 후기(팔로우 기준)가 있는 가게를 같은 격자 칸에서 빼고, 0이 된 칸은 숨긴다.
  const cellList = useMemo(() => {
    if (!cellStore) return []
    if (reviewFilter !== 'without') return [...cellStore.byKey.values()]
    const reviewedPerCell = new Map<string, number>()
    for (const r of reviewedRestaurants) {
      if (r.reviews.length === 0) continue
      const key = cellKey(r.lat, r.lng, cellStore.cellDeg)
      reviewedPerCell.set(key, (reviewedPerCell.get(key) ?? 0) + 1)
    }
    return [...cellStore.byKey].flatMap(([key, cell]) => {
      const count = cell.count - (reviewedPerCell.get(key) ?? 0)
      return count > 0 ? [{ ...cell, count }] : []
    })
  }, [cellStore, reviewFilter, reviewedRestaurants])

  // 찜 모드: 후기·검색 필터와 무관하게 찜한 가게 전부
  const favRestaurants = useMemo(
    () => reviewedRestaurants.filter((r) => favorites.has(restaurantKey(r))),
    [reviewedRestaurants, favorites],
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

  // 사람 검색: 팔로우한 사람의 후기에서만 찾으면 아직 팔로우 안 한 사람은 영영 안 걸린다.
  // 서버 사용자 검색으로 인터맵 사용자 전체에서 찾아 목록에 같이 보여준다 (거기서 바로 팔로우).
  const [foundUsers, setFoundUsers] = useState<UserItem[]>([])
  useEffect(() => {
    if (!session || searchMode !== 'person' || !searchActive) {
      setFoundUsers([])
      return
    }
    let cancelled = false
    searchUsers(deferredQuery.trim())
      .then((list) => {
        if (!cancelled) setFoundUsers(list)
      })
      .catch(() => {
        // 못 받으면 팔로우한 사람 후기 안에서만 검색
      })
    return () => {
      cancelled = true
    }
  }, [session, searchMode, searchActive, deferredQuery])

  // 후기·댓글·검색 결과에서 누른 사람의 프로필 개요. 내 프로필이면 마이페이지로 보낸다.
  const [profileUserId, setProfileUserId] = useState<number | null>(null)
  const openProfile = useCallback(
    (userId: number) => {
      if (!session) {
        setAuthMode('start')
        return
      }
      // 남의 팔로잉·팔로워 목록에서 나를 누르면 그 프로필은 닫고 마이페이지로
      if (userId === session.id) {
        setProfileUserId(null)
        setMyPageOpen(true)
      } else setProfileUserId(userId)
    },
    [session],
  )

  // 팔로우 — 서버가 돌려준 새 소셜 목록으로 맞춘다 (그 사람 후기·스토리가 바로 보이기 시작한다)
  const follow = useCallback(async (userId: number) => {
    try {
      setSocial(await followUser(userId))
    } catch (e) {
      alert((e as Error).message)
    }
  }, [])

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

  // TOP 5 카드로 이미 보여준 사람은 사용자 목록에서 뺀다 (같은 사람이 두 번 나오지 않게)
  const otherUsers = useMemo(() => {
    const shown = new Set(personPicks.map((p) => p.author.id))
    return foundUsers.filter((u) => !shown.has(u.id))
  }, [foundUsers, personPicks])

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
  async function addReview(restaurantId: string, rating: number, text: string, menu: string, photos: File[]) {
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
      const saved = await postReview({ name: target.name, category: target.category, address: target.address }, rating, text, menu, shrunk)
      setRawReviews((prev) => [saved, ...prev])
    } catch (e) {
      alert((e as Error).message)
      throw e
    }
  }

  // 내 후기 수정. 서버가 본인 확인을 하고 바뀐 후기를 돌려준다.
  async function editReview(reviewId: number, rating: number, text: string, menu: string, keepPhotoIds: number[], photos: File[]) {
    try {
      const shrunk = await Promise.all(photos.map((f) => shrinkImage(f)))
      const saved = await updateReview(reviewId, rating, text, menu, keepPhotoIds, shrunk)
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

  // 후기별 댓글 등록 — 서버에 저장하고 돌아온 걸 상태에 붙인다
  async function addComment(reviewId: number, text: string, parentId?: number) {
    if (!session) {
      setAuthMode('start')
      return
    }
    try {
      const saved = await postComment(reviewId, text, parentId)
      setReviewComments((prev) => ({
        ...prev,
        [reviewId]: [
          ...(prev[reviewId] ?? []),
          { id: saved.id, authorId: saved.author.id, authorName: saved.author.name, text: saved.text, parentId: saved.parentId },
        ],
      }))
    } catch (e) {
      alert((e as Error).message)
    }
  }

  // 가게 찜 토글 — 서버 결과 상태로 맞춘다
  async function toggleFav(place: { name: string; address: string }) {
    if (!session) {
      setAuthMode('start')
      return
    }
    try {
      const { favored } = await toggleFavorite(place.name, place.address)
      const key = restaurantKey(place)
      setFavorites((prev) => {
        const next = new Set(prev)
        if (favored) next.add(key)
        else next.delete(key)
        return next
      })
    } catch (e) {
      alert((e as Error).message)
    }
  }

  // 내 댓글 삭제 — 원댓글이면 서버가 답글까지 지우므로 상태에서도 같이 걷어낸다
  async function removeComment(reviewId: number, commentId: number) {
    try {
      await deleteComment(commentId)
      setReviewComments((prev) => ({
        ...prev,
        [reviewId]: (prev[reviewId] ?? []).filter((c) => c.id !== commentId && c.parentId !== commentId),
      }))
    } catch (e) {
      alert((e as Error).message)
    }
  }

  // 프로필을 열 때 서버 응답을 기다리는 동안 쓸 이름 — 이미 화면에 있던 이름 그대로
  const profileName =
    profileUserId === null
      ? ''
      : (foundUsers.find((u) => u.id === profileUserId)?.nickname ??
        rawReviews.find((rv) => rv.author.id === profileUserId)?.author.name ??
        '사용자')

  return (
    <OpenProfileContext.Provider value={openProfile}>
    <div
      className={`app${searching ? ' app--searching' : ''}`}
      style={Object.fromEntries(Object.entries(groupColors).map(([id, c]) => [`--gc-${id}`, c])) as React.CSSProperties}
    >
      <MapCanvas
        restaurants={favMode ? favRestaurants : visibleRestaurants}
        groups={groups}
        // 요약 셀 = 후기 없는 가게 덩어리. 필터·검색으로 그런 가게가
        // 안 보이는 상태면 셀도 같이 숨긴다 (개별 핀과 기준을 맞춘다). 찜 모드에선 항상 숨김.
        cells={!favMode && reviewFilter !== 'with' && !personPins && deferredQuery.trim().length < MIN_QUERY_LENGTH ? cellList : []}
        pinsWhenFar={favMode || reviewFilter === 'with' || searchActive || personPins}
        starPins={favMode}
        onPick={pickRestaurant}
        focus={focusTarget ?? undefined}
        onViewportChange={loadViewport}
        onMyLocation={handleMyLocation}
      />

      <div className="app__chrome">
        <Header
          nickname={session?.nickname ?? null}
          onLogin={() => setAuthMode('start')}
          onLogout={handleLogout}
          onMyPage={() => setMyPageOpen(true)}
          following={followingPeople}
          selectedPersonId={selectedPerson?.id ?? null}
          onSelectPerson={setPersonId}
          favMode={favMode}
          onToggleFavMode={() => {
            if (!session) {
              setAuthMode('start')
              return
            }
            setFavMode((prev) => !prev)
          }}
        />
        {!searching && <StoryStrip stories={stories} onOpen={setOpenStory} />}
        {/* 스토리는 항상 헤더 바로 아래 — 칩은 그 밑에 */}
        {selectedPerson && (
          <PersonChip
            name={selectedPerson.name}
            picks={selectedPersonPicks}
            onPick={focusFromSearch}
            onClose={() => setPersonId(null)}
          />
        )}
        <SearchDock
          searching={searching}
          onOpenSearch={() => {
            // 검색을 열면 친구 선택(TOP 5 칩)은 접는다
            setPersonId(null)
            setResultsOpen(true)
            setSearching(true)
          }}
          onCloseSearch={() => {
            setQuery('')
            setResultsOpen(true)
            setSearching(false)
          }}
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
          reviewFilter={reviewFilter}
          onReviewFilterChange={setReviewFilter}
          showReviewFilter={!!session && !personPins}
          results={
            query.trim() && resultsOpen ? (
              <SearchResults
                results={searchResults}
                topPicks={personPicks}
                people={otherUsers}
                onFollow={follow}
                groups={groups}
                // 지연값 기준 — 동기값으로 풀면 키워드 없는 전체 목록(수천 행)이 먼저 동기 렌더돼 입력이 멈춘다
                tooShort={!searchActive}
                minLength={MIN_QUERY_LENGTH}
                highlight={deferredQuery.trim()}
                onPick={focusFromSearch}
              />
            ) : undefined
          }
        />
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
        onDeleteComment={removeComment}
        favored={selectedRestaurant ? favorites.has(restaurantKey(selectedRestaurant)) : false}
        onToggleFavorite={toggleFav}
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

      <StoryViewer
        stories={stories}
        story={openStory}
        allReviews={reviews}
        onFocusRestaurant={focusFromStory}
        comments={reviewComments}
        myUserId={session?.id}
        onAddComment={addComment}
        onDeleteComment={removeComment}
        favorites={favorites}
        onToggleFavorite={toggleFav}
        onClose={() => setOpenStory(null)}
      />

      {session && profileUserId !== null && (
        <ProfileSheet
          userId={profileUserId}
          fallbackName={profileName}
          allReviews={rawReviews}
          restaurants={reviewedRestaurants}
          myUserId={session.id}
          onSocialChange={setSocial}
          // 프로필은 가게 시트의 후기에서 열리기도 한다 — 지도만 옮기면 뒤에 있던 시트가 예전 가게로 남으므로 시트도 바꾼다
          onPick={(restaurant) => {
            setProfileUserId(null)
            setSelectedId(restaurant.id)
            focusFromSearch(restaurant)
          }}
          onClose={() => setProfileUserId(null)}
        />
      )}

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
    </OpenProfileContext.Provider>
  )
}
