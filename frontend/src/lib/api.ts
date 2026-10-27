import { Capacitor } from '@capacitor/core'
import type { Review } from '../data/model'

export interface PlaceSearchResult {
  name: string
  category: string
  roadAddress: string
  address: string
  lat: number
  lng: number
}

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

export async function searchPlaces(query: string): Promise<PlaceSearchResult[]> {
  const res = await fetch(`${API_BASE}/api/places/search?query=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error(`장소 검색 실패 (${res.status})`)
  return res.json()
}

export interface BBox {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export async function fetchRestaurants(bbox?: BBox): Promise<RestaurantRecord[]> {
  const params = bbox ? `?${new URLSearchParams(Object.entries(bbox).map(([k, v]) => [k, String(v)]))}` : ''
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

// 비밀번호를 잊었을 때 이메일 인증번호로 로그인
export function loginWithCode(email: string, emailCode: string): Promise<AuthSession> {
  return postJson<AuthSession>('/api/auth/login-code', { email, emailCode })
}

export type OAuthProvider = 'google' | 'naver' | 'kakao'

// 전체 페이지 이동으로 provider 로그인 화면을 연다. 완료되면 서버가
// 연결된 회원이면 ?token=&email=&nickname=,
// 같은 이메일의 기존 계정이 있으면 ?linkTicket=&provider=&email= (인증번호로 계정 연결),
// 처음이면 ?signupTicket=&provider=&email=&nickname= (닉네임+약관만 받는 가입),
// 실패 시 ?authError= 를 달고 프론트로 돌려보낸다.
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

export function oauthUrl(provider: OAuthProvider): string {
  // 앱(WebView)에서는 ?app=1을 붙인다 — 백엔드가 콜백을 intermap:// 딥링크로 돌려보내
  // 로그인 후 브라우저가 아니라 앱으로 돌아온다
  const app = Capacitor.isNativePlatform() ? '?app=1' : ''
  return `${API_BASE}/api/auth/oauth/${provider}${app}`
}

// 성공 메시지를 반환하고, 형식 오류·발송 제한은 Error로 던진다
export async function requestEmailCode(email: string): Promise<string> {
  return (await postJson<{ message: string }>('/api/auth/email-code', { email })).message
}

// 인증번호 확인. 맞으면 서버가 기억해두고 가입 시 다시 검사하지 않는다.
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

// 후기 전체. 초기 규모라 한 번에 받는다 (서버 ReviewController 참고)
// 로그인했으면 토큰을 같이 보낸다 — 서버가 차단한 사람·내가 신고한 후기를 빼고 준다
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
}

export interface SocialData {
  following: Person[]
  followers: Person[]
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

export function photoUrl(id: number): string {
  return `${API_BASE}/api/photos/${id}`
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
  const params = new URLSearchParams(Object.entries({ ...bbox, zoom }).map(([k, v]) => [k, String(v)]))
  const res = await fetch(`${API_BASE}/api/restaurants/summary?${params}`)
  if (!res.ok) throw new Error(`음식점 요약 조회 실패 (${res.status})`)
  return res.json()
}

export async function registerRestaurant(place: PlaceSearchResult): Promise<RestaurantRecord> {
  const res = await fetch(`${API_BASE}/api/restaurants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(place),
  })
  if (!res.ok) throw new Error(`음식점 등록 실패 (${res.status})`)
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
