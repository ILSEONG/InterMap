import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Restaurant, FriendGroup } from '../data/mock'
import { loadNaverMaps } from '../lib/loadNaverMaps'
import { clusterPins, isSeparatedAt } from '../lib/cluster'
import type { Pin } from '../lib/cluster'
import './MapCanvas.css'

interface MapCanvasProps {
  restaurants: Restaurant[]
  groups: FriendGroup[]
  onPick: (restaurant: Restaurant) => void
  // 지도만 이 가게로 옮긴다 (검색 결과 선택 등). 상세는 열지 않는다.
  // 같은 가게를 연달아 골라도 다시 이동해야 하므로 id 문자열이 아니라 매번 새 객체로 받는다.
  focus?: { id: string }
}

const CENTER = { lat: 37.5605, lng: 126.92 }
const DEFAULT_ZOOM = 15
const MAX_ZOOM = 21
// 목록에서 고른 가게로 갈 때의 확대 레벨. 최대에서 한 단계 여유를 둬서
// 사용자가 더 당겨볼 여지를 남긴다.
// 지도 이동은 확대 없이, 살짝 감속하며 미끄러지듯.
const PAN_TRANSITION = { duration: 700, easing: 'easeOutCubic' }
// 이보다 많이 묶인 군집은 목록으로 고르기 버거우니 탭하면 확대해서 풀어준다.
const ZOOM_INSTEAD_OF_LIST = 6
const CLUSTER_TAP_ZOOM_STEP = 2
// 아무리 확대해도 안 갈라지는 가게(같은 건물)를 골랐을 때 최소 이만큼은 확대해서
// 어느 골목·건물인지 맥락을 보여준다. 18 ≈ 건물 단위가 보이는 수준.
const DETAIL_ZOOM = 18
// 이보다 멀리서 보면 핀 이름 라벨을 숨긴다 (빽빽할 때 페인트 비용 절감)
const NAME_LABEL_MIN_ZOOM = 16

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

export default function MapCanvas({ restaurants, groups, onPick, focus }: MapCanvasProps) {
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
  // 화면에 보이는 영역(여유 포함). 이 밖의 핀은 마커를 만들지 않는다 —
  // 데이터가 수백 건을 넘으면 화면 밖 마커 DOM이 지도 이동을 끊기게 만든다.
  const [viewport, setViewport] = useState<{ minLat: number; maxLat: number; minLng: number; maxLng: number } | null>(
    null,
  )

  // 겹침 판정은 화면 픽셀 기준이라 줌이 바뀔 때만 다시 묶으면 된다.
  const pins = useMemo(() => clusterPins(restaurants, zoom), [restaurants, zoom])

  const visiblePins = useMemo(() => {
    if (!viewport) return []
    return pins.filter(
      (p) => p.lat >= viewport.minLat && p.lat <= viewport.maxLat && p.lng >= viewport.minLng && p.lng <= viewport.maxLng,
    )
  }, [pins, viewport])

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
        // 지도 빈 곳을 누르면 목록이 닫힌다. 포커스 링은 다음 포커스가 생길 때까지 유지.
        naver.maps.Event.addListener(map, 'click', () => infoWindowRef.current?.close())
        // 줌·뷰포트 갱신은 이동이 멈춘 뒤(idle) 한 번만 한다.
        // 애니메이션 도중에 재군집하면 마커가 갈리면서 화면이 움찔거린다.
        const updateViewport = () => {
          setZoom(map.getZoom())
          const bounds = map.getBounds() as naver.maps.LatLngBounds
          const sw = bounds.getSW()
          const ne = bounds.getNE()
          const latPad = (ne.lat() - sw.lat()) * 0.2
          const lngPad = (ne.lng() - sw.lng()) * 0.2
          setViewport({
            minLat: sw.lat() - latPad,
            maxLat: ne.lat() + latPad,
            minLng: sw.lng() - lngPad,
            maxLng: ne.lng() + lngPad,
          })
        }
        naver.maps.Event.addListener(map, 'idle', updateViewport)
        updateViewport()
        mapRef.current = map
        setMapReady(true)
      })
      .catch((err: Error) => !cancelled && setMapError(err.message))
    return () => {
      cancelled = true
    }
  }, [])

  const openPinList = useCallback(
    (pin: Pin, marker: naver.maps.Marker) => {
      const infoWindow = infoWindowRef.current
      if (!infoWindow || !mapRef.current) return

      // 어떤 핀을 눌러도 지도는 그 핀을 정가운데로.
      mapRef.current.panTo(new window.naver.maps.LatLng(pin.lat, pin.lng), PAN_TRANSITION)
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
          setFocusedId(restaurant.id)
          // 개별 핀으로는 영영 못 갈라지니, 건물 단위가 보이는 수준까지 확대만 하고
          // 위치는 가운데 그대로 둔다 (위로 밀어올리지 않는다).
          const map = mapRef.current
          if (map) {
            map.morph(
              new window.naver.maps.LatLng(restaurant.lat, restaurant.lng),
              Math.max(map.getZoom(), DETAIL_ZOOM),
              PAN_TRANSITION,
            )
          }
          onPick(restaurant)
          return
        }
        // 이웃과 갈라져 개별 핀으로 보이는 줌까지 확대하며 그 가게로 이동한다.
        const map = mapRef.current
        if (map) {
          let targetZoom = map.getZoom()
          while (targetZoom < MAX_ZOOM && !isSeparatedAt(restaurantsRef.current, restaurant, targetZoom)) {
            targetZoom += 1
          }
          setFocusedId(restaurant.id)
          map.morph(new window.naver.maps.LatLng(restaurant.lat, restaurant.lng), targetZoom, PAN_TRANSITION)
        }
      })
    },
    [groups, onPick],
  )

  // 목록이 바뀔 때 마커를 전부 다시 만들면 검색어 한 글자마다 지도가 끊긴다.
  // 사라진 것만 지우고 새로 생긴 것만 만든다.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.naver) return
    const naver = window.naver
    const markers = markersRef.current
    const visibleKeys = new Set(visiblePins.map((p) => p.key))

    markers.forEach((marker, key) => {
      if (!visibleKeys.has(key)) {
        marker.setMap(null)
        markers.delete(key)
      }
    })

    visiblePins.forEach((pin) => {
      if (markers.has(pin.key)) return
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(pin.lat, pin.lng),
        map: mapRef.current!,
        icon: pinIcon(pin, groups, pin.items.some((r) => r.id === focusedRef.current)),
      })
      naver.maps.Event.addListener(marker, 'click', () => {
        // 다른 핀의 목록이 열려 있었다면 먼저 닫는다.
        infoWindowRef.current?.close()
        // 한 곳뿐이면 목록을 거칠 이유가 없다. 어느 핀을 골랐는지 링으로 남기고
        // 지도는 그 핀을 정가운데로 옮긴다.
        if (pin.items.length === 1) {
          setFocusedId(pin.items[0].id)
          mapRef.current?.panTo(new naver.maps.LatLng(pin.lat, pin.lng), PAN_TRANSITION)
          onPick(pin.items[0])
          return
        }
        // 크게 묶인 군집은 목록 대신 확대해서 풀어준다. 확대되면 재군집돼
        // 마커가 갈라지고, 계속 안 갈라지는 자리는 결국 목록으로 떨어진다.
        if (pin.items.length >= ZOOM_INSTEAD_OF_LIST) {
          const map = mapRef.current
          if (map && map.getZoom() < MAX_ZOOM) {
            map.morph(
              new naver.maps.LatLng(pin.lat, pin.lng),
              Math.min(map.getZoom() + CLUSTER_TAP_ZOOM_STEP, MAX_ZOOM),
              PAN_TRANSITION,
            )
            return
          }
        }
        openPinList(pin, marker)
      })
      markers.set(pin.key, marker)
    })
  }, [visiblePins, groups, mapReady, onPick, openPinList])

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
    if (!mapReady || !focus) return
    const target = restaurantsRef.current.find((r) => r.id === focus.id)
    if (target) focusRestaurant(target)
  }, [focus, mapReady, focusRestaurant])

  return (
    <div className={`map-canvas${zoom < NAME_LABEL_MIN_ZOOM ? ' map-canvas--far' : ''}`}>
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
