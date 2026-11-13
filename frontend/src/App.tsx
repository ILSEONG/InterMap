import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { clearQueryCache, refresh, setQueryOwner, useServerState } from './lib/query'
import { useDebounced } from './lib/useDebounced'
import { closeTopLayer } from './lib/backLayer'
import { readBoardSeen } from './lib/boardSeen'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import TopBar from './components/TopBar'
import SearchResults, { type NeighborHit } from './components/SearchResults'
import FollowingBoard from './components/FollowingBoard'
import NoticeSheet from './components/NoticeSheet'
import PersonPanel from './components/PersonPanel'
import type { PersonPlace } from './components/PersonPanel'
import StoryStrip from './components/StoryStrip'
import StoryViewer from './components/StoryViewer'
import MapCanvas from './components/MapCanvas'
import AuthModal from './components/AuthModal'
import type { AuthMode } from './components/AuthModal'
import RestaurantSheet from './components/RestaurantSheet'
import { restaurantSheetTop } from './lib/sheetGeometry'
import MyPage from './components/MyPage'
import ProfileSheet from './components/ProfileSheet'
import ReportSheet from './components/ReportSheet'
import PolicyViewer from './components/PolicyViewer'
import type { PolicyPage } from './components/PolicyViewer'
import AdminReports from './components/AdminReports'
import AdminOps from './components/AdminOps'
import PollComposer from './components/PollComposer'
import PollSheet from './components/PollSheet'
import PollCartBar from './components/PollCartBar'
import RecapSheet from './components/RecapSheet'
import { backProfile, pushProfile, setTopList, type ProfileList, type ProfileStep } from './lib/profileStack'
import { OpenProfileContext } from './lib/openProfile'
import { ModerationContext } from './lib/moderation'
import type { Moderation, ReportTarget } from './lib/moderation'
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
  acceptFollowRequest,
  rejectFollowRequest,
  fetchNotices,
  markNoticesSeen,
  postReview,
  updateReview,
  deleteReview,
  isAdmin,
  isOperator,
  restaurantKey,
  logout,
  deleteAccount,
  exchangeOAuth,
  oauthErrorMessage,
  closeOAuthBrowser,
  SUMMARY_MAX_ZOOM,
  POLL_MAX_OPTIONS,
} from './lib/api'
import { tasteTag } from './lib/taste'
import { startPush, stopPush } from './lib/push'
import { shrinkImage } from './lib/image'
import type { AuthSession, BBox, ClusterCell, NoticeData, PollCandidate, PollView, RestaurantRecord, SocialData, SocialTicket, UserItem } from './lib/api'
import { kstMonth, monthLabel, prevMonth } from './lib/time'
import { pollTokenFromUrl, tryOpenPollInApp } from './lib/deepLink'
import './App.css'

// 한 글자로는 결과가 너무 많이 걸려 두 글자부터 검색한다.
const MIN_QUERY_LENGTH = 2

// 아직 못 받았을 때 쓰는 빈 값 — 매 렌더 새 객체를 만들지 않게 하나로
const NO_REVIEWS: Review[] = []
const NO_COMMENTS: Record<number, Comment[]> = {}

// 댓글은 받아서 후기별로 나눠 둔다
async function fetchGroupedComments(): Promise<Record<number, Comment[]>> {
  const grouped: Record<number, Comment[]> = {}
  for (const c of await fetchComments()) {
    ;(grouped[c.reviewId] ??= []).push({ id: c.id, authorId: c.author.id, authorName: c.author.name, text: c.text, parentId: c.parentId })
  }
  return grouped
}

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
    // id는 이름+주소 키로 — 후기로 먼저 그린 가게(아래 reviewedRestaurants)가 뷰포트로 다시 들어와도
    // 같은 id라서 열어 둔 시트·강조 핀이 풀리지 않는다 (mergeRecords가 같은 키를 걸러 유일하다)
    id: `p-${record.name}|${record.roadAddress || record.address}`,
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
  const seen = new Map<string, number>()
  prev.forEach((r, i) => seen.set(`${r.name}|${r.address}`, i))
  const merged = [...prev]
  let changed = false
  for (const record of records) {
    const at = seen.get(`${record.name}|${record.roadAddress}`) ?? seen.get(`${record.name}|${record.address}`)
    if (at !== undefined) {
      // 이미 그린 가게라도 서버 좌표가 바뀌었으면(지오코딩 보정) 새 자리로 옮긴다
      const old = merged[at]
      if (old.lat !== record.lat || old.lng !== record.lng) {
        merged[at] = { ...old, lat: record.lat, lng: record.lng }
        changed = true
      }
      continue
    }
    const added = toRestaurant(record)
    merged.push(added)
    seen.set(`${added.name}|${added.address}`, merged.length - 1)
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
  // 가장 최근에 요청한 줌 — 줌을 빨리 바꾸면 이전 줌 응답이 늦게 와서 격자를 덮어쓰지 않게
  const lastFetchZoom = useRef(0)

  // 전체를 한 번에 받는 대신, 지도가 멈출 때마다 보이는 영역만 받아 누적한다.
  // 한 번 본 영역의 가게는 목록에 남으므로 검색·필터는 본 영역 기준으로 동작한다.
  // 줌이 낮으면(넓은 영역) 개별 가게 대신 서버 격자 요약만 받는다.
  const fetchViewport = useCallback((bbox: BBox, zoom: number) => {
    const snapped = snapBBox(bbox)
    const cellMode = zoom <= SUMMARY_MAX_ZOOM
    const key = `${cellMode ? `s${zoom}` : 'r'}:${snapped.minLat},${snapped.minLng},${snapped.maxLat},${snapped.maxLng}`
    if (key === lastFetchKey.current) return
    lastFetchKey.current = key
    lastFetchZoom.current = zoom
    // 실패하면 같은 타일을 다시 받을 수 있게 키를 푼다 (콜드 스타트·잠깐 끊김 뒤 빈 지도 방지)
    const forget = () => {
      if (lastFetchKey.current === key) lastFetchKey.current = ''
    }
    if (cellMode) {
      // zoom-2로 요청하면 서버 셀 한 변이 4배(104px)가 된다 — 셀 핀(38px 원, 네 자리면 더 넓다)이
      // 서로 겹치지 않고, 밀집 지역에서 마커 수백 개가 깔려 모바일 WebView가 깜빡이는 것도 막는다
      const cellZoom = zoom - 2
      fetchRestaurantCells(snapped, cellZoom)
        .then((fresh) => {
          // 서버와 같은 격자 인덱스로 키를 만들어 누적한다. 같은 셀은 최신 응답으로
          // 덮어써서 bbox 경계에 걸려 잘렸던 건수를 교정한다. 줌이 바뀌면 격자가
          // 달라지므로 처음부터 다시 쌓는다.
          if (lastFetchZoom.current !== zoom) return
          const cellDeg = (360 * 26) / (256 * 2 ** cellZoom)
          setCellStore((prev) => {
            const byKey = prev && prev.zoom === zoom ? new Map(prev.byKey) : new Map<string, ClusterCell>()
            for (const c of fresh) byKey.set(cellKey(c.lat, c.lng, cellDeg), c)
            return { zoom, cellDeg, byKey }
          })
        })
        .catch(forget)
    } else {
      fetchRestaurants(snapped)
        .then((records) => setRestaurants((prev) => mergeRecords(prev, records)))
        // 백엔드 미기동 시 빈 지도 — 다음 멈춤에서 다시 받는다
        .catch(forget)
    }
  }, [])
  // 지금 필터로 보일 수 있을 때만 받는다 — 기본 "후기 있는 곳만"이면 후기 없는 가게·요약 셀은 화면에 안 나오는데
  // 멈출 때마다 받으면 그만큼 데이터·재계산만 늘어난다. 필터를 바꾸면 마지막으로 멈춘 자리부터 받는다
  const lastViewport = useRef<{ bbox: BBox; zoom: number } | null>(null)
  const viewportNeeded = useRef(true)
  const loadViewport = useCallback(
    (bbox: BBox, zoom: number) => {
      lastViewport.current = { bbox, zoom }
      if (viewportNeeded.current) fetchViewport(bbox, zoom)
    },
    [fetchViewport],
  )
  // 그룹별 마커 색. --gc-* CSS 변수로 앱 루트에 내려가고 모든 컴포넌트가 var()로 참조한다.
  // 저채도 연한 파랑 기본값 — 밝은 지도 배경과 명도 대비를 낮춰 핀 밀집 시 "구멍 무리" 착시(환공포증 유발)를 줄인다.
  const [groupColors] = useState<Record<GroupId, string>>({
    // 포인트 색을 바꾸면 지도 별점 핀도 그 색으로 (lib/theme.ts의 --accent-pin, 없으면 기본 로즈)
    close: 'var(--accent-pin, #FF5D73)',
    work: '#2F7BF6',
    college: '#1FA38C',
    // 후기 없는 가게(대부분)는 이 색 — 밀집해도 눈에 덜 띄는 중간 회색
    none: '#A7A7AE',
  })
  // 후기 유무 필터: 전체 / 후기 있는 곳만 / 없는 곳만. 실제 적용값은 아래 reviewFilter (로그아웃이면 '전체')
  const [reviewFilterChoice, setReviewFilter] = useState<'all' | 'with'>('with')
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
  const [focusTarget, setFocusTarget] = useState<{ id: string; lat: number; lng: number; sheet?: boolean } | null>(null)
  // 로그인 세션. 앱을 껐다 켜도 유지되도록 localStorage에 둔다.
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  const [session, setSession] = useState<AuthSession | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('intermap.session') ?? 'null')
    } catch {
      return null
    }
  })
  // 서버 데이터(lib/query)는 로그인한 사람별로 나눈다 — 아래 데이터 훅들이 첫 렌더에서 키를 만들기 전에 정한다
  setQueryOwner(session ? `u${session.id ?? 'me'}` : 'guest')
  // 로그아웃이면 주인장 후기만 받아 이웃 후기 필터가 무의미하다 — 필터를 숨기고 전부 보여준다
  const reviewFilter = session ? reviewFilterChoice : 'all'
  // 데이터 다시 받기의 기준 — 세션 객체가 아니라 토큰. 시작할 때 /api/auth/me로 세션 객체를 새로 갈아 끼우거나
  // 닉네임·사진을 바꿔도 같은 사람이면 후기·댓글·찜·팔로우를 처음부터 다시 받지 않는다
  const sessionToken = session?.token ?? null
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
  // 로컬 세션만 지운다 (로그아웃·탈퇴 공통)
  const clearSession = useCallback(() => {
    clearQueryCache()
    setSession(null)
    try {
      localStorage.removeItem('intermap.session')
    } catch {
      // 무시
    }
  }, [])
  const handleLogout = useCallback(() => {
    // 서버 토큰부터 지운다 — authHeaders()가 localStorage를 읽으므로 삭제 전에 호출해야 한다
    // 푸시 기기 토큰도 뗀다 — 로그아웃한 폰으로 알림이 가지 않게
    stopPush()
    void logout()
    clearSession()
  }, [clearSession])

  // 신고·차단·약관 시트, 운영자 신고 관리
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null)
  const [policyPage, setPolicyPage] = useState<PolicyPage | null>(null)
  const [adminReportsOpen, setAdminReportsOpen] = useState(false)
  const [adminOpsOpen, setAdminOpsOpen] = useState(false)

  // "어디 갈래?" 투표 — 가게 시트에서 담아 둔 후보 (앱을 껐다 켜도 남게 저장), 만들기 시트, 열어 본 투표.
  // 친구가 보낸 링크(?poll=)로 들어오면 그 투표를 바로 연다
  const [pollCart, setPollCart] = useState<PollCandidate[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('intermap.pollCart') ?? '[]')
      return Array.isArray(saved) ? saved.slice(0, POLL_MAX_OPTIONS) : []
    } catch {
      return []
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('intermap.pollCart', JSON.stringify(pollCart))
    } catch {
      // 저장 못 해도 이번 실행 동안은 남는다
    }
  }, [pollCart])
  const [composerOpen, setComposerOpen] = useState(false)
  const [openPoll, setOpenPoll] = useState<string | null>(() => new URLSearchParams(window.location.search).get('poll'))
  // 투표를 만들거나 지우면 올려서 마이페이지 목록을 다시 받는다
  const [pollVersion, setPollVersion] = useState(0)
  // 링크로 들어왔으면: 안드로이드 웹이면 먼저 앱을 불러 보고(lib/deepLink), 주소창에서 ?poll=을 지운다
  // (새로고침해도 다시 뜨지 않게)
  useEffect(() => {
    const url = new URL(window.location.href)
    const token = url.searchParams.get('poll')
    if (!token) return
    tryOpenPollInApp(token)
    url.searchParams.delete('poll')
    url.searchParams.delete('web')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  // 월간 결산 — 열려 있으면 보고 있는 달. 지난달 결산 동그라미는 한 번 열면 다시 안 띄운다
  const [recapMonth, setRecapMonth] = useState<string | null>(null)
  const [recapSeen, setRecapSeen] = useState<string | null>(() => {
    try {
      return localStorage.getItem('intermap.recapSeen')
    } catch {
      return null
    }
  })
  // 차단·운영자 삭제처럼 서버 쪽 목록이 바뀌었을 때 — 후기·댓글·팔로우를 다시 받는다 (받은 게 있으면 그대로 두고 뒤에서)
  const refreshContent = useCallback(() => refresh('reviews', 'comments', 'social', 'notices'), [])

  // 서버가 내게 보여주는 후기 (최신순). 이웃 후기·주인장 후기·스토리가 전부 여기서 나온다.
  // 서버가 거른다 — 로그아웃이면 주인장 후기만, 로그인하면 나·팔로우한 사람·주인장 후기.
  // 지난번에 받아 둔 후기(기기 저장)로 바로 시작한다 — 앱을 켜자마자 핀·스토리가 뜨고, 새 목록은 뒤에서 받아 바꾼다
  const [reviewData, setRawReviews] = useServerState<Review[]>(['reviews'], fetchReviews, { empty: [] })
  const rawReviews = reviewData ?? NO_REVIEWS
  // 후기 id → 그 후기의 댓글들 (서버 /api/comments를 후기별로 나눠 둔 것)
  const [commentData, setReviewComments] = useServerState<Record<number, Comment[]>>(['comments'], fetchGroupedComments, { empty: {} })
  const reviewComments = commentData ?? NO_COMMENTS
  // 내가 찜한 가게 키("이름|주소") 모음 — 저장은 배열로, 화면에선 Set으로
  const [favoriteKeys, setFavoriteKeys] = useServerState<string[]>(
    ['favorites'],
    () => fetchFavorites().then((places) => places.map(restaurantKey)),
    { enabled: sessionToken !== null, empty: [] },
  )
  const favorites = useMemo(() => new Set(sessionToken ? (favoriteKeys ?? []) : []), [favoriteKeys, sessionToken])
  const setFavorites = useCallback(
    (update: (prev: Set<string>) => Set<string>) => setFavoriteKeys((prev) => [...update(new Set(prev))]),
    [setFavoriteKeys],
  )
  // 헤더 별 버튼: 켜면 지도에 찜한 가게만 (후기 필터 무시, 초록 별 마커)
  const [favMode, setFavMode] = useState(false)
  // 하단 독이 검색 모드인지 (검색 버튼 → 입력창)
  const [searching, setSearching] = useState(false)
  // 마이페이지: 팔로잉·팔로워·별칭. 로그인하면 받아 둔다 — 후기 작성자 이름에 별칭을 씌우는 데 쓴다.
  const [socialData, setSocial] = useServerState<SocialData>(['social'], fetchSocial, { enabled: sessionToken !== null })
  const social = sessionToken ? (socialData ?? null) : null
  const [myPageOpen, setMyPageOpen] = useState(false)
  useEffect(() => {
    if (sessionToken) return
    // 로그아웃하면 찜 지도·마이페이지를 닫는다
    setFavMode(false)
    setMyPageOpen(false)
  }, [sessionToken])
  // 헤더 팔로잉 버튼으로 여는 팔로잉 현황판
  const [boardOpen, setBoardOpen] = useState(false)
  // 알림 — 지도 오른쪽 아래 종 버튼. 댓글·답글·팔로우 요청·새 팔로워 (서버가 기록에서 그때그때 모아 준다)
  const [noticeData, setNotices] = useServerState<NoticeData>(['notices'], fetchNotices, { enabled: sessionToken !== null })
  const notices = sessionToken ? (noticeData ?? null) : null
  const [noticesOpen, setNoticesOpen] = useState(false)
  const [noticeBusy, setNoticeBusy] = useState(false)
  // 앱을 켜 둔 동안 1분마다 새 알림·팔로우 요청을 확인한다 (화면이 꺼져 있으면 건너뛴다)
  useEffect(() => {
    if (sessionToken === null) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh('notices', 'social')
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [sessionToken])
  useEffect(() => {
    if (sessionToken === null) setNoticesOpen(false)
  }, [sessionToken])
  // 헤더 친구 목록에서 고른 사람. 그 사람이 후기 쓴 가게만 지도·목록에 남긴다.
  const [personId, setPersonId] = useState<number | null>(null)
  const followingPeople = useMemo(
    () => social?.following.map((p) => ({ id: p.id, name: p.alias ?? p.nickname })) ?? null,
    [social],
  )
  // 팔로잉 현황 칩의 빨간 점 — 현황판을 마지막으로 연 뒤 팔로우한 사람이 새 후기를 올렸다.
  // 현황판을 열면 본 것으로 기록되니 열고 닫을 때(boardOpen) 다시 센다
  const boardHasNew = useMemo(() => {
    if (!social || boardOpen) return false
    const ids = new Set(social.following.map((p) => p.id))
    const seenAt = readBoardSeen()
    return rawReviews.some((rv) => ids.has(rv.author.id) && Date.parse(rv.createdAt) > seenAt)
  }, [social, rawReviews, boardOpen])
  // 언팔로우·로그아웃으로 목록에서 빠지면 선택도 자동 해제
  const selectedPerson = followingPeople?.find((p) => p.id === personId) ?? null
  // 사람을 고르면 그 사람 후기 가게만 핀으로. 칩 ✕로 해제.
  const personPins = selectedPerson !== null
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
        // 뷰포트로 같은 가게가 들어와도 같은 id (toRestaurant와 같은 식)
        id: `p-${key}`,
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
  const storyIds = useMemo(() => new Set(stories.map((s) => s.id)), [stories])


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

  // 소셜 로그인 완료 후 결과는 일회용 코드 ?oauth= 로만 오고, 이 기기가 로그인 시작 때 저장한 verifier로 서버에서 받아 온다
  // (연결된 회원이면 세션, 같은 이메일 계정이 있으면 연결 티켓, 처음이면 가입 티켓).
  // 실패 시 ?authError=<코드>. 웹은 리다이렉트 쿼리로, 앱은 intermap:// 딥링크로 들어온다.
  const applyAuthParams = useCallback(
    (params: URLSearchParams) => {
      const code = params.get('oauth')
      const authError = params.get('authError')
      if (!code && !authError) return false
      if (code) {
        exchangeOAuth(code)
          .then((result) => {
            if (result.type === 'session' && result.session) {
              handleAuthed(result.session)
            } else if (result.ticket && result.provider) {
              setSocialLink({
                ticket: result.ticket,
                provider: result.provider,
                email: result.email ?? undefined,
                nickname: result.nickname ?? undefined,
              })
              setAuthMode(result.type === 'link' ? 'link' : 'social')
            }
          })
          .catch((err: Error) => alert(err.message))
      }
      if (authError) alert(oauthErrorMessage(authError))
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
      // 투표 링크로 들어왔으면 그 투표를 연다 (intermap://poll?t=…)
      const poll = pollTokenFromUrl(url)
      if (poll) {
        setOpenPoll(poll)
        return
      }
      try {
        // 아이폰: 로그인에 쓴 앱 안 브라우저 창을 닫는다 (안드로이드는 바깥 브라우저라 닫을 게 없다)
        if (applyAuthParams(new URL(url).searchParams)) closeOAuthBrowser()
      } catch {
        // 딥링크 형식이 아니면 무시
      }
    })
    // 앱이 꺼져 있다가 투표 링크로 켜진 경우
    void CapacitorApp.getLaunchUrl().then((launch) => {
      const poll = launch?.url ? pollTokenFromUrl(launch.url) : null
      if (poll) setOpenPoll(poll)
    })
    return () => {
      void listener.then((sub) => sub.remove())
    }
  }, [applyAuthParams])

  // 입력은 즉시 반영하고 지도 마커 재생성처럼 무거운 작업만 뒤로 미룬다.
  const deferredQuery = useDeferredValue(query)
  // 서버 검색은 입력이 멈췄을 때만 (useDeferredValue는 렌더만 미루고 요청 수는 줄이지 않는다)
  const serverQuery = useDebounced(deferredQuery)
  // 검색 결과 목록 표시 여부. 입력 중엔 열리고, Enter나 결과 선택으로 닫힌다 — 키워드와 지도 필터는 남는다.
  const [resultsOpen, setResultsOpen] = useState(true)
  const searchActive = deferredQuery.trim().length >= MIN_QUERY_LENGTH

  // 키보드가 올라오면 화면 아래 가려진 높이를 --kb로 알린다. 모달·시트가 그만큼 위로 올라온다.
  // 기종마다 창을 줄이기도(adjustResize) 밀어 올리기도(adjustPan) 해서, 어느 쪽이든 맞도록
  // 레이아웃 뷰포트와 실제 보이는 뷰포트의 차이를 직접 잰다. 입력칸은 초점이 오면 가운데로 끌어온다.
  useEffect(() => {
    const vv = window.visualViewport
    // 입력칸에 초점이 있고 키보드만큼 가려졌을 때만 센다. 그 밖의 뷰포트 변화(모바일 브라우저 주소창·툴바가
    // 숨었다 나타남, 끌어내릴 때 고무줄 스크롤)까지 따라가면 시트가 손가락 아래에서 위아래로 흔들린다
    const KEYBOARD_MIN = 120
    let last = -1
    const applyKeyboard = () => {
      const typing = !!document.activeElement?.matches?.('input, textarea, [contenteditable="true"]')
      const raw = vv && typing ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0
      const overlap = raw >= KEYBOARD_MIN ? Math.round(raw) : 0
      if (overlap === last) return
      last = overlap
      document.documentElement.style.setProperty('--kb', `${overlap}px`)
    }
    const onFocusOut = () => window.setTimeout(applyKeyboard, 50)
    // 키보드가 다 올라오고 레이아웃이 정리된 뒤에 스크롤해야 원하는 자리에 선다
    const scrollToInput = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null
      if (!el?.matches?.('input, textarea')) return
      // 위에 붙은 검색칸은 키보드에 가리지 않는다 — 끌어오면 화면이 쓸데없이 밀린다.
      // 키보드가 뜨며 웹뷰가 문서를 밀어 올렸으면(adjustPan) 제자리로
      if (el.closest('.topbar')) {
        window.setTimeout(() => {
          if (window.scrollY !== 0) window.scrollTo(0, 0)
        }, 0)
        return
      }
      window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
    }
    applyKeyboard()
    vv?.addEventListener('resize', applyKeyboard)
    vv?.addEventListener('scroll', applyKeyboard)
    document.addEventListener('focusin', scrollToInput)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      vv?.removeEventListener('resize', applyKeyboard)
      vv?.removeEventListener('scroll', applyKeyboard)
      document.removeEventListener('focusin', scrollToInput)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  // 안드로이드 하드웨어 뒤로가기: 열려 있는 레이어를 위에서부터 하나씩 닫고, 닫을 게 없으면 앱을 종료한다.
  // 리스너는 한 번만 등록하고 최신 상태는 ref로 읽는다 — 상태마다 재등록하면 네이티브 리스너가 붙었다 떨어졌다 한다.
  const handleBackRef = useRef<() => boolean>(() => false)
  handleBackRef.current = () => {
    // 사진 크게 보기·펼친 메뉴처럼 컴포넌트 안의 작은 레이어가 먼저 (lib/backLayer)
    if (closeTopLayer()) return true
    if (policyPage) return setPolicyPage(null), true
    if (reportTarget) return setReportTarget(null), true
    if (recapMonth) return setRecapMonth(null), true
    if (openPoll) return setOpenPoll(null), true
    if (composerOpen) return setComposerOpen(false), true
    if (adminReportsOpen) return setAdminReportsOpen(false), true
    if (adminOpsOpen) return setAdminOpsOpen(false), true
    if (profileUserId !== null) return profileBack(), true
    // 스토리는 팔로잉 현황 위에서도 열린다 — 위에 있는 스토리부터
    if (openStory) return setOpenStory(null), true
    if (boardOpen) return setBoardOpen(false), true
    if (noticesOpen) return setNoticesOpen(false), true
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

  // 아이폰엔 뒤로가기 버튼이 없다 — iOS 앱이나 홈 화면에 추가한 웹 앱(주소창·사파리 뒤로가기 없음)에선
  // 화면 왼쪽 끝에서 오른쪽으로 쓸면 위 레이어를 하나 닫는다 (iOS 기본 "뒤로" 손짓).
  // 판정은 넉넉하게: 왼쪽 44px 안에서 시작해 오른쪽으로 50px, 또는 짧아도(24px~) 빠르게 튕기면.
  useEffect(() => {
    // 아이폰·아이패드에서만. 안드로이드는 기기 뒤로가기(버튼·제스처)가 따로 있어서, 여기서도 쓸기를 받으면 두 번 닫힌다
    const iosDevice =
      /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (Capacitor.getPlatform() !== 'ios' && !(iosDevice && standalone)) return
    const EDGE = 44
    let start: { x: number; y: number; t: number } | null = null
    let last: { x: number; t: number } | null = null
    const fire = () => {
      start = null
      handleBackRef.current()
    }
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      start = e.touches.length === 1 && t && t.clientX < EDGE ? { x: t.clientX, y: t.clientY, t: performance.now() } : null
      last = start ? { x: start.x, t: start.t } : null
    }
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!start || !t) return
      const dx = t.clientX - start.x
      const dy = Math.abs(t.clientY - start.y)
      last = { x: t.clientX, t: performance.now() }
      // 세로로 더 많이 움직였으면 쓸기가 아니다 (목록 스크롤)
      if (dy > 40 && dy > dx) start = null
      else if (dx > 50) fire()
    }
    const onEnd = () => {
      // 짧게 튕긴 것도 인정 — 24px 이상, 0.25px/ms 이상
      if (start && last) {
        const dx = last.x - start.x
        const dt = last.t - start.t
        if (dx > 24 && dt > 0 && dx / dt > 0.25) fire()
      }
      start = null
      last = null
    }
    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    document.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [])


  // 가게 이름 검색은 서버에도 물어본다 — 아직 뷰포트로 안 받은 영역의 가게도 걸리게.
  // 받은 건 누적 목록에 합쳐두고 필터·핀은 기존 경로를 그대로 탄다.
  useEffect(() => {
    if (!searchActive || searchMode !== 'restaurant' || serverQuery.trim().length < MIN_QUERY_LENGTH) return
    let cancelled = false
    searchRestaurants(serverQuery.trim())
      .then((records) => {
        if (!cancelled) setRestaurants((prev) => mergeRecords(prev, records))
      })
      .catch(() => {
        // 실패하면 클라이언트에 있는 목록만으로 검색
      })
    return () => {
      cancelled = true
    }
  }, [searchActive, searchMode, serverQuery])
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
              reviewFilter === 'all' || r.reviews.length > 0
            : r.reviews.some((rev) => rev.author.id === pid)) &&
          (keyword === '' ||
            (searchMode === 'restaurant'
              ? `${r.name} ${r.category} ${r.address}`.toLowerCase().includes(keyword)
              : r.reviews.some((rev) => rev.author.name.toLowerCase().includes(keyword)))),
      )
    },
    [reviewedRestaurants, reviewFilter, searchMode, deferredQuery, selectedPerson, personPins],
  )

  // 누적된 서버 요약 셀을 배열로
  const cellList = useMemo(() => (cellStore ? [...cellStore.byKey.values()] : []), [cellStore])

  // 찜 모드: 후기·검색 필터와 무관하게 찜한 가게 전부
  // 후기 없는 가게가 보일 수 있는 상태: '전체' 필터, 찜 모드(후기 없는 찜 가게도 있다)
  const needViewport = reviewFilter !== 'with' || favMode
  useEffect(() => {
    viewportNeeded.current = needViewport
    if (needViewport && lastViewport.current) fetchViewport(lastViewport.current.bbox, lastViewport.current.zoom)
  }, [needViewport, fetchViewport])

  const favRestaurants = useMemo(
    () => reviewedRestaurants.filter((r) => favorites.has(restaurantKey(r))),
    [reviewedRestaurants, favorites],
  )

  // 고른 친구의 별점 TOP 5 (칩 아래 카드). 핀 필터와 무관하게 전체 목록에서 뽑는다.
  // 지도에서 한 사람을 골라 볼 때 아래 패널 — 그 사람이 다녀온 가게(가게마다 마지막 후기), 후기 수, 입맛 꼬리표
  const personView = useMemo(() => {
    if (!selectedPerson || !social) return null
    const entry = social.following.find((p) => p.id === selectedPerson.id)
    const places: PersonPlace[] = []
    for (const restaurant of reviewedRestaurants) {
      let last: Review | null = null
      for (const rv of restaurant.reviews) {
        if (rv.author.id === selectedPerson.id && (!last || Date.parse(rv.createdAt) > Date.parse(last.createdAt))) last = rv
      }
      if (last) places.push({ restaurant, rating: last.rating, at: last.createdAt })
    }
    const theirs = reviews.filter((rv) => rv.author.id === selectedPerson.id)
    return {
      person: { id: selectedPerson.id, name: selectedPerson.name, avatar: entry?.avatar ?? null, mutual: !!entry?.followsMe },
      places,
      reviewCount: theirs.length,
      tag: tasteTag(theirs),
    }
  }, [selectedPerson, social, reviewedRestaurants, reviews])

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
    if (!session || searchMode !== 'person' || !searchActive || serverQuery.trim().length < MIN_QUERY_LENGTH) {
      setFoundUsers([])
      return
    }
    let cancelled = false
    searchUsers(serverQuery.trim())
      .then((list) => {
        if (!cancelled) setFoundUsers(list)
      })
      .catch(() => {
        // 못 받으면 팔로우한 사람 후기 안에서만 검색
      })
    return () => {
      cancelled = true
    }
  }, [session, searchMode, searchActive, serverQuery])

  // 후기·댓글·검색 결과에서 누른 사람의 프로필 개요. 내 프로필이면 마이페이지로 보낸다.
  // 프로필의 팔로잉·팔로워 목록에서 또 다른 사람으로 들어갈 수 있어 화면을 쌓아 둔다 (lib/profileStack).
  const [profileStack, setProfileStack] = useState<ProfileStep[]>([])
  const profileTop = profileStack.at(-1) ?? null
  const profileUserId = profileTop?.userId ?? null
  const setProfileList = useCallback((list: ProfileList | null) => setProfileStack((s) => setTopList(s, list)), [])
  const profileBack = useCallback(() => setProfileStack(backProfile), [])
  const openProfile = useCallback(
    (userId: number) => {
      if (!session) {
        setAuthMode('start')
        return
      }
      // 남의 팔로잉·팔로워 목록에서 나를 누르면 쌓인 프로필은 닫고 마이페이지로
      if (userId === session.id) {
        setProfileStack([])
        setMyPageOpen(true)
      } else setProfileStack((s) => pushProfile(s, userId))
    },
    [session],
  )

  // 팔로우 — 서버가 돌려준 새 소셜 목록으로 맞춘다 (그 사람 후기·스토리가 바로 보이기 시작한다)
  // 서버는 팔로우한 사람 후기·댓글만 주므로, 새로 팔로우하면 후기·댓글을 다시 받아야 핀·스토리에 나타난다
  // 마이페이지·프로필 시트에서 팔로우한 경우도 같은 길로 (새로 팔로우한 사람이 있을 때만 다시 받는다)
  const applySocial = useCallback(
    (next: SocialData) => {
      const before = new Set(social?.following.map((p) => p.id) ?? [])
      setSocial(next)
      if (next.following.some((p) => !before.has(p.id))) refreshContent()
    },
    [social, setSocial, refreshContent],
  )
  const follow = useCallback(
    async (userId: number) => {
      try {
        applySocial(await followUser(userId))
      } catch (e) {
        alert((e as Error).message)
      }
    },
    [applySocial],
  )
  const followingIds = useMemo(() => new Set(social?.following.map((p) => p.id) ?? []), [social])
  // 내가 보내고 수락을 기다리는 팔로우 요청 (상대가 수동 승인일 때)
  const requestedIds = useMemo(() => new Set(social?.requested?.map((p) => p.id) ?? []), [social])

  // 알림을 열면 지금까지의 알림은 읽은 것으로 — 종 버튼의 숫자가 사라진다
  const openNotices = useCallback(() => {
    setNoticesOpen(true)
    markNoticesSeen()
      .then(setNotices)
      .catch(() => {})
  }, [setNotices])
  // 푸시 알림 (안드로이드 앱) — 로그인해 있으면 기기를 등록한다. 알림을 눌러 들어오면 알림 목록을 연다
  const openNoticesRef = useRef(openNotices)
  openNoticesRef.current = openNotices
  useEffect(() => {
    if (sessionToken === null) return
    let stop = () => {}
    let cancelled = false
    void startPush({
      onOpen: () => openNoticesRef.current(),
      onReceive: () => refresh('notices', 'social', 'comments'),
    }).then((s) => {
      if (cancelled) s()
      else stop = s
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [sessionToken])
  // 팔로우 요청 수락·거절 — 팔로워 목록과 알림을 함께 맞춘다
  const answerRequest = useCallback(
    async (userId: number, accept: boolean) => {
      setNoticeBusy(true)
      try {
        applySocial(await (accept ? acceptFollowRequest(userId) : rejectFollowRequest(userId)))
        refresh('notices')
      } catch (e) {
        alert((e as Error).message)
      } finally {
        setNoticeBusy(false)
      }
    },
    [applySocial],
  )
  // 알림 속 이름 — 내가 붙인 이름이 있으면 그 이름으로
  const noticeNameOf = useCallback(
    (id: number, nickname: string) => {
      for (const p of [...(social?.following ?? []), ...(social?.followers ?? [])]) if (p.id === id && p.alias) return p.alias
      return nickname
    },
    [social],
  )

  // 이웃 검색 결과 — 아는 이웃(팔로잉·팔로워)은 내가 붙인 이름이나 원래 닉네임으로, 그 밖의 인터맵 사용자는 서버 검색으로.
  // 아는 이웃을 먼저(팔로잉 → 팔로워), 그다음 서버 결과. 같은 사람은 한 번만, 나는 뺀다.
  const neighborHits = useMemo<NeighborHit[]>(() => {
    const keyword = deferredQuery.trim().toLowerCase()
    if (searchMode !== 'person' || keyword.length < MIN_QUERY_LENGTH) return []
    const hits = new Map<number, NeighborHit>()
    for (const p of [...(social?.following ?? []), ...(social?.followers ?? [])]) {
      if (hits.has(p.id)) continue
      const name = p.alias ?? p.nickname
      if (!name.toLowerCase().includes(keyword) && !p.nickname.toLowerCase().includes(keyword)) continue
      hits.set(p.id, { id: p.id, name, nickname: p.nickname, avatar: p.avatar, following: p.following, requested: requestedIds.has(p.id) })
    }
    for (const u of foundUsers) {
      if (hits.has(u.id) || u.id === session?.id) continue
      hits.set(u.id, { id: u.id, name: u.nickname, nickname: u.nickname, avatar: null, following: followingIds.has(u.id), requested: requestedIds.has(u.id) })
    }
    return [...hits.values()]
  }, [searchMode, deferredQuery, social, foundUsers, followingIds, requestedIds, session])

  // 하단 독(사람 패널·투표 바) 높이를 --dock-h로 알린다 — 현재 위치 버튼이 그 위에 선다
  const bottomDockRef = useRef<HTMLDivElement | null>(null)
  // 하단 독 높이 — 바뀌면 지도가 보이는 범위가 바뀌므로 MapCanvas가 고른 핀을 다시 가운데로
  const [dockHeight, setDockHeight] = useState(0)
  useEffect(() => {
    const root = document.documentElement
    const el = bottomDockRef.current
    if (!el) {
      root.style.setProperty('--dock-h', '0px')
      setDockHeight(0)
      return
    }
    const measure = () => {
      root.style.setProperty('--dock-h', `${el.offsetHeight > 0 ? el.offsetHeight + 10 : 0}px`)
      setDockHeight(el.offsetHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [searching])

  // 지도에서 실제로 보이는 세로 범위 — 위는 헤더·스토리·사람 칩 아래, 아래는 가게 시트(열릴 때)나 하단 독·패널 위
  const visibleArea = useCallback((sheet: boolean) => {
    // 아래에 아무 시트·패널도 없으면 그냥 화면 정가운데 (위 검색칸·칩은 지도 위에 떠 있을 뿐이라 빼지 않는다)
    const dockEl = document.querySelector('.bottom-dock')
    if (!sheet && !(dockEl && dockEl.getBoundingClientRect().height > 0)) return { top: 0, bottom: window.innerHeight }
    let top = 0
    document.querySelectorAll('.topbar__search, .topbar__chips, .story-strip').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.height > 0) top = Math.max(top, r.bottom)
    })
    const dock = document.querySelector('.bottom-dock')
    const dockTop = dock && dock.getBoundingClientRect().height > 0 ? dock.getBoundingClientRect().top : window.innerHeight
    const bottom = sheet ? restaurantSheetTop() : dockTop
    return { top: top + 8, bottom: Math.max(top + 80, bottom - 8) }
  }, [])
  // 매 렌더마다 새 함수를 넘기면 MapCanvas가 마커를 통째로 다시 그린다.
  const pickRestaurant = useCallback((restaurant: Restaurant) => setSelectedId(restaurant.id), [])
  // 검색 결과 선택은 지도만 옮긴다. 상세는 지도에서 핀을 눌러 연다.
  // 고르고 나면 결과 목록이 지도를 가리지 않도록 검색어를 비운다.
  // 결과 하나를 고르면 목록만 닫고 키워드는 남긴다 — 지도는 계속 그 키워드로 걸러진 채 그 가게로 이동
  // sheet: 이어서 가게 시트가 열린다 — 지도는 핀을 시트 위쪽에 둔다
  const focusFromSearch = useCallback((restaurant: Restaurant, sheet = false) => {
    setFocusTarget({ id: restaurant.id, lat: restaurant.lat, lng: restaurant.lng, sheet })
    setResultsOpen(false)
  }, [])

  // 지도에서 보여 줄 가게가 지금 필터에 걸려 숨으면 걸리는 필터만 푼다
  // ("후기 있는 곳만", 찜 모드, 친구 한 명 고르기, 검색어)
  const revealOnMap = useCallback(
    (target: Restaurant) => {
      if (reviewFilterChoice === 'with' && target.reviews.length === 0) setReviewFilter('all')
      if (favMode && !favorites.has(restaurantKey(target))) setFavMode(false)
      if (personId !== null && !target.reviews.some((rv) => rv.author.id === personId)) setPersonId(null)
      if (!visibleRestaurants.some((r) => r.id === target.id) && query.trim().length >= MIN_QUERY_LENGTH) setQuery('')
    },
    [reviewFilterChoice, favMode, favorites, personId, visibleRestaurants, query],
  )

  // 스토리의 "지도에서 보기" — 후기가 가리키는 가게를 찾아 스토리를 닫고 지도를 옮긴다
  const focusFromStory = useCallback(
    (review: Review) => {
      const key = restaurantKey(review.restaurant)
      const target = reviewedRestaurants.find((r) => restaurantKey(r) === key)
      if (!target) return
      setOpenStory(null)
      // 현황판에서 연 스토리였으면 현황판도 닫아야 지도가 보인다
      setBoardOpen(false)
      revealOnMap(target)
      focusFromSearch(target)
    },
    [reviewedRestaurants, focusFromSearch, revealOnMap],
  )

  // 마이페이지 "내가 쓴 후기" — 눌러서 그 가게 시트를 연다 (수정은 시트의 수정 버튼으로)
  const openMyReview = useCallback(
    (review: Review) => {
      const key = restaurantKey(review.restaurant)
      const target = reviewedRestaurants.find((r) => restaurantKey(r) === key)
      if (!target) return
      setMyPageOpen(false)
      revealOnMap(target)
      setSelectedId(target.id)
      focusFromSearch(target, true)
    },
    [reviewedRestaurants, focusFromSearch, revealOnMap],
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
  async function addComment(reviewId: number, text: string, parentId?: number): Promise<boolean> {
    if (!session) {
      setAuthMode('start')
      return false
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
      return true
    } catch (e) {
      alert((e as Error).message)
      return false
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

  // 프로필을 열 때 앱이 이미 아는 값 — 서버 응답 전에도 프로필을 같은 모양으로 그려서 깜빡이지 않게
  const profileKnown = useMemo(() => {
    if (!social || profileUserId === null) return undefined
    const following = social.following.find((p) => p.id === profileUserId)
    const follower = social.followers.find((p) => p.id === profileUserId)
    const person = following ?? follower
    return {
      nickname: person?.nickname ?? profileName,
      alias: person?.alias ?? null,
      avatar: person?.avatar ?? null,
      following: !!following,
      followsMe: !!follower,
      // 팔로우 중이면 후기를 다 받아 와 있다 — 아니면 서버가 셀 때까지 모른다
      reviewCount: following ? reviews.filter((rv) => rv.author.id === profileUserId && !rv.author.owner).length : -1,
    }
  }, [social, profileUserId, profileName, reviews])

  // 신고 접수 — 그 글을 바로 화면에서 뺀다 (서버도 다음 목록부터 나에게 안 준다)
  const handleReported = useCallback((target: ReportTarget) => {
    if (target.type === 'REVIEW') {
      setRawReviews((prev) => prev.filter((rv) => rv.id !== target.id))
      return
    }
    setReviewComments((prev) => {
      const next: Record<number, Comment[]> = {}
      for (const [reviewId, list] of Object.entries(prev)) {
        next[Number(reviewId)] = list.filter((c) => c.id !== target.id && c.parentId !== target.id)
      }
      return next
    })
  }, [setRawReviews, setReviewComments])
  // 차단 — 그 사람 글을 바로 빼고, 팔로우 목록까지 서버에서 다시 받는다
  const handleBlocked = useCallback(
    (userId: number) => {
      setRawReviews((prev) => prev.filter((rv) => rv.author.id !== userId))
      setReviewComments((prev) => {
        const next: Record<number, Comment[]> = {}
        for (const [reviewId, list] of Object.entries(prev)) {
          const hidden = new Set(list.filter((c) => c.authorId === userId).map((c) => c.id))
          next[Number(reviewId)] = list.filter((c) => !hidden.has(c.id) && !(c.parentId && hidden.has(c.parentId)))
        }
        return next
      })
      refreshContent()
    },
    [refreshContent, setRawReviews, setReviewComments],
  )
  const moderation = useMemo<Moderation | null>(
    () => (session ? { myUserId: session.id, report: setReportTarget } : null),
    [session],
  )
  // 투표 후보 담기/빼기 (가게 시트의 투표 버튼)
  const togglePollCandidate = useCallback(
    (place: { name: string; category: string; address: string }) => {
      const key = restaurantKey(place)
      if (pollCart.some((c) => restaurantKey(c) === key)) {
        setPollCart(pollCart.filter((c) => restaurantKey(c) !== key))
      } else if (pollCart.length >= POLL_MAX_OPTIONS) {
        alert(`후보는 ${POLL_MAX_OPTIONS}곳까지 담을 수 있어요.`)
      } else {
        setPollCart([...pollCart, place])
      }
    },
    [pollCart],
  )
  const openComposer = useCallback(() => {
    if (!session) {
      setAuthMode('start')
      return
    }
    setSelectedId(null)
    setComposerOpen(true)
  }, [session])
  const [createdPoll, setCreatedPoll] = useState<PollView | null>(null)
  // 시트를 닫으면 버린다 — 나중에 같은 투표를 다시 열 땐 새로 받고 배경도 정상적으로 페이드
  useEffect(() => {
    if (!openPoll) setCreatedPoll(null)
  }, [openPoll])
  const handlePollCreated = useCallback((poll: PollView) => {
    setPollCart([])
    setComposerOpen(false)
    setCreatedPoll(poll)
    setOpenPoll(poll.token)
    setPollVersion((v) => v + 1)
  }, [])
  // 찜한 가게 — 투표 만들기에서 후보로 바로 더할 수 있게
  const favoriteCandidates = useMemo(
    () => favRestaurants.map((r) => ({ name: r.name, category: r.category, address: r.address })),
    [favRestaurants],
  )

  // 월간 결산 열기. 지난달 동그라미로 열었으면 "봤음"으로 남긴다
  const openRecap = useCallback((month: string) => {
    setRecapMonth(month)
    if (month === prevMonth(kstMonth())) {
      setRecapSeen(month)
      try {
        localStorage.setItem('intermap.recapSeen', month)
      } catch {
        // 못 남기면 이번 주 동안 다시 보일 뿐
      }
    }
  }, [])
  // 마이페이지에서 열 땐 이번 달에 후기가 있으면 이번 달, 없으면 가장 최근에 후기를 남긴 달
  const openRecapFromMyPage = useCallback(() => {
    const now = kstMonth()
    const mine = rawReviews.filter((rv) => rv.author.id === session?.id)
    openRecap(mine.some((rv) => kstMonth(rv.createdAt) === now) || mine.length === 0 ? now : kstMonth(mine[0].createdAt))
  }, [rawReviews, session?.id, openRecap])
  // 달이 바뀐 첫 주엔 스토리 줄 맨 앞에 "지난달 결산" — 지난달에 후기를 남겼을 때만
  const recapChip = useMemo(() => {
    if (!session) return null
    const last = prevMonth(kstMonth())
    const day = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', day: '2-digit' }).format(new Date()))
    if (day > 7 || recapSeen === last) return null
    const had = rawReviews.some((rv) => rv.author.id === session.id && kstMonth(rv.createdAt) === last)
    return had ? { label: `${monthLabel(last)} 결산`, onOpen: () => openRecap(last) } : null
  }, [session, rawReviews, recapSeen, openRecap])

  // 회원 탈퇴 — 서버에서 지운 뒤 로그아웃 상태로
  const handleDeleteAccount = useCallback(async () => {
    await deleteAccount()
    setMyPageOpen(false)
    clearSession()
    window.alert('탈퇴했어요. 그동안 인터맵을 이용해 주셔서 고마워요.')
  }, [clearSession])

  // 웹(아이폰 사파리 등)에선 브라우저 뒤로가기·왼쪽 끝 쓸기가 페이지를 떠나 버린다.
  // 무언가 열려 있으면 기록을 한 칸 쌓아 두고, 뒤로가 오면 위 레이어 하나만 닫는다. 아직 열린 게 남았으면 다시 한 칸 쌓는다.
  // 화면 버튼으로 전부 닫았으면 쌓아 둔 칸을 조용히 걷어 낸다 (다음 뒤로가기가 헛돌지 않게).
  const anyLayerOpen = !!(
    policyPage ||
    reportTarget ||
    recapMonth ||
    openPoll ||
    composerOpen ||
    adminReportsOpen ||
    adminOpsOpen ||
    profileUserId !== null ||
    boardOpen ||
    noticesOpen ||
    openStory ||
    authMode ||
    myPageOpen ||
    selectedId ||
    personId !== null ||
    searching ||
    favMode
  )
  const historyGuard = useRef(false)
  const ignoreNextPop = useRef(false)
  const [popTick, setPopTick] = useState(0)
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return
    if (anyLayerOpen && !historyGuard.current) {
      window.history.pushState({ intermapLayer: true }, '')
      historyGuard.current = true
    } else if (!anyLayerOpen && historyGuard.current) {
      historyGuard.current = false
      ignoreNextPop.current = true
      window.history.back()
    }
  }, [anyLayerOpen, popTick])
  useEffect(() => {
    if (Capacitor.isNativePlatform()) return
    const onPop = () => {
      if (ignoreNextPop.current) {
        ignoreNextPop.current = false
        return
      }
      historyGuard.current = false
      handleBackRef.current()
      setPopTick((n) => n + 1)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return (
    <OpenProfileContext.Provider value={openProfile}>
    <ModerationContext.Provider value={moderation}>
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
        visibleArea={visibleArea}
        sheetOpen={selectedRestaurant !== null}
        dockHeight={dockHeight}
        onViewportChange={loadViewport}
        onMyLocation={handleMyLocation}
        // 지도 빈 곳을 누르면 떠 있는 하단 시트(가게 시트·이웃 패널)를 전부 닫는다
        onMapTap={() => {
          setSelectedId(null)
          setPersonId(null)
        }}
      />

      <div className="app__chrome">
        <TopBar
          nickname={session?.nickname ?? null}
          avatar={session?.avatar ?? null}
          userId={session?.id ?? null}
          onLogin={() => setAuthMode('start')}
          onMyPage={() => setMyPageOpen(true)}
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
          results={
            query.trim() && resultsOpen ? (
              <SearchResults
                mode={searchMode}
                results={searchResults}
                neighbors={neighborHits}
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
          // 팔로우 정보가 늦게 와도 칩이 나중에 끼어들어 옆 칩을 밀지 않게, 로그인했으면 처음부터 둔다
          showBoard={!!session}
          boardHasNew={boardHasNew}
          selectedPerson={personView?.person ?? null}
          onClearPerson={() => setPersonId(null)}
          onOpenBoard={() => setBoardOpen(true)}
          favMode={favMode}
          onToggleFavMode={() => {
            if (!session) {
              setAuthMode('start')
              return
            }
            setFavMode((prev) => !prev)
          }}
          reviewFilter={reviewFilter}
          onReviewFilterChange={setReviewFilter}
          showReviewFilter={!!session && !personPins}
        />
        {!searching && (
          <StoryStrip
            stories={stories}
            onOpen={setOpenStory}
            recap={recapChip}
            // 팔로우가 셋 미만이면 끝에 "+ 친구 찾기" — 사람 검색을 연다
            onFindFriends={
              session && social && social.following.length < 3
                ? () => {
                    setPersonId(null)
                    setSearchMode('person')
                    setResultsOpen(true)
                    setSearching(true)
                  }
                : undefined
            }
          />
        )}
        {/* 스토리는 항상 헤더 바로 아래 — 칩은 그 밑에 */}
      </div>

      {/* 하단 — 친구 한 명 보기 패널, 투표 후보 바 (검색은 위로 옮겼다) */}
      {!searching && (
        <div className="bottom-dock" ref={bottomDockRef}>
          {personView && (
            <PersonPanel
              key={personView.person.id}
              person={personView.person}
              places={personView.places}
              reviewCount={personView.reviewCount}
              tag={personView.tag}
              // 지도만 그 가게로 옮긴다 — 상세 시트는 띄우지 않는다 (핀을 누르면 그때 연다)
              onPick={(restaurant) => focusFromSearch(restaurant)}
              onOpenProfile={() => openProfile(personView.person.id)}
              onClose={() => setPersonId(null)}
            />
          )}
          {pollCart.length > 0 && (
            <PollCartBar count={pollCart.length} onOpen={openComposer} onClear={() => setPollCart([])} />
          )}
        </div>
      )}

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
        inPoll={selectedRestaurant ? pollCart.some((c) => restaurantKey(c) === restaurantKey(selectedRestaurant)) : false}
        onTogglePoll={togglePollCandidate}
      />

      {session && (
        <MyPage
          open={myPageOpen}
          covered={
            profileUserId !== null ||
            !!recapMonth ||
            !!openPoll ||
            !!policyPage ||
            !!reportTarget ||
            composerOpen ||
            adminReportsOpen ||
            adminOpsOpen
          }
          session={session}
          social={social}
          onSocialChange={applySocial}
          onSessionChange={handleAuthed}
          myReviews={rawReviews.filter((rv) => rv.author.id === session.id)}
          onOpenReview={openMyReview}
          onBlocksChange={refreshContent}
          onDeleteAccount={handleDeleteAccount}
          onOpenPolicy={setPolicyPage}
          isAdmin={isAdmin(session)}
          isOperator={isOperator(session)}
          onOpenReports={() => setAdminReportsOpen(true)}
          onOpenOps={() => setAdminOpsOpen(true)}
          onOpenRecap={openRecapFromMyPage}
          onOpenPoll={setOpenPoll}
          pollVersion={pollVersion}
          onLogout={() => {
            setMyPageOpen(false)
            handleLogout()
          }}
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
        // 스토리 위로 프로필·신고 시트가 떠 있는 동안은 자동 넘김을 멈춘다
        paused={profileStack.length > 0 || reportTarget !== null}
      />

      {session && profileUserId !== null && (
        <ProfileSheet
          // 사람이 바뀌면 새로 — 이전 사람 이름·팔로우 상태가 한 프레임 보이거나 늦은 응답이 섞이지 않게
          key={profileUserId}
          userId={profileUserId}
          fallbackName={profileName}
          known={profileKnown}
          restaurants={reviewedRestaurants}
          myUserId={session.id}
          myName={session.nickname}
          reviews={reviews}
          list={profileTop?.list ?? null}
          onListChange={setProfileList}
          onSocialChange={applySocial}
          onBlockChange={refreshContent}
          // 프로필은 가게 시트의 후기에서 열리기도 한다 — 지도만 옮기면 뒤에 있던 시트가 예전 가게로 남으므로 시트도 바꾼다
          onPick={(restaurant) => {
            setProfileStack([])
            // 스토리·마이페이지·팔로잉 현황에서 연 프로필이면 그 위층들도 닫아야 시트와 지도가 보인다
            // (현황판은 프로필이 떠 있는 동안만 숨어 있어서, 안 닫으면 프로필이 닫히자마자 다시 뜬다)
            setOpenStory(null)
            setMyPageOpen(false)
            setBoardOpen(false)
            revealOnMap(restaurant)
            setSelectedId(restaurant.id)
            focusFromSearch(restaurant, true)
          }}
          onClose={() => setProfileStack([])}
        />
      )}

      {session && social && boardOpen && (
        <FollowingBoard
          people={social.following}
          reviews={reviews}
          onShowOnMap={(id) => {
            setBoardOpen(false)
            // 이 사람 핀이 가려지지 않게 찜 모드·검색어는 풀고, 가장 최근에 간 곳으로 지도를 옮긴다
            setFavMode(false)
            setQuery('')
            setSearching(false)
            setPersonId(id)
            let latest: { restaurant: Restaurant; at: number } | null = null
            for (const restaurant of reviewedRestaurants) {
              for (const rv of restaurant.reviews) {
                const at = Date.parse(rv.createdAt)
                if (rv.author.id === id && (!latest || at > latest.at)) latest = { restaurant, at }
              }
            }
            if (latest) focusFromSearch(latest.restaurant)
          }}
          onOpenProfile={openProfile}
          storyIds={storyIds}
          onOpenStory={(id) => {
            const s = stories.find((x) => x.id === id)
            if (s) setOpenStory(s)
          }}
          onFindPeople={() => {
            setBoardOpen(false)
            setPersonId(null)
            setSearchMode('person')
            setResultsOpen(true)
            setSearching(true)
          }}
          // 위에 프로필·스토리가 열려 있으면 잠시 숨긴다 — 닫으면 현황판으로 돌아온다
          hidden={profileUserId !== null || openStory !== null}
          onClose={() => setBoardOpen(false)}
        />
      )}

      {session && (
        <button type="button" className="map-bell" onClick={openNotices} aria-label={notices?.unread ? `알림 ${notices.unread}개` : '알림'}>
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9z" />
            <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
          </svg>
          {!!notices?.unread && <span className="map-bell__badge">{notices.unread > 9 ? '9+' : notices.unread}</span>}
        </button>
      )}

      {session && noticesOpen && (
        <NoticeSheet
          notices={notices?.items ?? []}
          unread={notices?.unread ?? 0}
          nameOf={noticeNameOf}
          busy={noticeBusy}
          onAccept={(id) => answerRequest(id, true)}
          onReject={(id) => answerRequest(id, false)}
          onOpenProfile={openProfile}
          onOpenReview={(reviewId) => {
            // 그 후기가 달린 가게를 지도에서 열어 댓글을 바로 보게 한다. 못 찾으면(지워졌거나 아직 못 받은 후기) 그대로 둔다
            const restaurant = reviewedRestaurants.find((r) => r.reviews.some((rv) => rv.id === reviewId))
            if (!restaurant) return
            setNoticesOpen(false)
            setFavMode(false)
            setPersonId(null)
            setSelectedId(restaurant.id)
            focusFromSearch(restaurant, true)
          }}
          // 위에 프로필이 열려 있으면 잠시 숨긴다 — 닫으면 알림으로 돌아온다
          hidden={profileUserId !== null}
          onClose={() => setNoticesOpen(false)}
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
        onOpenPolicy={setPolicyPage}
      />

      {session && adminReportsOpen && (
        <AdminReports onChanged={refreshContent} onClose={() => setAdminReportsOpen(false)} />
      )}
      {session && adminOpsOpen && <AdminOps onClose={() => setAdminOpsOpen(false)} />}
      {reportTarget && (
        <ReportSheet
          target={reportTarget}
          onReported={handleReported}
          onBlocked={handleBlocked}
          onClose={() => setReportTarget(null)}
        />
      )}
      {composerOpen && session && (
        <PollComposer
          candidates={pollCart}
          onCandidatesChange={setPollCart}
          favorites={favoriteCandidates}
          onCreated={handlePollCreated}
          onClose={() => setComposerOpen(false)}
        />
      )}
      {openPoll && (
        <PollSheet
          key={openPoll}
          token={openPoll}
          initial={createdPoll?.token === openPoll ? createdPoll : undefined}
          session={session}
          onLogin={() => {
            // 로그인 창은 투표 시트 아래 층이라 시트를 닫고 띄운다
            setOpenPoll(null)
            setAuthMode('start')
          }}
          onChanged={() => setPollVersion((v) => v + 1)}
          onClose={() => setOpenPoll(null)}
        />
      )}
      {recapMonth && session && <RecapSheet month={recapMonth} onClose={() => setRecapMonth(null)} />}
      {policyPage && <PolicyViewer page={policyPage} onClose={() => setPolicyPage(null)} />}
    </div>
    </ModerationContext.Provider>
    </OpenProfileContext.Provider>
  )
}
