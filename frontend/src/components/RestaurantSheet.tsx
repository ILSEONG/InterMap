import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useBackLayer } from '../lib/backLayer'
import type { Comment, Restaurant, FriendGroup, Review } from '../data/model'
import { photoUrl } from '../lib/api'
import ReviewCard from './ReviewCard'
import ReviewComments from './ReviewComments'
import { STAR_SHAPE } from './Stars'
import { BallotIcon } from './PollIcons'
import './RestaurantSheet.css'

interface RestaurantSheetProps {
  restaurant: Restaurant | null
  // 이 가게에 달린 주인장 후기. 비어 있으면 영역 자체를 숨긴다
  ownerReviews: Review[]
  // 주인장(admin)으로 로그인한 상태 — 후기 폼이 주인장 후기로 저장된다
  asOwner: boolean
  groups: FriendGroup[]
  onClose: () => void
  // 서버 저장이 끝나면 resolve. 실패하면 reject (입력값을 지우지 않기 위해)
  onAddReview: (restaurantId: string, rating: number, text: string, menu: string, photos: File[]) => Promise<void>
  // 내 후기 수정. 로그인 사용자 id와 후기 작성자 id가 같을 때만 수정 버튼이 보인다
  myUserId?: number
  onEditReview: (reviewId: number, rating: number, text: string, menu: string, keepPhotoIds: number[], photos: File[]) => Promise<void>
  onDeleteReview: (reviewId: number) => Promise<void>
  // 후기별 댓글 — 후기 id로 찾는다
  comments: Record<number, Comment[]>
  onAddComment: (reviewId: number, text: string, parentId?: number) => Promise<boolean>
  onDeleteComment: (reviewId: number, commentId: number) => void
  // 이 가게를 찜했는지 + 별 버튼 토글
  favored: boolean
  onToggleFavorite: (place: { name: string; address: string }) => void
  // "어디 갈래?" 투표 후보로 담았는지 + 담기/빼기
  inPoll: boolean
  onTogglePoll: (place: { name: string; category: string; address: string }) => void
}

// 후기 한 개에 붙일 수 있는 사진 수 (서버 ReviewController.MAX_PHOTOS와 같게)
const MAX_PHOTOS = 10
// 시트가 멈추는 높이 두 개 — 기본(지도 마커 바로 아래까지)과 거의 전체.
// 시트 높이는 "전체"로 고정해 두고 아래로 밀어(transform) 기본 높이를 만든다 — 끄는 동안 레이아웃을 다시 계산하지 않아
// 아래 버튼이 떨리거나 깜빡이지 않는다 (버튼은 같은 거리만큼 반대로 올려 화면 아래에 붙여 둔다).
type Snap = 'default' | 'full'
// 손을 뗀 순간의 속도로 이만큼(ms) 더 간다고 보고 가장 가까운 높이로 붙인다 (iOS 시트·지도 앱 방식)
const PROJECT_MS = 200
// 이만큼 움직여야 끌기로 본다 (그 전엔 탭·가로 스와이프일 수 있다)
const DRAG_SLOP = 6
// 기본 높이에서 아래로 이만큼(투영 거리) 넘기면 닫는다
const CLOSE_DISTANCE = 80
// 이 속도(px/ms) 이상으로 쓸면 거리와 상관없이 그 방향 높이로 (지도 앱 시트들이 0.3~0.5 정도)
const FLICK = 0.35
const defaultHeight = () => Math.round(window.innerHeight * 0.5 - 28)

export default function RestaurantSheet({
  restaurant,
  ownerReviews,
  asOwner,
  groups,
  onClose,
  onAddReview,
  myUserId,
  onEditReview,
  onDeleteReview,
  comments,
  onAddComment,
  onDeleteComment,
  favored,
  onToggleFavorite,
  inPoll,
  onTogglePoll,
}: RestaurantSheetProps) {
  const open = restaurant !== null
  // 닫힐 때 restaurant이 즉시 null이 되는데 패널은 애니메이션으로 내려간다.
  // 내용을 바로 비우면 빈 패널이 한 프레임 번쩍이므로 마지막 가게를 유지한 채 닫는다.
  const lastRestaurantRef = useRef<Restaurant | null>(null)
  if (restaurant) lastRestaurantRef.current = restaurant
  const shown = restaurant ?? lastRestaurantRef.current

  const sheetRef = useRef<HTMLDivElement>(null)
  const [snap, setSnap] = useState<Snap>('default')
  // 드래그 중에는 transition을 꺼서 손가락을 그대로 따라오게 한다.
  const [dragging, setDragging] = useState(false)
  // 시트 실제 높이(= 전체 높이). 화면 회전·키보드에 따라 바뀐다
  const [fullHeight, setFullHeight] = useState(() => Math.round(window.innerHeight * 0.92))

  // 열릴 때마다 기본 높이에서 시작한다 (닫힌 상태에서 바뀌므로 화면에는 보이지 않음)
  const wasOpenRef = useRef(open)
  if (open !== wasOpenRef.current) {
    wasOpenRef.current = open
    if (open && snap !== 'default') setSnap('default')
  }

  useLayoutEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const measure = () => setFullHeight(sheet.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(sheet)
    return () => observer.disconnect()
  }, [])

  const offsetOf = (s: Snap) => (s === 'full' ? 0 : Math.max(0, fullHeight - defaultHeight()))
  const offset = offsetOf(snap)

  // 끌어서 닫으면 마지막으로 끌던 위치가 DOM에 남는다(React는 이전 값과 같다고 보고 안 고친다) — 열 때 맞춰 둔다
  useLayoutEffect(() => {
    const sheet = sheetRef.current
    if (!open || !sheet) return
    sheet.style.setProperty('--sheet-offset', `${offset}px`)
    sheet.style.transform = `translateY(${offset}px)`
    // 처음 열 때만 — 이후엔 settle()이 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 터치 리스너는 한 번만 붙이고 최신 값은 ref로 읽는다
  const live = useRef({ snap, fullHeight, offsetOf, onClose })
  live.current = { snap, fullHeight, offsetOf, onClose }

  const dragRef = useRef<{ startY: number; startOffset: number; lastY: number; lastT: number; v: number; offset: number } | null>(null)
  const frameRef = useRef<number | null>(null)

  // 시트와 아래 버튼을 같은 프레임에 옮긴다 (둘 다 transform이라 레이아웃 없음)
  function apply(px: number) {
    const sheet = sheetRef.current
    if (!sheet) return
    const y = Math.round(px)
    sheet.style.transform = `translateY(${y}px)`
    sheet.style.setProperty('--sheet-offset', `${y}px`)
  }

  function begin(y: number, t: number) {
    const start = live.current.offsetOf(live.current.snap)
    dragRef.current = { startY: y, startOffset: start, lastY: y, lastT: t, v: 0, offset: start }
    setDragging(true)
  }

  function move(y: number, t: number) {
    const d = dragRef.current
    if (!d) return
    const dt = t - d.lastT
    if (dt > 0) {
      // 아래로 움직이면 양수. 최근 움직임 위주로 평활해 놓는 순간의 속도를 얻는다
      d.v = 0.25 * d.v + 0.75 * ((y - d.lastY) / dt)
      d.lastY = y
      d.lastT = t
    }
    let next = d.startOffset + (y - d.startY)
    // 전체 높이보다 더 끌어올리면 고무줄처럼 버틴다
    if (next < 0) next *= 0.25
    d.offset = Math.min(next, live.current.fullHeight - 60)
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        if (dragRef.current) apply(dragRef.current.offset)
      })
    }
  }

  function settle(s: Snap) {
    apply(live.current.offsetOf(s))
    setSnap(s)
  }

  function end() {
    const d = dragRef.current
    dragRef.current = null
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    setDragging(false)
    if (!d) return
    const from = live.current.snap
    const rest = live.current.offsetOf('default')
    // 손가락을 멈췄다가 떼면 튕긴 게 아니다
    const v = performance.now() - d.lastT > 90 ? 0 : d.v
    const moved = d.offset - d.startOffset
    const projected = d.offset + v * PROJECT_MS
    if (Math.abs(moved) < 3 && Math.abs(v) < 0.2) {
      settle(from)
      return
    }
    // 펼친 상태 — 조금만(20%) 내리거나 아래로 튕기면 기본 높이로. 아무리 세게 쓸어도 닫지는 않는다
    if (from === 'full') {
      settle(v > FLICK || projected > rest * 0.2 ? 'default' : 'full')
      return
    }
    // 기본 높이 — 조금만(20%) 올리거나 위로 튕기면 펼친다
    if (v < -FLICK || projected < rest * 0.8) {
      settle('full')
      return
    }
    // 아래로 튕기거나 충분히 내리면 닫는다
    if ((v > FLICK && moved > 16) || projected > rest + CLOSE_DISTANCE) {
      live.current.onClose()
      return
    }
    settle('default')
  }

  // 손가락: 손잡이·제목 줄은 바로 끌고, 본문은 "기본 높이에서 위로" 또는 "맨 위까지 올린 채 아래로"일 때만 시트를 끈다.
  // 그 밖엔 본문 스크롤, 가로로 움직이면 후기 슬라이더에 양보한다
  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    let touch: { x: number; y: number; scroll: HTMLElement | null; decided: boolean; active: boolean } | null = null
    const onStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement
      if (e.touches.length !== 1 || target.closest('input, textarea, .restaurant-sheet__footer, .review-card__photos')) {
        touch = null
        return
      }
      const t = e.touches[0]
      touch = { x: t.clientX, y: t.clientY, scroll: target.closest('.restaurant-sheet__scroll'), decided: false, active: false }
    }
    const onMove = (e: TouchEvent) => {
      if (!touch) return
      const t = e.touches[0]
      const dx = t.clientX - touch.x
      const dy = t.clientY - touch.y
      if (!touch.decided) {
        if (Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return
        touch.decided = true
        if (Math.abs(dx) > Math.abs(dy)) return
        const sc = touch.scroll
        const canDrag = !sc || (dy < 0 ? live.current.snap === 'default' : sc.scrollTop <= 0)
        if (!canDrag) return
        touch.active = true
        begin(t.clientY, performance.now())
      }
      if (touch.active) {
        e.preventDefault()
        move(t.clientY, performance.now())
      }
    }
    const onEnd = () => {
      if (touch?.active) end()
      touch = null
    }
    // 화면 밖(기본 높이일 때 시트 아래쪽)의 요소로 브라우저가 scrollIntoView를 하면 overflow:hidden인 시트 자체가
    // 밀려 올라가 버튼·본문이 어긋난다 — 시트 자체 스크롤은 늘 0으로 되돌린다
    const onSheetScroll = () => {
      if (el.scrollTop !== 0) el.scrollTop = 0
    }
    // 기본 높이에서 댓글·입력칸을 누르면 먼저 펼친다 (키보드가 올라와도 입력칸이 보이게)
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (target.matches('input, textarea') && live.current.snap === 'default') settle('full')
    }
    el.addEventListener('scroll', onSheetScroll)
    el.addEventListener('focusin', onFocusIn)
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('scroll', onSheetScroll)
      el.removeEventListener('focusin', onFocusIn)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
    // begin·move·end는 ref만 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 마우스(데스크톱 웹)는 손잡이로만 끈다 — 터치는 위 리스너가 맡는다
  function onGrabDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== 'mouse') return
    begin(e.clientY, performance.now())
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onGrabMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse') move(e.clientY, performance.now())
  }
  function onGrabUp(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse') end()
  }

  // 후기 쓰기 화면으로 넘어가면 시트를 거의 끝까지 펼친다 (입력칸·사진이 다 들어오도록)
  function expand() {
    settle('full')
  }

  return (
    <div className={`restaurant-sheet-overlay${open ? ' restaurant-sheet-overlay--open' : ''}`} onClick={onClose}>
      <div
        ref={sheetRef}
        className={`restaurant-sheet${dragging ? ' restaurant-sheet--dragging' : ''}`}
        // 열려 있으면 기본 높이만큼 아래로 밀어 둔다 (닫히면 CSS가 화면 밖으로). --sheet-rest는 본문 끝 여백
        style={
          {
            ...(open ? { transform: `translateY(${offset}px)` } : null),
            '--sheet-offset': `${offset}px`,
            '--sheet-rest': `${offset}px`,
          } as React.CSSProperties
        }
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={shown ? `${shown.name} 상세` : '음식점 상세'}
        aria-hidden={!open}
      >
        {shown && (
          <>
            <div
              className="restaurant-sheet__grab"
              onPointerDown={onGrabDown}
              onPointerMove={onGrabMove}
              onPointerUp={onGrabUp}
              onPointerCancel={onGrabUp}
            >
              <div className="restaurant-sheet__handle" />
            </div>
            {/* key를 걸어 가게가 바뀌면 작성 중이던 후기·댓글 입력값이 비워지도록 한다 */}
            <SheetBody
              key={shown.id}
              open={open}
              restaurant={shown}
              ownerReviews={ownerReviews}
              asOwner={asOwner}
              groups={groups}
              onClose={onClose}
              onExpand={expand}
              onAddReview={onAddReview}
              myUserId={myUserId}
              onEditReview={onEditReview}
              onDeleteReview={onDeleteReview}
              comments={comments}
              onAddComment={onAddComment}
              onDeleteComment={onDeleteComment}
              favored={favored}
              onToggleFavorite={onToggleFavorite}
              inPoll={inPoll}
              onTogglePoll={onTogglePoll}
            />
          </>
        )}
      </div>
    </div>
  )
}

interface SheetBodyProps {
  // 시트가 열려 있는지 — 닫히면 후기 쓰기 화면에서 상세 화면으로 되돌린다 (작성 중인 내용은 그대로)
  open: boolean
  restaurant: Restaurant
  ownerReviews: Review[]
  asOwner: boolean
  groups: FriendGroup[]
  onClose: () => void
  // 후기 쓰기 화면으로 넘어갈 때 시트를 크게 펼친다
  onExpand: () => void
  // 서버 저장이 끝나면 resolve. 실패하면 reject (입력값을 지우지 않기 위해)
  onAddReview: (restaurantId: string, rating: number, text: string, menu: string, photos: File[]) => Promise<void>
  // 내 후기 수정. 로그인 사용자 id와 후기 작성자 id가 같을 때만 수정 버튼이 보인다
  myUserId?: number
  onEditReview: (reviewId: number, rating: number, text: string, menu: string, keepPhotoIds: number[], photos: File[]) => Promise<void>
  onDeleteReview: (reviewId: number) => Promise<void>
  // 후기별 댓글 — 후기 id로 찾는다
  comments: Record<number, Comment[]>
  onAddComment: (reviewId: number, text: string, parentId?: number) => Promise<boolean>
  onDeleteComment: (reviewId: number, commentId: number) => void
  // 이 가게를 찜했는지 + 별 버튼 토글
  favored: boolean
  onToggleFavorite: (place: { name: string; address: string }) => void
  // "어디 갈래?" 투표 후보로 담았는지 + 담기/빼기
  inPoll: boolean
  onTogglePoll: (place: { name: string; category: string; address: string }) => void
}

// 이웃 후기 슬라이더의 카드 사이 간격 (CSS .restaurant-sheet__reviews gap과 같게)
const SLIDE_GAP = 10

// 별점 옆에 붙는 한마디
function ratingWord(value: number) {
  if (value < 1.5) return '별로였어요'
  if (value < 2.5) return '아쉬웠어요'
  if (value < 3.5) return '괜찮았어요'
  if (value < 4.5) return '좋았어요'
  return '최고였어요'
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9l-4-4L4 16z" />
    </svg>
  )
}

function SheetBody({
  open,
  restaurant,
  ownerReviews,
  asOwner,
  groups,
  onClose,
  onExpand,
  onAddReview,
  myUserId,
  onEditReview,
  onDeleteReview,
  comments,
  onAddComment,
  onDeleteComment,
  favored,
  onToggleFavorite,
  inPoll,
  onTogglePoll,
}: SheetBodyProps) {
  const [draftRating, setDraftRating] = useState(5)
  const [draftReview, setDraftReview] = useState('')
  // 추천 메뉴: 확인을 누를 때마다 draftMenus에 쌓이고, 저장 시 ", "로 합쳐 보낸다
  const [draftMenu, setDraftMenu] = useState('')
  const [draftMenus, setDraftMenus] = useState<string[]>([])
  const [draftPhotos, setDraftPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  // 수정 중인 내 후기. 같은 폼을 재사용 — 기존 사진은 keepPhotoIds로, 새 사진은 draftPhotos로
  const [editing, setEditing] = useState<Review | null>(null)
  const [keepPhotoIds, setKeepPhotoIds] = useState<number[]>([])
  // 상세 화면 ↔ 후기 쓰기 화면 (같은 시트 안에서 바꿔 끼운다)
  const [view, setView] = useState<'detail' | 'write'>('detail')
  // 이웃 후기 슬라이더에서 지금 보이는 카드 — 그 후기의 댓글을 아래에 펼친다
  const [activeSlide, setActiveSlide] = useState(0)
  const formRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const ids = useId()
  // 선택한 사진 미리보기 URL. 목록이 바뀔 때마다 이전 URL은 해제한다
  const previews = useMemo(() => draftPhotos.map((f) => URL.createObjectURL(f)), [draftPhotos])
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews])

  // 시트가 닫히면 다음에 열 때 상세 화면부터 보이게 한다
  const wasOpenRef = useRef(open)
  if (open !== wasOpenRef.current) {
    wasOpenRef.current = open
    if (!open && view !== 'detail') setView('detail')
  }

  // 화면이 바뀌면 맨 위부터
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [view])

  const avgRating = restaurant.reviews.reduce((sum, r) => sum + r.rating, 0) / (restaurant.reviews.length || 1)
  const myGroups = groups.filter((g) => restaurant.groupIds.includes(g.id))
  const slide = Math.min(activeSlide, Math.max(restaurant.reviews.length - 1, 0))
  const activeReview = restaurant.reviews[slide]

  function resetForm() {
    setDraftReview('')
    setDraftRating(5)
    setDraftMenu('')
    setDraftMenus([])
    setDraftPhotos([])
    setEditing(null)
    setKeepPhotoIds([])
  }

  // 입력 중인 메뉴를 목록에 추가 (중복·합계 100자 초과는 무시하고 알린다)
  function addMenu() {
    const name = draftMenu.trim()
    if (!name) return
    if (draftMenus.includes(name)) {
      setDraftMenu('')
      return
    }
    const joined = [...draftMenus, name].join(', ')
    if (joined.length > 100) {
      alert('추천 메뉴는 다 합쳐 100자까지 담을 수 있어요.')
      return
    }
    setDraftMenus((prev) => [...prev, name])
    setDraftMenu('')
  }

  function fillFrom(review: Review) {
    setEditing(review)
    setDraftRating(review.rating)
    setDraftReview(review.text)
    setDraftMenu('')
    setDraftMenus(review.menu ? review.menu.split(',').map((m) => m.trim()).filter(Boolean) : [])
    setDraftPhotos([])
    setKeepPhotoIds(review.photoIds)
  }

  function openWrite() {
    setView('write')
    onExpand()
  }

  function startEdit(review: Review) {
    fillFrom(review)
    openWrite()
    // 쓰기 화면이 렌더된 뒤 폼 맨 위로
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' }), 0)
  }

  // 수정을 그만두고 상세 화면으로
  function cancelEdit() {
    resetForm()
    setView('detail')
  }

  // 한 가게에 후기는 하나만 (서버도 409로 막는다). 이미 썼으면 수정으로만 폼이 열린다.
  const myReview =
    myUserId === undefined ? undefined : [...restaurant.reviews, ...ownerReviews].find((r) => r.author.id === myUserId)
  // 방금 등록·수정해서 myReview가 새로 생기거나 바뀌면, 열려 있던 폼(같은 후기 수정 중)의 내용을 새 값으로 맞춘다.
  useEffect(() => {
    if (myReview && editing && editing.id === myReview.id) fillFrom(myReview)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myReview])

  // 내 후기면 수정 버튼을 붙인다
  const editHandler = (review: Review) =>
    myUserId !== undefined && review.author.id === myUserId ? () => startEdit(review) : undefined

  async function deleteReview() {
    if (!editing || submitting || !window.confirm('이 후기를 지울까요? 사진도 같이 지워져요.')) return
    setSubmitting(true)
    try {
      await onDeleteReview(editing.id)
      resetForm()
      setView('detail')
    } catch {
      // App이 alert로 알렸다
    } finally {
      setSubmitting(false)
    }
  }

  async function submitReview() {
    if (!draftReview.trim() || submitting) return
    setSubmitting(true)
    try {
      // 확인을 안 누르고 입력만 해둔 메뉴도 같이 담는다
      const pending = draftMenu.trim()
      const menus = pending && !draftMenus.includes(pending) ? [...draftMenus, pending] : draftMenus
      const menu = menus.join(', ').slice(0, 100)
      if (editing) await onEditReview(editing.id, draftRating, draftReview.trim(), menu, keepPhotoIds, draftPhotos)
      else await onAddReview(restaurant.id, draftRating, draftReview.trim(), menu, draftPhotos)
      resetForm()
      setView('detail')
    } catch {
      // App이 이미 alert로 알렸다. 입력값은 그대로 둔다
    } finally {
      setSubmitting(false)
    }
  }

  function addPhotos(list: FileList | null) {
    if (!list) return
    // setState updater는 나중에 실행된다 — 그 전에 input.value=''로 FileList가 비는 엔진이 있어
    // (모바일에서 사진 선택이 조용히 무시됨) 지금 시점에 배열로 복사해 둔다.
    const files = Array.from(list)
    setDraftPhotos((prev) => [...prev, ...files].slice(0, MAX_PHOTOS - keepPhotoIds.length))
  }

  // 슬라이더가 멈춘 자리의 카드 번호
  function onSlide(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget
    const first = el.firstElementChild as HTMLElement | null
    if (!first) return
    const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 2
    const next = atEnd ? restaurant.reviews.length - 1 : Math.round(el.scrollLeft / (first.offsetWidth + SLIDE_GAP))
    if (next !== activeSlide) setActiveSlide(next)
  }

  // 이미 후기를 남긴 가게는 수정으로만 폼이 열린다
  const writing = view === 'write' && !(myReview && !editing)
  // 안드로이드 뒤로가기: 후기 쓰기 화면이면 시트를 닫지 않고 상세로 돌아간다
  useBackLayer(writing, () => (editing ? cancelEdit() : setView('detail')))
  const photoCount = keepPhotoIds.length + draftPhotos.length

  if (writing) {
    const title = editing ? '후기 수정' : asOwner ? '주인장 후기 쓰기' : '후기 쓰기'
    return (
      <>
        <div className="restaurant-sheet__head restaurant-sheet__head--write">
          <button
            type="button"
            className="restaurant-sheet__icon-btn restaurant-sheet__icon-btn--sm"
            // 수정 중이면 고친 내용을 버리고 돌아간다 (예전 '수정 취소' 버튼 역할)
            onClick={() => (editing ? cancelEdit() : setView('detail'))}
            aria-label={editing ? '수정 취소하고 돌아가기' : '상세로 돌아가기'}
          >
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <div className="restaurant-sheet__write-title">
            <h2 className="restaurant-sheet__write-heading">{title}</h2>
            <p className="restaurant-sheet__write-sub">
              {restaurant.name} · {restaurant.category}
            </p>
          </div>
          <button type="button" className="restaurant-sheet__icon-btn restaurant-sheet__icon-btn--sm" onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </div>

        <div className="restaurant-sheet__scroll" ref={scrollRef}>
          <div className="review-form" ref={formRef}>
            <div className="review-form__rate">
              <span id={`${ids}-rate`} className="review-form__rate-label">
                별점
              </span>
              <StarPicker value={draftRating} onChange={setDraftRating} labelledBy={`${ids}-rate`} />
              <span className="review-form__score">
                {draftRating.toFixed(1)} · {ratingWord(draftRating)}
              </span>
            </div>

            <label className="review-form__label" htmlFor={`${ids}-text`}>
              후기
            </label>
            <textarea
              id={`${ids}-text`}
              className="review-form__text"
              value={draftReview}
              onChange={(e) => setDraftReview(e.target.value)}
              placeholder={asOwner ? '주인장으로 남기는 후기 — 모두에게 보여요' : '이 가게 어땠어요? 이웃들에게 알려주세요'}
              aria-label="후기 입력"
              rows={4}
            />

            <label className="review-form__label" htmlFor={`${ids}-menu`}>
              추천 메뉴
            </label>
            <div className="review-form__menu-row">
              <input
                id={`${ids}-menu`}
                className="review-form__menu"
                type="text"
                value={draftMenu}
                maxLength={50}
                onChange={(e) => setDraftMenu(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addMenu()
                  }
                }}
                placeholder="예) 바지락칼국수"
                aria-label="추천 메뉴"
                enterKeyHint="done"
              />
              <button type="button" className="review-form__menu-add" onClick={addMenu} disabled={!draftMenu.trim()}>
                추가
              </button>
            </div>
            {draftMenus.length > 0 && (
              <div className="review-form__menu-chips">
                {draftMenus.map((name) => (
                  <span key={name} className="review-form__menu-chip">
                    {name}
                    <button
                      type="button"
                      onClick={() => setDraftMenus((prev) => prev.filter((m) => m !== name))}
                      aria-label={`${name} 빼기`}
                    >
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            <span className="review-form__label">사진</span>
            <div className="review-form__photos">
              {photoCount < MAX_PHOTOS && (
                <label className="review-form__add-photo">
                  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span className="review-form__add-photo-count">
                    {photoCount}/{MAX_PHOTOS}
                  </span>
                  <input
                    className="review-form__file"
                    type="file"
                    accept="image/*"
                    multiple
                    aria-label="사진 추가"
                    onChange={(e) => {
                      addPhotos(e.target.files)
                      e.target.value = ''
                    }}
                  />
                </label>
              )}
              {keepPhotoIds.map((id) => (
                <span key={id} className="review-form__thumb">
                  <img src={photoUrl(editing?.photoUrls[editing.photoIds.indexOf(id)] ?? '')} alt="올려둔 사진" />
                  <button type="button" onClick={() => setKeepPhotoIds((prev) => prev.filter((k) => k !== id))} aria-label="사진 빼기">
                    <CloseIcon />
                  </button>
                </span>
              ))}
              {previews.map((url, i) => (
                <span key={url} className="review-form__thumb">
                  <img src={url} alt={`선택한 사진 ${i + 1}`} />
                  <button
                    type="button"
                    onClick={() => setDraftPhotos((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="사진 빼기"
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))}
              {/* 빈 칸 자리 표시 — 사진이 몇 장 더 들어갈 수 있는지 보여주는 장식 */}
              {Array.from({ length: Math.max(0, 3 - photoCount) }, (_, i) => (
                <span key={`slot-${i}`} className="review-form__slot" aria-hidden="true" />
              ))}
            </div>
          </div>
        </div>

        <div className="restaurant-sheet__footer">
          <div className="review-form__actions">
            {editing && (
              <button type="button" className="review-form__cancel review-form__cancel--danger" onClick={deleteReview} disabled={submitting}>
                삭제
              </button>
            )}
            <button
              type="button"
              className="review-form__submit"
              onClick={submitReview}
              disabled={!draftReview.trim() || submitting}
            >
              {submitting ? '저장 중…' : editing ? '수정 완료' : asOwner ? '주인장 후기 등록' : '후기 등록'}
            </button>
          </div>
        </div>
      </>
    )
  }

  const ctaLabel = editing ? '수정 이어서 하기' : myReview ? '내 후기 수정' : asOwner ? '주인장 후기 쓰기' : '후기 쓰기'

  return (
    <>
      <div className="restaurant-sheet__head">
        <div className="restaurant-sheet__title">
          <h2 className="restaurant-sheet__name">{restaurant.name}</h2>
          <p className="restaurant-sheet__meta">
            {restaurant.category} · {restaurant.address}
          </p>
        </div>
        <button
          type="button"
          className={`favorite-star restaurant-sheet__icon-btn${favored ? ' favorite-star--on' : ''}`}
          onClick={() => onToggleFavorite({ name: restaurant.name, address: restaurant.address })}
          aria-label={favored ? '찜 해제' : '찜하기'}
          aria-pressed={favored}
        >
          <svg
            aria-hidden="true"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill={favored ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={STAR_SHAPE} />
          </svg>
        </button>
        <button type="button" className="restaurant-sheet__icon-btn" onClick={onClose} aria-label="닫기">
          <CloseIcon />
        </button>
      </div>

      <div className="restaurant-sheet__scroll" ref={scrollRef}>
        <div className="restaurant-sheet__summary">
          {restaurant.reviews.length > 0 ? (
            <span className="restaurant-sheet__rating">
              <span className="restaurant-sheet__rating-value">
                이웃 평균{' '}
                <svg className="restaurant-sheet__rating-star" aria-hidden="true" viewBox="0 0 24 24" width="14" height="14">
                  <path d={STAR_SHAPE} />
                </svg>
                {avgRating.toFixed(1)} · 후기 {restaurant.reviews.length}
              </span>
            </span>
          ) : (
            <p className="restaurant-sheet__rating-value restaurant-sheet__rating-value--empty">아직 평가한 이웃이 없어요</p>
          )}
          {myGroups.length > 0 && (
            <span className="restaurant-sheet__groups" role="img" aria-label={myGroups.map((g) => g.label).join(', ')}>
              {myGroups.map((g) => (
                <span
                  key={g.id}
                  className="restaurant-sheet__group-dot"
                  title={g.label}
                  style={{ ['--group-color' as string]: g.color }}
                />
              ))}
            </span>
          )}
        </div>

        <section className="restaurant-sheet__section">
          <h3 className="restaurant-sheet__section-title">이웃들의 후기</h3>
          {restaurant.reviews.length === 0 ? (
            <p className="restaurant-sheet__empty">아직 이웃 후기가 없어요. 첫 후기를 남겨보세요!</p>
          ) : (
            <>
              <div className="restaurant-sheet__reviews" onScroll={onSlide}>
                {restaurant.reviews.map((review) => (
                  <div key={review.id} className="restaurant-sheet__review-block">
                    <ReviewCard review={review} onEdit={editHandler(review)} />
                  </div>
                ))}
              </div>
              {restaurant.reviews.length > 1 && (
                <div className="restaurant-sheet__dots" aria-hidden="true">
                  {restaurant.reviews.map((review, i) => (
                    <span key={review.id} className={`restaurant-sheet__dot${i === slide ? ' restaurant-sheet__dot--on' : ''}`} />
                  ))}
                </div>
              )}
              {/* 지금 보이는 후기의 댓글. key로 후기가 바뀌면 펼침·입력 상태를 비운다 */}
              {activeReview && (
                <div
                  className="restaurant-sheet__thread"
                  style={{ ['--thread-for' as string]: JSON.stringify(`${activeReview.author.name} 후기 ·`) }}
                >
                  <ReviewComments
                    key={activeReview.id}
                    comments={comments[activeReview.id] ?? []}
                    myUserId={myUserId}
                    onAdd={(text, parentId) => onAddComment(activeReview.id, text, parentId)}
                    onDelete={(commentId) => onDeleteComment(activeReview.id, commentId)}
                  />
                </div>
              )}
            </>
          )}
        </section>

        {ownerReviews.length > 0 && (
          <section className="restaurant-sheet__section">
            <h3 className="restaurant-sheet__section-title">주인장의 후기</h3>
            {/* 주인장 후기엔 댓글을 달지 않는다 */}
            <div className="restaurant-sheet__reviews restaurant-sheet__reviews--stack">
              {ownerReviews.map((review) => (
                <ReviewCard key={review.id} review={review} onEdit={editHandler(review)} />
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="restaurant-sheet__footer restaurant-sheet__footer--split">
        <button
          type="button"
          className={`restaurant-sheet__poll${inPoll ? ' restaurant-sheet__poll--on' : ''}`}
          onClick={() => onTogglePoll({ name: restaurant.name, category: restaurant.category, address: restaurant.address })}
          aria-pressed={inPoll}
        >
          <BallotIcon size={20} />
          {inPoll ? '담았어요' : '투표 담기'}
        </button>
        <button
          type="button"
          className="restaurant-sheet__cta"
          onClick={() => (editing || !myReview ? openWrite() : startEdit(myReview))}
        >
          <PencilIcon />
          {ctaLabel}
        </button>
      </div>
    </>
  )
}

interface StarPickerProps {
  value: number
  onChange: (value: number) => void
  labelledBy: string
}

// 큰 별 다섯 개로 고르는 별점 (0.1 ~ 5.0, 0.1 단위).
// 별을 톡 누르면 그 별까지 정수 점수, 별 위를 좌우로 끌면 0.1 단위로 세밀하게, 키보드는 화살표 ±0.1.
function StarPicker({ value, onChange, labelledBy }: StarPickerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; moved: boolean } | null>(null)

  const clamp = (v: number) => Math.min(5, Math.max(0.1, Math.round(v * 10) / 10))

  function ratioAt(clientX: number) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = { x: e.clientX, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 6) return
    drag.moved = true
    onChange(clamp(Math.ceil(ratioAt(e.clientX) * 50) / 10))
  }

  function onUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.moved) return
    // 톡 누름: 누른 별까지 정수 점수
    onChange(Math.min(5, Math.floor(ratioAt(e.clientX) * 5) + 1))
  }

  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const step: Record<string, number> = { ArrowRight: 0.1, ArrowUp: 0.1, ArrowLeft: -0.1, ArrowDown: -0.1, PageUp: 1, PageDown: -1 }
    if (e.key in step) onChange(clamp(value + step[e.key]))
    else if (e.key === 'Home') onChange(0.1)
    else if (e.key === 'End') onChange(5)
    else return
    e.preventDefault()
  }

  return (
    <div
      ref={ref}
      className="star-picker"
      role="slider"
      tabIndex={0}
      aria-labelledby={labelledBy}
      aria-valuemin={0.1}
      aria-valuemax={5}
      aria-valuenow={value}
      aria-valuetext={`${value.toFixed(1)}점, ${ratingWord(value)}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => (dragRef.current = null)}
      onKeyDown={onKey}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="star-picker__star"
          style={{ ['--f' as string]: Math.min(Math.max(value - i, 0), 1) }}
        >
          <svg className="star-picker__base" aria-hidden="true" viewBox="0 0 24 24">
            <path d={STAR_SHAPE} />
          </svg>
          <svg className="star-picker__fill" aria-hidden="true" viewBox="0 0 24 24">
            <path d={STAR_SHAPE} />
          </svg>
        </span>
      ))}
    </div>
  )
}
