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

export default function MapCanvas({ restaurants, groups, onPick, selectedId }: MapCanvasProps) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<naver.maps.Map | null>(null)
  const markersRef = useRef<Map<string, naver.maps.Marker>>(new Map())
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

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.naver) return
    const naver = window.naver

    markersRef.current.forEach((marker) => marker.setMap(null))
    markersRef.current.clear()

    restaurants.forEach((restaurant) => {
      const color = restaurant.closed ? '#9b93ab' : topGroupColor(restaurant, groups)
      const isSelected = restaurant.id === selectedId
      const label = restaurant.closed ? `${restaurant.name} (폐업)` : restaurant.name
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(restaurant.lat, restaurant.lng),
        map: mapRef.current!,
        icon: {
          content: `
            <button type="button" class="map-pin${isSelected ? ' map-pin--selected' : ''}" aria-label="${label}">
              <span class="map-pin__dot" style="--pin-color:${color}"></span>
              <span class="map-pin__label">${label}</span>
            </button>
          `,
          anchor: new naver.maps.Point(8, 16),
        },
      })
      naver.maps.Event.addListener(marker, 'click', () => onPick(restaurant))
      markersRef.current.set(restaurant.id, marker)
    })
  }, [restaurants, groups, selectedId, mapReady, onPick])

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
