import { Capacitor } from '@capacitor/core'
import type { Review } from '../data/model'

export interface RestaurantRecord {
  id: number
  name: string
  category: string
  roadAddress: string
  address: string
  lat: number
  lng: number
}

// 서버 격자 요약 셀 — 낮은 줌에서 개별 가게 대신 받는다 (폐업 가게는 건수에 없다)
export interface ClusterCell {
  lat: number
  lng: number
  count: number
}

// 이 줌 이하에서는 개별 가게 대신 /summary 셀을 받아 그린다.
// 밀집 지역에서 개별 마커 200개+가 깔리면 모바일 WebView가 pan마다 화면 전체를 다시 그리며 깜빡인다.
// 서울 전역(11만 건) 유입 후 줌 16도 강남 같은 곳은 수천 행이라 16까지 셀로 둔다.
export const SUMMARY_MAX_ZOOM = 16

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

export interface BBox {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

// 가게 좌표를 고친 뒤 폰에 남은 예전 응답(HTTP 캐시)을 안 쓰게 URL에 붙이는 판 번호.
// 좌표를 다시 크게 고치면 올린다.
const COORDS_VERSION = '2'

export async function fetchRestaurants(bbox?: BBox): Promise<RestaurantRecord[]> {
  const params = bbox
    ? `?${new URLSearchParams([...Object.entries(bbox).map(([k, v]) => [k, String(v)]), ['v', COORDS_VERSION]])}`
    : ''
  const res = await fetch(`${API_BASE}/api/restaurants${params}`)
  if (!res.ok) throw new Error(`음식점 목록 조회 실패 (${res.status})`)
  return res.json()
}

// 이름으로 서버 검색 (상한 50건). 아직 뷰포트로 안 받은 영역의 가게도 검색에 걸리게.
export async function searchRestaurants(q: string): Promise<RestaurantRecord[]> {
  const res = await fetch(`${API_BASE}/api/restaurants?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`음식점 검색 실패 (${res.status})`)
  return res.json()
}

export interface AuthSession {
  // 서버 사용자 id. 내가 쓴 후기 판별용 (예전에 저장된 세션엔 없을 수 있다 — /api/auth/me가 채워준다)
  id?: number
  token: string
  // 카카오 가입은 이메일이 없을 수 있다
  email: string | null
  nickname: string
  // 프로필 사진 API 경로(?v= 포함). 없으면 null. 예전 세션엔 없을 수 있다
  avatar?: string | null
}

const SESSION_KEY = 'intermap.session'

// 저장된 세션의 토큰을 Authorization 헤더로. 로그인 안 했으면 빈 객체
function authHeaders(): Record<string, string> {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as AuthSession | null
    return session?.token ? { Authorization: `Bearer ${session.token}` } : {}
  } catch {
    return {}
  }
}

// 서버가 세션을 인정하는지 확인. 만료·로그아웃이면 401 → null
export async function fetchMe(): Promise<AuthSession | null> {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`세션 확인 실패 (${res.status})`)
  return res.json()
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', headers: authHeaders() }).catch(() => {
    // 서버에 못 닿아도 클라이언트 세션은 지운다
  })
}

async function post<T>(path: string, body: BodyInit, headers: Record<string, string> = {}, method = 'POST'): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method, headers: { ...headers, ...authHeaders() }, body })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message ?? `요청 실패 (${res.status})`)
  return data
}

function postJson<T>(path: string, body: object): Promise<T> {
  return post<T>(path, JSON.stringify(body), { 'Content-Type': 'application/json' })
}

export interface SignupParams {
  email: string
  emailCode: string
  nickname: string
  password: string
  termsAgreed: boolean
  marketingAgreed: boolean
}

// 이메일 인증번호 → 약관 → 닉네임+비밀번호까지 마친 뒤 호출
export function signup(params: SignupParams): Promise<AuthSession> {
  return postJson<AuthSession>('/api/auth/signup', params)
}

// 이메일로 기존 회원인지, 소셜로만 가입한 계정(provider 있음, 비밀번호 없음)인지 알아낸다
export function lookupEmail(email: string): Promise<{ exists: boolean; hasPassword: boolean; provider: OAuthProvider | null }> {
  return postJson('/api/auth/lookup', { email })
}

// 이메일 가입 계정과 관리자(admin)
export function login(email: string, password: string): Promise<AuthSession> {
  return postJson<AuthSession>('/api/auth/login', { email, password })
}

// 비밀번호를 잊었을 때 이메일 인증번호로 로그인. newPassword를 주면 비밀번호도 그걸로 바뀐다.
export function loginWithCode(email: string, emailCode: string, newPassword?: string): Promise<AuthSession> {
  return postJson<AuthSession>('/api/auth/login-code', { email, emailCode, newPassword })
}

export type OAuthProvider = 'google' | 'naver' | 'kakao'

// 전체 페이지 이동으로 provider 로그인 화면을 연다. 완료되면 서버가 일회용 코드만 ?oauth= 로 달아
// 돌려보내고(앱은 intermap://auth?oauth=), 프론트가 exchangeOAuth로 결과를 받는다.
// 실패 시 ?authError=<코드> (oauthErrorMessage 참고).
export interface SocialTicket {
  ticket: string
  provider: OAuthProvider
  email?: string
  nickname?: string
}

// 티켓의 이메일로 받은 인증번호가 맞으면 그 계정에 소셜 계정이 연결되고 로그인된다
export function linkSocial(ticket: string, emailCode: string): Promise<AuthSession> {
  return postJson<AuthSession>('/api/auth/link-social', { linkTicket: ticket, emailCode })
}

export function signupSocial(ticket: string, nickname: string, marketingAgreed: boolean): Promise<AuthSession> {
  return postJson<AuthSession>('/api/auth/signup-social', { ticket, nickname, termsAgreed: true, marketingAgreed })
}

// 소셜 로그인을 시작한 이 기기만 결과를 받도록 묶는 난수. 시작할 때 서버에 넘기고, 결과를 받을 때 다시 보낸다.
// 남이 보낸 콜백 링크·가로챈 딥링크로는 이 값이 없어 로그인되지 않는다.
const OAUTH_VERIFIER_KEY = 'intermap.oauthVerifier'

export function oauthUrl(provider: OAuthProvider): string {
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
  try {
    localStorage.setItem(OAUTH_VERIFIER_KEY, verifier)
  } catch {
    // 저장 못 하면 결과 교환에서 실패한다 — 다시 시도하면 된다
  }
  // 앱(WebView)에서는 app=1을 붙인다 — 백엔드가 콜백을 intermap:// 딥링크로 돌려보내
  // 로그인 후 브라우저가 아니라 앱으로 돌아온다
  const app = Capacitor.isNativePlatform() ? '&app=1' : ''
  return `${API_BASE}/api/auth/oauth/${provider}?verifier=${verifier}${app}`
}

// type: session = 연결된 회원 로그인, link = 같은 이메일 계정과 연결, signup = 닉네임+약관 가입
export interface OAuthResult {
  type: 'session' | 'link' | 'signup'
  session: AuthSession | null
  ticket: string | null
  provider: OAuthProvider | null
  email: string | null
  nickname: string | null
}

export async function exchangeOAuth(code: string): Promise<OAuthResult> {
  let verifier = ''
  try {
    verifier = localStorage.getItem(OAUTH_VERIFIER_KEY) ?? ''
    localStorage.removeItem(OAUTH_VERIFIER_KEY)
  } catch {
    // 아래 요청이 실패로 돌아온다
  }
  return postJson<OAuthResult>('/api/auth/oauth/result', { code, verifier })
}

// 서버가 ?authError= 로 보내는 코드. 문구는 여기서만 정한다 (링크에 임의 문구를 실어 띄우지 못하게)
const OAUTH_ERRORS: Record<string, string> = {
  unavailable: '해당 간편 로그인은 아직 연결되지 않았어요.',
  cancelled: '로그인이 취소됐어요.',
  expired: '로그인 요청이 만료됐어요. 다시 시도해주세요.',
  failed: '로그인 중 문제가 생겼어요. 다시 시도해주세요.',
}

export function oauthErrorMessage(code: string): string {
  return OAUTH_ERRORS[code] ?? OAUTH_ERRORS.failed
}

// 성공 메시지를 반환하고, 형식 오류·발송 제한은 Error로 던진다
export async function requestEmailCode(email: string): Promise<string> {
  return (await postJson<{ message: string }>('/api/auth/email-code', { email })).message
}

// 인증번호 확인. 맞으면 서버가 30분간 기억한다 — 가입 요청에도 같은 번호를 다시 실어 보낸다.
export async function verifyEmailCode(email: string, emailCode: string): Promise<string> {
  return (await postJson<{ message: string }>('/api/auth/verify-email-code', { email, emailCode })).message
}

export async function checkNickname(nickname: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/auth/check-nickname?value=${encodeURIComponent(nickname)}`)
  if (!res.ok) throw new Error(`닉네임 확인 실패 (${res.status})`)
  return (await res.json()).available
}

// 관리자(주인장) 계정. 서버 AdminSeeder.ADMIN_EMAIL과 같은 값
export const ADMIN_EMAIL = 'admin'

export function isAdmin(session: AuthSession | null): boolean {
  return session?.email === ADMIN_EMAIL
}

// 후기와 가게를 잇는 키 "이름|주소" (App.mergeRecords와 같은 규칙)
export function restaurantKey(r: { name: string; address: string }): string {
  return `${r.name}|${r.address}`
}

// 내가 볼 수 있는 후기 전체. 초기 규모라 한 번에 받는다 (서버 ReviewController·ReviewAudience 참고)
// 토큰이 없으면 주인장 후기만, 있으면 나·팔로우한 사람·주인장 후기에서 차단·신고한 것을 빼고 준다
export async function fetchReviews(): Promise<Review[]> {
  const res = await fetch(`${API_BASE}/api/reviews`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`후기 조회 실패 (${res.status})`)
  return res.json()
}

// 로그인 필요. 401이면 서버 메시지가 Error로 온다.
// multipart — "review" JSON 파트 + "photos" 파일 파트들 (서버 ReviewController.create)
export function postReview(
  restaurant: Review['restaurant'],
  rating: number,
  text: string,
  menu: string,
  photos: Blob[] = [],
): Promise<Review> {
  const form = new FormData()
  form.append('review', new Blob([JSON.stringify({ restaurant, rating, text, menu })], { type: 'application/json' }))
  photos.forEach((photo, i) => form.append('photos', photo, `photo-${i}.jpg`))
  return post<Review>('/api/reviews', form)
}

// 내 후기 수정. keepPhotoIds에 없는 기존 사진은 지워지고 photos는 새로 붙는다 (서버 ReviewController.update)
export function updateReview(
  id: number,
  rating: number,
  text: string,
  menu: string,
  keepPhotoIds: number[],
  photos: Blob[] = [],
): Promise<Review> {
  const form = new FormData()
  form.append('review', new Blob([JSON.stringify({ rating, text, menu, keepPhotoIds })], { type: 'application/json' }))
  photos.forEach((photo, i) => form.append('photos', photo, `photo-${i}.jpg`))
  return post<Review>(`/api/reviews/${id}`, form, {}, 'PUT')
}

// ---- 마이페이지: 팔로우(단방향)와 나만 보이는 이름 (서버 SocialController) ----

export interface Person {
  id: number
  nickname: string
  // 내가 붙인 이름. 없으면 null
  alias: string | null
  // 내가 이 사람을 팔로우 중 / 이 사람이 나를 팔로우 중
  following: boolean
  followsMe: boolean
  avatar: string | null
  // 내가 보낸 팔로우 요청이 수락을 기다리는 중 (상대가 수동 승인일 때). 예전에 저장해 둔 목록에는 없을 수 있다
  requested?: boolean
}

export interface SocialData {
  following: Person[]
  followers: Person[]
  // 나에게 온 팔로우 요청 / 내가 보내고 기다리는 요청. 예전에 저장해 둔 목록에는 없을 수 있다
  requests?: Person[]
  requested?: Person[]
  // 내 팔로우 승인 방식 — true면 요청을 직접 수락해야 팔로우가 맺어진다
  manualApproval?: boolean
}

export interface UserItem {
  id: number
  nickname: string
}

// 다른 사람 프로필 개요. 후기·별점은 프론트가 이미 받은 목록으로 그리므로
// 서버는 사진·관계·팔로잉/팔로워 수만 준다. 팔로우 전이면 두 수는 -1(가림).
export interface UserProfile {
  id: number
  nickname: string
  alias: string | null
  avatar: string | null
  following: boolean
  followsMe: boolean
  followingCount: number
  followerCount: number
  // 내가 이 사람을 차단했는지
  blocked: boolean
  // 팔로우 전에도 보이는 후기 수 (주인장은 0)
  reviewCount: number
  // 내가 보낸 팔로우 요청이 수락 대기 중 / 이 사람은 팔로우를 직접 수락한다
  requested?: boolean
  manualApproval?: boolean
}

export async function fetchUserProfile(userId: number): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/api/users/${userId}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`프로필 조회 실패 (${res.status})`)
  return res.json()
}

// 다른 사람의 팔로잉·팔로워 목록 (별칭·관계는 내 기준). 내가 팔로우 중인 사람만 — 아니면 403
export async function fetchUserSocial(userId: number): Promise<SocialData> {
  const res = await fetch(`${API_BASE}/api/users/${userId}/social`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`팔로우 목록 조회 실패 (${res.status})`)
  return res.json()
}

export async function fetchSocial(): Promise<SocialData> {
  const res = await fetch(`${API_BASE}/api/me/social`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`팔로우 목록 조회 실패 (${res.status})`)
  return res.json()
}

export function followUser(userId: number): Promise<SocialData> {
  return post<SocialData>(`/api/me/follows/${userId}`, '')
}

export function unfollowUser(userId: number): Promise<SocialData> {
  return post<SocialData>(`/api/me/follows/${userId}`, '', {}, 'DELETE')
}

// 나에게 온 팔로우 요청 수락 / 거절
export function acceptFollowRequest(userId: number): Promise<SocialData> {
  return post<SocialData>(`/api/me/follow-requests/${userId}`, '')
}

export function rejectFollowRequest(userId: number): Promise<SocialData> {
  return post<SocialData>(`/api/me/follow-requests/${userId}`, '', {}, 'DELETE')
}

// 팔로우 승인 방식 — manual이면 요청을 직접 수락, 아니면 누르는 즉시 팔로우. 자동으로 돌리면 기다리던 요청은 모두 수락된다
export function setFollowApproval(manual: boolean): Promise<SocialData> {
  return post<SocialData>('/api/me/follow-approval', JSON.stringify({ manual }), { 'Content-Type': 'application/json' }, 'PUT')
}

// ---- 알림 (서버 NotificationController) ----

export type NoticeType = 'COMMENT' | 'REPLY' | 'FOLLOW_REQUEST' | 'FOLLOW' | 'FOLLOW_ACCEPTED'

export interface Notice {
  type: NoticeType
  actor: { id: number; nickname: string; avatar: string | null }
  createdAt: string
  // 댓글·답글일 때만
  reviewId: number | null
  restaurantName: string | null
  text: string | null
}

export interface NoticeData {
  items: Notice[]
  // 마지막으로 알림을 연 뒤에 생긴 수
  unread: number
}

export async function fetchNotices(): Promise<NoticeData> {
  const res = await fetch(`${API_BASE}/api/me/notifications`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`알림 조회 실패 (${res.status})`)
  return res.json()
}

// 알림 목록을 열었다 — 지금까지의 알림을 읽은 것으로
export function markNoticesSeen(): Promise<NoticeData> {
  return post<NoticeData>('/api/me/notifications/seen', '')
}

// 빈 문자열이면 별칭 삭제
export function setAlias(userId: number, alias: string): Promise<SocialData> {
  return post<SocialData>(`/api/me/aliases/${userId}`, JSON.stringify({ alias }), { 'Content-Type': 'application/json' }, 'PUT')
}

// 닉네임 부분 일치 상위 20, 본인 제외. 로그인 필요
export async function searchUsers(q: string): Promise<UserItem[]> {
  const res = await fetch(`${API_BASE}/api/users?q=${encodeURIComponent(q)}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`사용자 검색 실패 (${res.status})`)
  return res.json()
}

// 바뀐 닉네임이 실린 새 세션을 돌려준다
export function changeNickname(nickname: string): Promise<AuthSession> {
  return post<AuthSession>('/api/auth/nickname', JSON.stringify({ nickname }), { 'Content-Type': 'application/json' }, 'PUT')
}

// 내 후기 삭제 (사진 포함). 서버가 본인 확인.
export async function deleteReview(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/reviews/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? `후기 삭제 실패 (${res.status})`)
  }
}

// 후기 댓글 (서버 ReviewCommentController.Item)
export interface CommentRecord {
  id: number
  reviewId: number
  parentId: number | null
  author: { id: number; name: string; owner: boolean; avatar: string | null }
  text: string
  createdAt: string
}

// 전체 댓글 (오래된 순). 후기 목록처럼 통으로 받고 프론트가 후기별로 나눈다.
export async function fetchComments(): Promise<CommentRecord[]> {
  const res = await fetch(`${API_BASE}/api/comments`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`댓글 조회 실패 (${res.status})`)
  return res.json()
}

// 로그인 필요. parentId가 있으면 그 댓글의 대댓글로 달린다.
export function postComment(reviewId: number, text: string, parentId?: number): Promise<CommentRecord> {
  return postJson<CommentRecord>('/api/comments', { reviewId, text, parentId })
}

// 내 댓글 삭제. 원댓글이면 서버가 답글까지 지운다.
export async function deleteComment(id: number): Promise<void> {
  const res = await fetch(`${API_BASE}/api/comments/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? `댓글 삭제 실패 (${res.status})`)
  }
}

// ---- 가게 찜 (서버 FavoriteController) ----

export interface FavoritePlace {
  name: string
  address: string
}

export async function fetchFavorites(): Promise<FavoritePlace[]> {
  const res = await fetch(`${API_BASE}/api/me/favorites`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`찜 목록 조회 실패 (${res.status})`)
  return res.json()
}

// 있으면 해제, 없으면 추가. 결과 상태(favored)를 돌려준다.
export function toggleFavorite(name: string, address: string): Promise<{ favored: boolean }> {
  return postJson<{ favored: boolean }>('/api/me/favorites/toggle', { name, address })
}

// path = 서버가 후기 응답에 실어 준 사진 경로 (/api/photos/{id}/{키}). 볼 수 있는 후기에만 키가 온다.
export function photoUrl(path: string): string {
  return `${API_BASE}${path}`
}

// 서버가 준 프로필 사진 경로(/api/users/{id}/avatar?v=...)를 실제 URL로
export function avatarUrl(path: string): string {
  return `${API_BASE}${path}`
}

// 프로필 사진 올리기 (있던 건 덮어씀). 새 경로를 돌려준다 (서버 AvatarController)
export async function uploadAvatar(photo: Blob): Promise<string> {
  const form = new FormData()
  form.append('photo', photo, 'avatar.jpg')
  const data = await post<{ avatar: string }>('/api/me/avatar', form, {}, 'PUT')
  return data.avatar
}

export async function deleteAvatar(): Promise<void> {
  await post<{ avatar: null }>('/api/me/avatar', '', {}, 'DELETE')
}

export async function fetchRestaurantCells(bbox: BBox, zoom: number): Promise<ClusterCell[]> {
  const params = new URLSearchParams(Object.entries({ ...bbox, zoom, v: COORDS_VERSION }).map(([k, v]) => [k, String(v)]))
  const res = await fetch(`${API_BASE}/api/restaurants/summary?${params}`)
  if (!res.ok) throw new Error(`음식점 요약 조회 실패 (${res.status})`)
  return res.json()
}

// ---- 회원 탈퇴 · 신고 · 차단 (서버 AccountController, ModerationController) ----

// 계정과 내가 남긴 후기·사진·댓글·찜·팔로우를 즉시 지운다. 되돌릴 수 없다.
export async function deleteAccount(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/me`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? `탈퇴 실패 (${res.status})`)
  }
}

export type ReportTargetType = 'REVIEW' | 'COMMENT'
export type ReportReason = 'SPAM' | 'ABUSE' | 'SEXUAL' | 'PRIVACY' | 'FALSE_INFO' | 'OTHER'

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'SPAM', label: '스팸·광고' },
  { value: 'ABUSE', label: '욕설·비방·혐오' },
  { value: 'SEXUAL', label: '음란하거나 불쾌한 내용' },
  { value: 'PRIVACY', label: '개인정보 노출' },
  { value: 'FALSE_INFO', label: '허위 정보' },
  { value: 'OTHER', label: '기타' },
]

// 성공하면 서버 안내 문구. 신고한 글은 다음 목록부터 나에게 안 보인다.
export async function reportContent(targetType: ReportTargetType, targetId: number, reason: ReportReason, detail?: string): Promise<string> {
  const data = await postJson<{ message: string }>('/api/reports', { targetType, targetId, reason, detail: detail || null })
  return data.message
}

export interface BlockedPerson {
  id: number
  nickname: string
  avatar: string | null
  blockedAt: string
}

export async function fetchBlocks(): Promise<BlockedPerson[]> {
  const res = await fetch(`${API_BASE}/api/me/blocks`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`차단 목록 조회 실패 (${res.status})`)
  return res.json()
}

// 차단하면 서로의 후기·댓글이 안 보이고 팔로우가 양쪽 다 끊긴다
export function blockUser(userId: number): Promise<BlockedPerson[]> {
  return post<BlockedPerson[]>(`/api/me/blocks/${userId}`, '')
}

export function unblockUser(userId: number): Promise<BlockedPerson[]> {
  return post<BlockedPerson[]>(`/api/me/blocks/${userId}`, '', {}, 'DELETE')
}

// 운영자(주인장) 전용 신고 처리
export type ReportStatus = 'OPEN' | 'REMOVED' | 'DISMISSED' | 'GONE'

export interface AdminReport {
  id: number
  targetType: ReportTargetType
  targetId: number
  targetAuthorId: number | null
  targetAuthorName: string | null
  content: string | null
  reason: ReportReason
  detail: string | null
  reporterName: string
  status: ReportStatus
  createdAt: string
  openCount: number
  targetExists: boolean
}

export async function fetchAdminReports(status: ReportStatus = 'OPEN'): Promise<AdminReport[]> {
  const res = await fetch(`${API_BASE}/api/admin/reports?status=${status}`, { headers: authHeaders() })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message ?? `신고 목록 조회 실패 (${res.status})`)
  return data
}

// REMOVE = 글 삭제, DISMISS = 문제 없음. 같은 글에 걸린 신고가 모두 같이 닫힌다.
export function resolveReport(id: number, action: 'REMOVE' | 'DISMISS'): Promise<{ message: string }> {
  return postJson<{ message: string }>(`/api/admin/reports/${id}/resolve`, { action })
}

// ---- "어디 갈래?" 투표 (서버 PollController) ----

// 투표 후보로 담은 가게 (가게 키 = 이름|주소)
export interface PollCandidate {
  name: string
  category: string
  address: string
  // 만든 사람의 한마디 (선택, 60자)
  note?: string
}

export interface PollOptionView {
  id: number
  name: string
  category: string | null
  address: string
  note: string | null
  votes: number
  // 이 후보를 고른 사람 이름 (먼저 고른 순)
  voters: string[]
  // 회원에게만: 내가 볼 수 있는 후기(나·팔로우한 사람)의 평균 별점과 개수. 비회원·후기 없음이면 null·0
  rating: number | null
  reviewCount: number
}

export interface PollView {
  token: string
  title: string
  creator: { id: number; name: string }
  createdAt: string
  closesAt: string
  closed: boolean
  // 내가 만든 투표 — 마감·삭제 버튼
  mine: boolean
  options: PollOptionView[]
  myChoices: number[]
  myName: string | null
  voterCount: number
  // 마감 뒤 가장 많이 골린 후보들 (동점이면 여럿)
  winnerIds: number[]
}

export interface PollSummary {
  token: string
  title: string
  createdAt: string
  closesAt: string
  closed: boolean
  mine: boolean
  voterCount: number
  leader: string | null
}

export const POLL_MIN_OPTIONS = 2
export const POLL_MAX_OPTIONS = 6

// 비회원 투표자를 알아보는 이 브라우저의 난수. 서버엔 해시만 남는다 (PollController.voterKeyOf)
const VOTER_KEY = 'intermap.voter'
const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
// 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)는 이번 화면 동안만 같은 사람으로 본다
let memoryVoterKey: string | null = null
export function guestVoterKey(): string {
  try {
    const saved = localStorage.getItem(VOTER_KEY)
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved
    const fresh = randomHex()
    localStorage.setItem(VOTER_KEY, fresh)
    return fresh
  } catch {
    return (memoryVoterKey ??= randomHex())
  }
}

// 친구에게 보낼 투표 링크. 앱(WebView)의 주소는 가짜 호스트라 웹 주소를 따로 쓴다
// 빌드 변수 VITE_WEB_BASE_URL(GitHub 저장소 변수)로 바꿀 수 있다. 웹에서는 지금 열린 사이트 주소를 쓴다
const WEB_BASE_URL: string =
  import.meta.env.VITE_WEB_BASE_URL ||
  (Capacitor.isNativePlatform() ? 'https://dist-flame-two-40.vercel.app' : window.location.origin)

export function pollLink(token: string): string {
  return `${WEB_BASE_URL.replace(/\/$/, '')}/?poll=${encodeURIComponent(token)}`
}

export function createPoll(title: string, hours: number, options: PollCandidate[]): Promise<PollView> {
  return postJson<PollView>('/api/polls', { title, hours, options })
}

export async function fetchPoll(token: string): Promise<PollView> {
  const res = await fetch(`${API_BASE}/api/polls/${encodeURIComponent(token)}?voter=${guestVoterKey()}`, { headers: authHeaders() })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message ?? `투표를 불러오지 못했어요 (${res.status})`)
  return data
}

// 로그인했으면 계정으로, 아니면 이 브라우저 난수 + 적은 이름으로. optionIds가 비면 내 선택을 지운다
export function votePoll(token: string, optionIds: number[], name?: string): Promise<PollView> {
  return postJson<PollView>(`/api/polls/${encodeURIComponent(token)}/votes`, { voterKey: guestVoterKey(), name, optionIds })
}

export function closePoll(token: string): Promise<PollView> {
  return post<PollView>(`/api/polls/${encodeURIComponent(token)}/close`, '')
}

export async function deletePoll(token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/polls/${encodeURIComponent(token)}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? `투표 삭제 실패 (${res.status})`)
  }
}

export async function fetchMyPolls(): Promise<PollSummary[]> {
  const res = await fetch(`${API_BASE}/api/me/polls`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`투표 목록 조회 실패 (${res.status})`)
  return res.json()
}

// ---- 월간 결산 (서버 RecapController) ----

export interface RecapPlace {
  name: string
  category: string | null
  rating: number
}

export interface Recap {
  month: string // "2026-11"
  places: number
  photos: number
  avgRating: number | null
  topCategory: { name: string; count: number } | null
  topArea: { name: string; count: number } | null
  best: RecapPlace | null
  commentsReceived: number
  topFan: { id: number; name: string; count: number } | null
  newFollowing: number
  list: RecapPlace[]
  // 후기가 있는 달 (최근 달부터)
  months: string[]
  // 내 후기에 댓글 단 사람 (많이 단 순, 최대 3명)과 전체 인원 — 카드 앞면의 친구 동그라미
  fans: { id: number; name: string; count: number }[]
  fanTotal: number
  // 많이 간 장르·동네 Top 3
  categories: { name: string; count: number }[]
  areas: { name: string; count: number }[]
}

export async function fetchRecap(month?: string): Promise<Recap> {
  const res = await fetch(`${API_BASE}/api/me/recap${month ? `?month=${month}` : ''}`, { headers: authHeaders() })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message ?? `결산을 불러오지 못했어요 (${res.status})`)
  return data
}
