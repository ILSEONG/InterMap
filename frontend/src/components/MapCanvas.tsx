import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Restaurant, FriendGroup } from '../data/mock'
import { loadNaverMaps } from '../lib/loadNaverMaps'
import { clusterPins, isSeparatedAt, latAtWorldY, worldPoint } from '../lib/cluster'
import type { Pin } from '../lib/cluster'
import './MapCanvas.css'

interface MapCanvasProps {
  restaurants: Restaurant[]
  groups: FriendGroup[]
  onPick: (restaurant: Restaurant) => void
  // 지도만 이 가게로 옮긴다 (검색 결과 선택 등). 상세는 열지 않는다.
  focusId?: string
}

const CENTER = { lat: 37.5605, lng: 126.92 }
const DEFAULT_ZOOM = 15
const MAX_ZOOM = 21
// 목록에서 고른 가게로 갈 때의 확대 레벨. 최대에서 한 단계 여유를 둬서
// 사용자가 더 당겨볼 여지를 남긴다.
// 지도 이동은 확대 없이, 살짝 감속하며 미끄러지듯.
const PAN_TRANSITION = { duration: 700, easing: 'easeOutCubic' }
// 목록 한 줄 높이(대략) — 팝업이 얼마나 위로 뻗을지 어림잡는 데 쓴다.
const PIN_LIST_ROW_HEIGHT = 56
const PIN_LIST_MAX_HEIGHT = 232

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}

function pinColor(items: Restaurant[], groups: FriendGroup[]): string {
  if (items.every((r) => r.closed)) return '#9b93ab'
  const active = groups.filter((g) => items.some((r) => !r.closed && r.groupIds.includes(g.id)))
  return [...active].sort((a, b) => a.priority - b.priority)[0]?.color ?? '#8B6BFF'
}

function pinIcon(pin: Pin, groups: FriendGroup[], focused: boolean) {
  const cluster = pin.items.length > 1
  const classes = ['map-pin', cluster && 'map-pin--cluster', focused && 'map-pin--focused'].filter(Boolean).join(' ')
  const title = cluster ? `이 자리 ${pin.items.length}곳` : escapeHtml(pin.items[0].name)
  return {
    content: `
      <button type="button" class="${classes}" style="--pin-color:${pinColor(pin.items, groups)}" aria-label="${title}">
        <span class="map-pin__dot">${cluster ? pin.items.length : ''}</span>
        ${cluster ? '' : `<span class="map-pin__name">${escapeHtml(pin.items[0].name)}</span>`}
      </button>
    `,
    anchor: new window.naver.maps.Point(cluster ? 13 : 8, cluster ? 26 : 16),
  }
}

// 겹친 핀을 눌렀을 때 핀 바로 위에 뜨는 목록
function pinListContent(items: Restaurant[], groups: FriendGroup[]): string {
  const rows = items
    .map(
      (r) => `
      <li>
        <button type="button" class="pin-list__row" data-place-id="${escapeHtml(r.id)}">
          <span class="pin-list__dot" style="--pin-color:${pinColor([r], groups)}"></span>
          <span class="pin-list__body">
            <span class="pin-list__name">${escapeHtml(r.name)}${r.closed ? ' <em>폐업</em>' : ''}</span>
            <span class="pin-list__meta">${escapeHtml(r.category)}</span>
          </span>
        </button>
      </li>`,
    )
    .join('')
  return `<div class="pin-list"><ul class="pin-list__items">${rows}</ul></div>`
}

export default function MapCanvas({ restaurants, groups, onPick, focusId }: MapCanvasProps) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<naver.maps.Map | null>(null)
  const markersRef = useRef<Map<string, naver.maps.Marker>>(new Map())
  const infoWindowRef = useRef<naver.maps.InfoWindow | null>(null)
  // 목록에서 방금 고른 가게. 지도를 옮긴 뒤 어느 핀이었는지 표시해준다.
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined)
  const focusedRef = useRef<string | undefined>(undefined)
  const restaurantsRef = useRef(restaurants)
  restaurantsRef.current = restaurants
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)

  // 겹침 판정은 화면 픽셀 기준이라 줌이 바뀔 때만 다시 묶으면 된다.
  const pins = useMemo(() => clusterPins(restaurants, zoom), [restaurants, zoom])

  // 고른 가게를 지도 정중앙으로. 확대 레벨은 사용자가 보던 그대로 둔다.
  const focusRestaurant = useCallback((restaurant: Restaurant) => {
    const map = mapRef.current
    if (!map || !window.naver) return

    setFocusedId(restaurant.id)
    map.panTo(new window.naver.maps.LatLng(restaurant.lat, restaurant.lng), PAN_TRANSITION)
  }, [])

  useEffect(() => {
    let cancelled = false
    loadNaverMaps()
      .then((naver) => {
        if (cancelled || !mapDivRef.current) return
        const map = new naver.maps.Map(mapDivRef.current, {
          center: new naver.maps.LatLng(CENTER.lat, CENTER.lng),
          zoom: DEFAULT_ZOOM,
          minZoom: 12,
          scaleControl: false,
          mapDataControl: false,
        })
        infoWindowRef.current = new naver.maps.InfoWindow({
          content: '',
          borderWidth: 0,
          backgroundColor: 'transparent',
          disableAnchor: true,
          pixelOffset: new naver.maps.Point(0, -8),
        })
        naver.maps.Event.addListener(map, 'zoom_changed', (level: number) => setZoom(level))
        // 지도 빈 곳을 누르면 목록이 닫힌다.
        naver.maps.Event.addListener(map, 'click', () => infoWindowRef.current?.close())
        mapRef.current = map
        setMapReady(true)
      })
      .catch((err: Error) => !cancelled && setMapError(err.message))
    return () => {
      cancelled = true
    }
  }, [])

  // 핀을 화면 세로 targetY 위치로 옮긴다 (지도 중심을 그만큼 북쪽으로 당기는 것과 같다).
  const movePinBelowChrome = useCallback((pin: Pin) => {
    const map = mapRef.current
    const mapHeight = mapDivRef.current?.clientHeight ?? 0
    if (!map || !window.naver || !mapHeight) return

    const chromeBottom = document.querySelector('.app__chrome')?.getBoundingClientRect().bottom ?? 0
    const popupHeight = Math.min(PIN_LIST_MAX_HEIGHT, pin.items.length * PIN_LIST_ROW_HEIGHT + 12)
    const targetY = Math.min(mapHeight - 48, Math.max(mapHeight / 2, chromeBottom + popupHeight + 48))

    const zoomLevel = map.getZoom()
    const point = worldPoint(pin.lat, pin.lng, zoomLevel)
    const centerLat = latAtWorldY(point.y - (targetY - mapHeight / 2), zoomLevel)
    map.panTo(new window.naver.maps.LatLng(centerLat, pin.lng), PAN_TRANSITION)
  }, [])

  const openPinList = useCallback(
    (pin: Pin, marker: naver.maps.Marker) => {
      const infoWindow = infoWindowRef.current
      if (!infoWindow || !mapRef.current) return

      // 목록은 핀 위로 펼쳐지므로, 헤더·스토리 영역에 가리지 않는 높이까지 핀을 내려놓고 연다.
      movePinBelowChrome(pin)
      infoWindow.setContent(pinListContent(pin.items, groups))
      infoWindow.open(mapRef.current, marker)

      // setContent 할 때마다 새 엘리먼트라 열 때마다 붙인다.
      infoWindow.getContentElement().addEventListener('click', (event) => {
        const row = (event.target as HTMLElement).closest('[data-place-id]')
        if (!row) return
        const restaurant = pin.items.find((r) => r.id === row.getAttribute('data-place-id'))
        if (!restaurant) return
        infoWindow.close()
        // 최대로 확대해도 이웃과 겹치는 자리(한 건물 등)는 핀으로 고를 수 없으니 바로 상세를 연다.
        if (!isSeparatedAt(restaurantsRef.current, restaurant, MAX_ZOOM)) {
          onPick(restaurant)
          return
        }
        focusRestaurant(restaurant)
      })
    },
    [groups, focusRestaurant, movePinBelowChrome, onPick],
  )

  // 목록이 바뀔 때 마커를 전부 다시 만들면 검색어 한 글자마다 지도가 끊긴다.
  // 사라진 것만 지우고 새로 생긴 것만 만든다.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.naver) return
    const naver = window.naver
    const markers = markersRef.current
    const visibleKeys = new Set(pins.map((p) => p.key))

    markers.forEach((marker, key) => {
      if (!visibleKeys.has(key)) {
        marker.setMap(null)
        markers.delete(key)
      }
    })

    pins.forEach((pin) => {
      if (markers.has(pin.key)) return
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(pin.lat, pin.lng),
        map: mapRef.current!,
        icon: pinIcon(pin, groups, pin.items.some((r) => r.id === focusedRef.current)),
      })
      naver.maps.Event.addListener(marker, 'click', () => {
        // 한 곳뿐이면 목록을 거칠 이유가 없다.
        if (pin.items.length === 1) {
          onPick(pin.items[0])
          return
        }
        openPinList(pin, marker)
      })
      markers.set(pin.key, marker)
    })
  }, [pins, groups, mapReady, onPick, openPinList])

  // 강조 표시는 바뀐 핀만 다시 그린다 (전체 재생성 방지).
  useEffect(() => {
    if (!mapReady || !window.naver) return
    const changed = [focusedRef.current, focusedId].filter(Boolean) as string[]
    if (focusedRef.current === focusedId) return
    focusedRef.current = focusedId

    for (const id of new Set(changed)) {
      const pin = pins.find((p) => p.items.some((r) => r.id === id))
      const marker = pin && markersRef.current.get(pin.key)
      if (!pin || !marker) continue
      marker.setIcon(pinIcon(pin, groups, pin.items.some((r) => r.id === focusedId)))
    }
  }, [focusedId, pins, groups, mapReady])

  // 검색 결과에서 고른 가게가 화면 밖일 수 있어 그 가게로 지도만 옮긴다.
  useEffect(() => {
    if (!mapReady || !focusId) return
    const target = restaurantsRef.current.find((r) => r.id === focusId)
    if (target) focusRestaurant(target)
  }, [focusId, mapReady, focusRestaurant])

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
