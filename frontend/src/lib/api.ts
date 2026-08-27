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
  statusCheckedAt: string | null
}

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

export async function registerRestaurant(place: PlaceSearchResult): Promise<RestaurantRecord> {
  const res = await fetch(`${API_BASE}/api/restaurants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(place),
  })
  if (!res.ok) throw new Error(`음식점 등록 실패 (${res.status})`)
  return res.json()
}
