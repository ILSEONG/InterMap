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
  status: 'OPEN' | 'CLOSED'
}

// 서버 격자 요약 셀 — 낮은 줌에서 개별 가게 대신 받는다
export interface ClusterCell {
  lat: number
  lng: number
  count: number
}

// 이 줌 이하에서는 개별 가게 대신 /summary 셀을 받아 그린다.
// 15(기본 줌)까지 셀로 두는 이유: 밀집 지역에서 개별 마커 200개+가 깔리면
// 모바일 WebView가 pan마다 화면 전체를 다시 그리며 깜빡인다.
export const SUMMARY_MAX_ZOOM = 15

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

export interface AuthSession {
  token: string
  email: string
  nickname: string
}

async function postJson<T>(path: string, body: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.message ?? `요청 실패 (${res.status})`)
  return data
}

export interface SignupParams {
  email: string
  emailCode: string
  phone: string
  phoneCode: string
  password: string
  nickname: string
}

export function signup(params: SignupParams): Promise<AuthSession> {
  return postJson<AuthSession>('/api/auth/signup', params)
}

export function login(email: string, password: string): Promise<AuthSession> {
  return postJson<AuthSession>('/api/auth/login', { email, password })
}

export type OAuthProvider = 'google' | 'naver' | 'kakao'

// 전체 페이지 이동으로 provider 로그인 화면을 연다. 완료되면 서버가
// ?token=&email=&nickname= (또는 실패 시 ?authError=) 를 달고 프론트로 돌려보낸다.
export function oauthUrl(provider: OAuthProvider): string {
  return `${API_BASE}/api/auth/oauth/${provider}`
}

// 성공 메시지를 반환하고, 중복/형식 오류는 Error로 던진다
export async function requestEmailCode(email: string): Promise<string> {
  return (await postJson<{ message: string }>('/api/auth/email-code', { email })).message
}

export async function requestPhoneCode(phone: string): Promise<string> {
  return (await postJson<{ message: string }>('/api/auth/phone-code', { phone })).message
}

// 인증번호 확인. 맞으면 서버가 기억해두고 가입 시 다시 검사하지 않는다.
export async function verifyEmailCode(email: string, emailCode: string): Promise<string> {
  return (await postJson<{ message: string }>('/api/auth/verify-email-code', { email, emailCode })).message
}

export async function verifyPhoneCode(phone: string, phoneCode: string): Promise<string> {
  return (await postJson<{ message: string }>('/api/auth/verify-phone-code', { phone, phoneCode })).message
}

export async function checkNickname(nickname: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/auth/check-nickname?value=${encodeURIComponent(nickname)}`)
  if (!res.ok) throw new Error(`닉네임 확인 실패 (${res.status})`)
  return (await res.json()).available
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
