import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Restaurant, FriendGroup } from '../data/model'
import { loadNaverMaps } from '../lib/loadNaverMaps'
import { clusterPins } from '../lib/cluster'
import type { Pin } from '../lib/cluster'
import { SUMMARY_MAX_ZOOM } from '../lib/api'
import type { ClusterCell } from '../lib/api'
import './MapCanvas.css'

interface MapCanvasProps {
  restaurants: Restaurant[]
  groups: FriendGroup[]
  // 낮은 줌에서 개별 가게 대신 그리는 서버 격자 요약 셀
  cells?: ClusterCell[]
  onPick: (restaurant: Restaurant) => void
  // 지도만 이 가게로 옮긴다 (검색 결과 선택 등). 상세는 열지 않는다.
  // 같은 가게를 연달아 골라도 다시 이동해야 하므로 id 문자열이 아니라 매번 새 객체로 받는다.
  focus?: { id: string }
  // 지도 이동이 멈출 때마다 (여유 포함된) 보이는 영역과 줌을 알려준다 — 뷰포트 단위 데이터 로딩용.
  onViewportChange?: (viewport: { minLat: number; maxLat: number; minLng: number; maxLng: number }, zoom: number) => void
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
const NAME_LABEL_MIN_ZOOM = 15

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}

function pinColor(items: Restaurant[], groups: FriendGroup[]): string {
  if (items.every((r) => r.closed)) return '#9b93ab'
  // 그룹 미지정 가게는 'none' 유사 그룹으로 취급해 필터·색을 같이 태운다
  const active = groups.filter((g) =>
    items.some((r) => !r.closed && (r.groupIds.length > 0 ? r.groupIds.includes(g.id) : g.id === 'none')),
  )
  return [...active].sort((a, b) => a.priority - b.priority)[0]?.color ?? 'var(--gc-none)'
}

function pinIcon(pin: Pin, groups: FriendGroup[], focused: boolean) {
  // 요약 셀 핀은 items가 비어 있고 count만 있다 — 항상 군집 모양, 색은 미지정 그룹색
  const count = pin.count ?? pin.items.length
  const cluster = count > 1
  const color = pin.items.length > 0 ? pinColor(pin.items, groups) : 'var(--gc-none)'
  const classes = ['map-pin', cluster && 'map-pin--cluster', focused && 'map-pin--focused'].filter(Boolean).join(' ')
  const title = cluster || pin.items.length === 0 ? `이 자리 ${count}곳` : escapeHtml(pin.items[0].name)
  return {
    content: `
      <button type="button" class="${classes}" style="--pin-color:${color}" aria-label="${title}">
        <span class="map-pin__dot">${cluster ? count : ''}</span>
        ${pin.items.length === 1 ? `<span class="map-pin__name">${escapeHtml(pin.items[0].name)}</span>` : ''}
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

export default function MapCanvas({ restaurants, groups, cells = [], onPick, focus, onViewportChange }: MapCanvasProps) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<naver.maps.Map | null>(null)
  const markersRef = useRef<Map<string, naver.maps.Marker>>(new Map())
  const infoWindowRef = useRef<naver.maps.InfoWindow | null>(null)
  // 목록에서 방금 고른 가게. 지도를 옮긴 뒤 어느 핀이었는지 표시해준다.
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined)
  const focusedRef = useRef<string | undefined>(undefined)
  const restaurantsRef = useRef(restaurants)
  restaurantsRef.current = restaurants
  // 지도 초기화 이펙트(의존성 없음)가 항상 최신 콜백을 부르도록 ref로 감싼다.
  const onViewportChangeRef = useRef(onViewportChange)
  onViewportChangeRef.current = onViewportChange
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)
  // 화면에 보이는 영역(여유 포함). 이 밖의 핀은 마커를 만들지 않는다 —
  // 데이터가 수백 건을 넘으면 화면 밖 마커 DOM이 지도 이동을 끊기게 만든다.
  const [viewport, setViewport] = useState<{ minLat: number; maxLat: number; minLng: number; maxLng: number } | null>(
    null,
  )
  // 마지막으로 마커에 반영한 뷰포트+줌 (히스테리시스 판단용)
  const lastViewRef = useRef<{ viewport: { minLat: number; maxLat: number; minLng: number; maxLng: number }; zoom: number } | null>(null)

  // 화면(여유 포함) 안의 가게만 군집한다. 전체 데이터가 수천 건이라
  // 전역으로 묶으면 이동·줌마다 메인 스레드가 얼어 마커가 깜빡인다.
  // 낮은 줌(요약 모드)에서는 DB 가게 개별 핀 대신 서버 요약 셀을 그린다.
  const visiblePins = useMemo(() => {
    if (!viewport) return []
    const cellMode = zoom <= SUMMARY_MAX_ZOOM
    const inBox = (lat: number, lng: number) =>
      lat >= viewport.minLat && lat <= viewport.maxLat && lng >= viewport.minLng && lng <= viewport.maxLng
    const base = cellMode ? restaurants.filter((r) => !r.id.startsWith('db-')) : restaurants
    const pins = clusterPins(
      base.filter((r) => inBox(r.lat, r.lng)),
      zoom,
    )
    if (cellMode) {
      for (const c of cells) {
        if (!inBox(c.lat, c.lng)) continue
        pins.push({
          key: `cell:${c.lat.toFixed(5)},${c.lng.toFixed(5)},${c.count}`,
          lat: c.lat,
          lng: c.lng,
          items: [],
          count: c.count,
        })
      }
    }
    return pins
  }, [restaurants, cells, viewport, zoom])

  const [locating, setLocating] = useState(false)

  // GPS 버튼: 현재 위치로 지도 이동. Capacitor WebView가 navigator.geolocation을
  // 네이티브 권한 요청으로 이어준다 (매니페스트에 위치 권한 선언 필요).
  const goToMyLocation = useCallback(() => {
    if (locating || !navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false)
        const map = mapRef.current
        if (!map || !window.naver) return
        map.morph(
          new window.naver.maps.LatLng(coords.latitude, coords.longitude),
          Math.max(map.getZoom(), DEFAULT_ZOOM),
          PAN_TRANSITION,
        )
      },
      () => {
        setLocating(false)
        alert('현재 위치를 가져올 수 없어요. 위치 권한을 확인해주세요.')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [locating])

  // 현재 위치 빨간 점 — 지도가 준비되면 실시간 추적을 시작하고, 위치가 올 때마다 점만 옮긴다.
  useEffect(() => {
    if (!mapReady || !navigator.geolocation) return
    let marker: naver.maps.Marker | null = null
    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const pos = new window.naver.maps.LatLng(coords.latitude, coords.longitude)
        if (marker) {
          marker.setPosition(pos)
          return
        }
        marker = new window.naver.maps.Marker({
          position: pos,
          map: mapRef.current!,
          icon: { content: '<span class="my-loc"></span>', anchor: new window.naver.maps.Point(8, 8) },
          zIndex: 10,
        })
      },
      // 권한 거부 등이면 점만 안 그린다. 안내는 GPS 버튼의 alert가 담당.
      () => {},
      { enableHighAccuracy: true },
    )
    return () => {
      navigator.geolocation.clearWatch(watchId)
      marker?.setMap(null)
    }
  }, [mapReady])

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
          // 모바일 핀치는 소수점 줌으로 멈춘다. 그대로 쓰면 idle마다 군집이
          // 미세하게 달라져 마커 키가 흔들리므로 정수로 반올림해서 쓴다.
          const nextZoom = Math.round(map.getZoom())
          const bounds = map.getBounds() as naver.maps.LatLngBounds
          const sw = bounds.getSW()
          const ne = bounds.getNE()
          const latPad = (ne.lat() - sw.lat()) * 0.35
          const lngPad = (ne.lng() - sw.lng()) * 0.35
          const next = {
            minLat: sw.lat() - latPad,
            maxLat: ne.lat() + latPad,
            minLng: sw.lng() - lngPad,
            maxLng: ne.lng() + lngPad,
          }
          // 데이터 로딩(스냅 타일 단위로 중복 제거됨)은 매번 알린다
          onViewportChangeRef.current?.(next, nextZoom)
          // 마커용 뷰포트는 히스테리시스: 직전 뷰포트(여유 35%)가 아직 화면을
          // 다 덮고 줌도 그대로면 갱신하지 않는다. 조금 움직일 때마다 경계 마커를
          // 지웠다 만들면 모바일 WebView에서 마커 전체가 깜빡인다.
          const prev = lastViewRef.current
          const covered =
            prev &&
            prev.zoom === nextZoom &&
            sw.lat() >= prev.viewport.minLat &&
            ne.lat() <= prev.viewport.maxLat &&
            sw.lng() >= prev.viewport.minLng &&
            ne.lng() <= prev.viewport.maxLng
          if (covered) return
          lastViewRef.current = { viewport: next, zoom: nextZoom }
          setZoom(nextZoom)
          setViewport(next)
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
        const map = mapRef.current
        if (!map) return
        setFocusedId(restaurant.id)
        // 이 묶음이 최대 줌에서 몇 덩이로 갈라지는지. 1이면 전부 한 건물이라 확대해도 소용없다.
        const splitCount = clusterPins(pin.items, MAX_ZOOM).length
        let targetZoom = map.getZoom()
        if (splitCount === 1) {
          // 건물 단위가 보이는 수준까지만 확대
          targetZoom = Math.max(targetZoom, DETAIL_ZOOM)
        } else {
          // 갈라질 수 있는 건 다 갈라지고 진짜 같은 자리인 것만 남는 줌까지 올린다.
          // 고른 가게 하나만 떨어졌다고 멈추면 나머지가 아직 묶여 있어 "셋이 한 자리"로 오해한다.
          while (targetZoom < MAX_ZOOM && clusterPins(pin.items, targetZoom).length < splitCount) {
            targetZoom += 1
          }
        }
        // 목록에서 이미 골랐으니 한 번 더 탭하게 하지 않고 상세를 바로 연다
        map.morph(new window.naver.maps.LatLng(restaurant.lat, restaurant.lng), targetZoom, PAN_TRANSITION)
        onPick(restaurant)
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
        // 서버 요약 셀은 개별 목록이 없다 — 확대해서 풀어주는 것만 한다.
        if (pin.items.length === 0) {
          const map = mapRef.current
          if (map && map.getZoom() < MAX_ZOOM) {
            map.morph(
              new naver.maps.LatLng(pin.lat, pin.lng),
              Math.min(map.getZoom() + CLUSTER_TAP_ZOOM_STEP, MAX_ZOOM),
              PAN_TRANSITION,
            )
          }
          return
        }
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
        // 단, 최대 줌에서도 안 갈라지는 자리(같은 건물)는 확대해봐야 소용없으니 바로 목록.
        if (pin.items.length >= ZOOM_INSTEAD_OF_LIST && clusterPins(pin.items, MAX_ZOOM).length > 1) {
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
      const pin = visiblePins.find((p) => p.items.some((r) => r.id === id))
      const marker = pin && markersRef.current.get(pin.key)
      if (!pin || !marker) continue
      marker.setIcon(pinIcon(pin, groups, pin.items.some((r) => r.id === focusedId)))
    }
  }, [focusedId, visiblePins, groups, mapReady])

  // 검색 결과에서 고른 가게가 화면 밖일 수 있어 그 가게로 지도만 옮긴다.
  useEffect(() => {
    if (!mapReady || !focus) return
    const target = restaurantsRef.current.find((r) => r.id === focus.id)
    if (target) focusRestaurant(target)
  }, [focus, mapReady, focusRestaurant])

  return (
    <div className={`map-canvas${zoom < NAME_LABEL_MIN_ZOOM ? ' map-canvas--far' : ''}`}>
      <div ref={mapDivRef} className="map-canvas__surface" />
      <button
        type="button"
        className={`map-gps${locating ? ' map-gps--locating' : ''}`}
        aria-label="현재 위치로 이동"
        onClick={goToMyLocation}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" />
          <path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
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
