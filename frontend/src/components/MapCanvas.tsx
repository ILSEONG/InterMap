import { useEffect, useRef, useState } from 'react'
import type { Restaurant, FriendGroup } from '../data/mock'
import { loadNaverMaps } from '../lib/loadNaverMaps'
import './MapCanvas.css'

interface MapCanvasProps {
  restaurants: Restaurant[]
  groups: FriendGroup[]
  onPick: (restaurant: Restaurant) => void
  selectedId?: string
}

const CENTER = { lat: 37.5605, lng: 126.92 }

function topGroupColor(restaurant: Restaurant, groups: FriendGroup[]): string {
  const active = groups.filter((g) => restaurant.groupIds.includes(g.id))
  const sorted = [...active].sort((a, b) => a.priority - b.priority)
  return sorted[0]?.color ?? '#8B6BFF'
}

function pinIcon(restaurant: Restaurant, groups: FriendGroup[], selected: boolean) {
  const color = restaurant.closed ? '#9b93ab' : topGroupColor(restaurant, groups)
  const label = restaurant.closed ? `${restaurant.name} (폐업)` : restaurant.name
  return {
    content: `
      <button type="button" class="map-pin${selected ? ' map-pin--selected' : ''}" aria-label="${label}">
        <span class="map-pin__dot" style="--pin-color:${color}"></span>
        <span class="map-pin__label">${label}</span>
      </button>
    `,
    anchor: new window.naver.maps.Point(8, 16),
  }
}

export default function MapCanvas({ restaurants, groups, onPick, selectedId }: MapCanvasProps) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<naver.maps.Map | null>(null)
  const markersRef = useRef<Map<string, naver.maps.Marker>>(new Map())
  const selectedRef = useRef<string | undefined>(undefined)
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadNaverMaps()
      .then((naver) => {
        if (cancelled || !mapDivRef.current) return
        mapRef.current = new naver.maps.Map(mapDivRef.current, {
          center: new naver.maps.LatLng(CENTER.lat, CENTER.lng),
          zoom: 15,
          minZoom: 12,
          scaleControl: false,
          mapDataControl: false,
        })
        setMapReady(true)
      })
      .catch((err: Error) => !cancelled && setMapError(err.message))
    return () => {
      cancelled = true
    }
  }, [])

  // 목록이 바뀔 때 마커를 전부 다시 만들면 검색어 한 글자마다 지도가 끊긴다.
  // 사라진 것만 지우고 새로 생긴 것만 만든다.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.naver) return
    const naver = window.naver
    const markers = markersRef.current
    const visibleIds = new Set(restaurants.map((r) => r.id))

    markers.forEach((marker, id) => {
      if (!visibleIds.has(id)) {
        marker.setMap(null)
        markers.delete(id)
      }
    })

    restaurants.forEach((restaurant) => {
      if (markers.has(restaurant.id)) return
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(restaurant.lat, restaurant.lng),
        map: mapRef.current!,
        icon: pinIcon(restaurant, groups, restaurant.id === selectedRef.current),
      })
      naver.maps.Event.addListener(marker, 'click', () => onPick(restaurant))
      markers.set(restaurant.id, marker)
    })
  }, [restaurants, groups, mapReady, onPick])

  // 선택 표시는 바뀐 핀 두 개(이전/현재)만 다시 그린다.
  useEffect(() => {
    if (!mapReady || !window.naver) return
    const previous = selectedRef.current
    selectedRef.current = selectedId
    if (previous === selectedId) return

    for (const id of [previous, selectedId]) {
      const marker = id ? markersRef.current.get(id) : undefined
      const restaurant = restaurants.find((r) => r.id === id)
      if (marker && restaurant) marker.setIcon(pinIcon(restaurant, groups, id === selectedId))
    }
  }, [selectedId, restaurants, groups, mapReady])

  // 검색 결과에서 고른 가게가 화면 밖일 수 있어 선택된 핀으로 지도를 옮긴다.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.naver || !selectedId) return
    const target = restaurants.find((r) => r.id === selectedId)
    if (!target) return
    mapRef.current.panTo(new window.naver.maps.LatLng(target.lat, target.lng))
    // 선택이 바뀔 때만 이동한다 (후기 등록 등으로 목록이 갱신될 때는 그대로).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, mapReady])

  return (
    <div className="map-canvas">
      <div ref={mapDivRef} className="map-canvas__surface" />
      {mapError && (
        <div className="map-canvas__error">
          네이버 지도를 불러오지 못했어요.
          <br />
          {mapError}
        </div>
      )}
    </div>
  )
}
