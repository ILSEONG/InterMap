import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Restaurant, FriendGroup } from '../data/model'
import { loadNaverMaps, useGlMap } from '../lib/loadNaverMaps'
import { clusterPins, clusterDistanceAt } from '../lib/cluster'
import type { Pin } from '../lib/cluster'
import { SUMMARY_MAX_ZOOM } from '../lib/api'
import type { ClusterCell } from '../lib/api'
import { STAR_PATH } from './StarIcon'
import './MapCanvas.css'

interface MapCanvasProps {
  restaurants: Restaurant[]
  groups: FriendGroup[]
  // 낮은 줌에서 개별 가게 대신 그리는 서버 격자 요약 셀
  cells?: ClusterCell[]
  // 요약 모드에서도 넘겨받은 가게를 개별 핀으로 그릴지 — 후기 있음 필터·검색 중처럼 목록이 이미 작을 때 true
  pinsWhenFar?: boolean
  // 찜 모드: 모든 핀을 초록 별 모양으로 그린다
  starPins?: boolean
  onPick: (restaurant: Restaurant) => void
  // 지도만 이 가게로 옮긴다 (검색 결과 선택 등). 상세는 열지 않는다.
  // 같은 가게를 연달아 골라도 다시 이동해야 하므로 id 문자열이 아니라 매번 새 객체로 받는다.
  // lat·lng: 필터에 걸려 목록에 없는 가게여도 그 자리로는 옮긴다
  focus?: { id: string; lat: number; lng: number; sheet?: boolean }
  // 지도 위를 가리는 것들을 뺀, 실제로 보이는 세로 범위(px). sheet=true면 가게 시트가 열린 상태 기준.
  // 가게로 이동할 때 핀을 화면 정가운데가 아니라 이 범위의 가운데에 둔다 (위 헤더·스토리, 아래 시트·패널에 가리지 않게)
  visibleArea?: (sheet: boolean) => { top: number; bottom: number }
  // 가게 시트가 열려 있는지 — 닫히면 고른 가게를 시트 없는 화면의 가운데로 다시 옮긴다
  sheetOpen?: boolean
  // 지도 이동이 멈출 때마다 (여유 포함된) 보이는 영역과 줌을 알려준다 — 뷰포트 단위 데이터 로딩용.
  onViewportChange?: (viewport: { minLat: number; maxLat: number; minLng: number; maxLng: number }, zoom: number) => void
  // 실시간 추적 중인 내 위치가 바뀔 때마다 알려준다 — 검색 결과를 가까운 순으로 정렬하는 데 쓴다.
  onMyLocation?: (pos: { lat: number; lng: number }) => void
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
// 화면에 그리는 마커 상한. 넘으면 군집 반경을 키워가며 다시 묶는다 — DOM 마커 수백 개를
// 줌마다 지웠다 만드는 게 렉의 원인이라 개수 자체를 잡는다.
const MAX_PINS = 300
// 고른 가게 핀(이름 알약)은 이웃 핀들 위로. 현재 위치 점(10)보다는 아래.
const FOCUSED_Z = 5

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)
}

// 후기 있는 가게 핀 색. 그룹색보다 우선 — "이웃이 다녀간 곳"이 지도에서 바로 보이게.
const REVIEWED_PIN_COLOR = '#FF5D73'

function pinColor(items: Restaurant[], groups: FriendGroup[]): string {
  if (items.some((r) => r.reviews.length > 0)) return REVIEWED_PIN_COLOR
  // 그룹 미지정 가게는 'none' 유사 그룹으로 취급해 필터·색을 같이 태운다
  const active = groups.filter((g) =>
    items.some((r) => (r.groupIds.length > 0 ? r.groupIds.includes(g.id) : g.id === 'none')),
  )
  return [...active].sort((a, b) => a.priority - b.priority)[0]?.color ?? 'var(--gc-none)'
}

// 찜 모드 핀 색 — 별 노랑
const FAVORITE_PIN_COLOR = '#FF9F0A'

// 헤더 찜 토글과 같은 통통한 별 (StarIcon.STAR_PATH)
const STAR_PIN_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" style="display:block"><path d="${STAR_PATH}" style="fill:var(--pin-color);stroke:#fff" stroke-width="2" stroke-linejoin="round"/></svg>`

// 가게 핀 모양 (CSS가 전부 가운데 정렬하므로 너비가 달라도 anchor는 0,0 하나):
// 여러 곳 = 흰 원에 개수 (서버 요약 셀도 같은 모양), 후기 있는 가게 = 흰 알약 "● 후기수",
// 후기 없는 가게 = 작은 점, 찜 = 별. 고른 가게는 진한 알약에 이름(+후기수)으로 펼친다.
function pinIcon(pin: Pin, groups: FriendGroup[], focused: boolean, star = false) {
  const count = pin.count ?? pin.items.length
  // 요약 셀은 items가 비어 있고 count만 있다
  const cell = pin.items.length === 0
  const place = !cell && count === 1 ? pin.items[0] : null
  const reviewCount = place ? place.reviews.length : 0
  const color = star ? FAVORITE_PIN_COLOR : cell ? 'var(--gc-none)' : pinColor(pin.items, groups)
  const variant = !place
    ? 'cluster'
    : focused
        ? 'label'
        : star
          ? 'star'
          : reviewCount > 0
            ? 'pill'
            : 'dot'
  const lead = star ? STAR_PIN_SVG : '<span class="map-pin__dot"></span>'
  const body = {
    cluster: `${count}`,
    label: `${lead}<span class="map-pin__name">${escapeHtml(place?.name ?? '')}</span>${reviewCount > 0 ? `<span class="map-pin__badge">${reviewCount}</span>` : ''}`,
    star: STAR_PIN_SVG,
    pill: `${lead}<span class="map-pin__count">${reviewCount}</span>`,
    dot: '',
  }[variant]
  const title = place ? escapeHtml(place.name) : `이 자리 ${count}곳`
  return {
    content: `<button type="button" class="map-pin map-pin--${variant}${focused ? ' map-pin--focused' : ''}" style="--pin-color:${color}" aria-label="${title}">${body}</button>`,
    anchor: new window.naver.maps.Point(0, 0),
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
            <span class="pin-list__name">${escapeHtml(r.name)}</span>
            <span class="pin-list__meta">${escapeHtml(r.category)}</span>
          </span>
        </button>
      </li>`,
    )
    .join('')
  return `<div class="pin-list"><ul class="pin-list__items">${rows}</ul></div>`
}

export default function MapCanvas({
  restaurants,
  groups,
  cells = [],
  pinsWhenFar = false,
  starPins = false,
  onPick,
  focus,
  visibleArea,
  sheetOpen = false,
  onViewportChange,
  onMyLocation,
}: MapCanvasProps) {
  const mapDivRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<naver.maps.Map | null>(null)
  const markersRef = useRef<Map<string, naver.maps.Marker>>(new Map())
  const infoWindowRef = useRef<naver.maps.InfoWindow | null>(null)
  // 목록에서 방금 고른 가게. 지도를 옮긴 뒤 어느 핀이었는지 표시해준다.
  // GL 지도는 줌 숫자가 이미지 지도와 한 단계 다를 수 있다 (타일 크기 차이). 군집·요약 셀 계산은 전부
  // 이미지 지도(256px 타일) 기준이라, 화면 폭과 경도 폭으로 실제 축척을 재서 그 차이를 더해 쓴다.
  const zoomOffsetRef = useRef(0)
  const zoomOf = (map: naver.maps.Map) => map.getZoom() + zoomOffsetRef.current
  const toMapZoom = (z: number) => z - zoomOffsetRef.current
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined)
  const focusedRef = useRef<string | undefined>(undefined)
  const restaurantsRef = useRef(restaurants)
  restaurantsRef.current = restaurants
  // 지도 초기화 이펙트(의존성 없음)가 항상 최신 콜백을 부르도록 ref로 감싼다.
  const onViewportChangeRef = useRef(onViewportChange)
  onViewportChangeRef.current = onViewportChange
  const [mapError, setMapError] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  // GL(벡터) 지도로 떴는지 — 핀 CSS를 GL에 맞게 가볍게 한다
  const [glActive, setGlActive] = useState(false)
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
    // 요약 모드에서는 개별 핀을 그리지 않는다 — 셀 건수에 후기 있는 가게도 이미 들어 있다.
    // 단 후기 있음 필터·검색 중에는 셀이 없으므로 넘겨받은 가게를 줌과 무관하게 개별 핀으로 그린다.
    const base = cellMode && !pinsWhenFar ? [] : restaurants
    const inView = base.filter((r) => inBox(r.lat, r.lng))
    let dist = clusterDistanceAt(zoom)
    let pins = clusterPins(inView, zoom, dist)
    // 상한을 넘으면 반경을 1.5배씩 키워 다시 묶는다 (버킷 군집이라 수천 건도 ms 단위)
    while (pins.length > MAX_PINS && dist < 400) {
      dist *= 1.5
      pins = clusterPins(inView, zoom, dist)
    }
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
  }, [restaurants, cells, viewport, zoom, pinsWhenFar])

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
          toMapZoom(Math.max(zoomOf(map), DEFAULT_ZOOM)),
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
        onMyLocation?.({ lat: coords.latitude, lng: coords.longitude })
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
  }, [mapReady, onMyLocation])

  const visibleAreaRef = useRef(visibleArea)
  visibleAreaRef.current = visibleArea

  // 이 좌표가 (zoom에서) 화면의 "보이는 범위 가운데"에 오도록 지도를 옮긴다.
  // 화면 정가운데에 두면 아래 절반을 덮는 가게 시트나 사람 패널 밑에 핀이 깔린다.
  // 웹 메르카토르 픽셀로 세로만 밀어 중심 좌표를 구한다 (zoom은 이미지 지도 기준 — zoomOf와 같은 척도)
  const panToVisible = useCallback((lat: number, lng: number, zoom: number, sheet: boolean) => {
    const map = mapRef.current
    if (!map || !window.naver) return
    const area = visibleAreaRef.current?.(sheet)
    const height = mapDivRef.current?.clientHeight || window.innerHeight
    const shift = area ? height / 2 - (area.top + area.bottom) / 2 : 0
    const scale = 256 * 2 ** zoom
    const sin = Math.sin((lat * Math.PI) / 180)
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale + shift
    const n = Math.PI - (2 * Math.PI * y) / scale
    const centerLat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
    const center = new window.naver.maps.LatLng(centerLat, lng)
    if (Math.abs(zoomOf(map) - zoom) > 0.01) map.morph(center, toMapZoom(zoom), PAN_TRANSITION)
    else map.panTo(center, PAN_TRANSITION)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 고른 가게를 보이는 범위 가운데로. 확대 레벨은 사용자가 보던 그대로 둔다.
  const focusRestaurant = useCallback(
    (restaurant: Pick<Restaurant, 'id' | 'lat' | 'lng'>, sheet = false) => {
      const map = mapRef.current
      if (!map || !window.naver) return
      setFocusedId(restaurant.id)
      // 요약 모드(줌 ≤16)에서는 개별 핀이 안 그려지므로 핀이 보이는 줌까지 당겨서 간다
      const zoom = zoomOf(map) <= SUMMARY_MAX_ZOOM ? SUMMARY_MAX_ZOOM + 1 : zoomOf(map)
      panToVisible(restaurant.lat, restaurant.lng, zoom, sheet)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panToVisible],
  )

  useEffect(() => {
    let cancelled = false
    loadNaverMaps()
      .then((naver) => {
        if (cancelled || !mapDivRef.current) return
        const map = new naver.maps.Map(mapDivRef.current, {
          center: new naver.maps.LatLng(CENTER.lat, CENTER.lng),
          zoom: DEFAULT_ZOOM,
          // 9 ≈ 남한 절반이 한 화면. 이 아래로는 서버 요약 셀 한 변이 도 단위로 커져
          // 셀 하나가 시 전체를 삼킨다 (건수만 남고 위치 의미가 없어진다).
          minZoom: 9,
          scaleControl: false,
          mapDataControl: false,
          ...(useGlMap ? { gl: true } : null),
        } as naver.maps.MapOptions)
        // 실제 축척으로 줌 차이를 잰다 (이미지 지도면 0, GL이 512px 타일이면 1)
        const span = map.getBounds() as naver.maps.LatLngBounds
        const width = mapDivRef.current.clientWidth
        const lngSpan = span.getNE().lng() - span.getSW().lng()
        if (width > 0 && lngSpan > 0) {
          const offset = Math.round(Math.log2((width * 360) / (256 * lngSpan)) - map.getZoom())
          if (offset !== 0 && Math.abs(offset) <= 2) {
            zoomOffsetRef.current = offset
            map.setOptions({ minZoom: 9 - offset, maxZoom: MAX_ZOOM - offset })
            map.setZoom(DEFAULT_ZOOM - offset, false)
          }
        }
        setGlActive(useGlMap)
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
          const nextZoom = Math.round(zoomOf(map))
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
        let targetZoom = zoomOf(map)
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
        panToVisible(restaurant.lat, restaurant.lng, targetZoom, true)
        onPick(restaurant)
      })
    },
    [groups, onPick, panToVisible],
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
      const existing = markers.get(pin.key)
      // 색·후기수·찜 모드 여부를 키에 담는다 — 셋 중 하나만 바뀌어도 같은 자리 핀의 아이콘이 갈린다
      const iconKey = `${pin.items.length > 0 ? pinColor(pin.items, groups) : 'var(--gc-none)'}|${pin.items.length === 1 ? pin.items[0].reviews.length : ''}${starPins ? '|star' : ''}`
      const focused = pin.items.some((r) => r.id === focusedRef.current)
      if (existing) {
        // 같은 묶음이라도 후기가 새로 달리면 색이 바뀐다 — 아이콘만 갈아끼운다
        if (existing.get('pinColor') !== iconKey) {
          existing.set('pinColor', iconKey)
          existing.setIcon(pinIcon(pin, groups, focused, starPins))
        }
        return
      }
      const marker = new naver.maps.Marker({
        position: new naver.maps.LatLng(pin.lat, pin.lng),
        map: mapRef.current!,
        icon: pinIcon(pin, groups, focused, starPins),
        zIndex: focused ? FOCUSED_Z : 0,
      })
      marker.set('pinColor', iconKey)
      naver.maps.Event.addListener(marker, 'click', () => {
        // 다른 핀의 목록이 열려 있었다면 먼저 닫는다.
        infoWindowRef.current?.close()
        // 서버 요약 셀은 개별 목록이 없다 — 확대해서 풀어주는 것만 한다.
        if (pin.items.length === 0) {
          const map = mapRef.current
          if (map && zoomOf(map) < MAX_ZOOM) {
            map.morph(
              new naver.maps.LatLng(pin.lat, pin.lng),
              toMapZoom(Math.min(zoomOf(map) + CLUSTER_TAP_ZOOM_STEP, MAX_ZOOM)),
              PAN_TRANSITION,
            )
          }
          return
        }
        // 한 곳뿐이면 목록을 거칠 이유가 없다. 어느 핀을 골랐는지 링으로 남기고
        // 지도는 그 핀을 (열리는 시트 위쪽) 보이는 범위 가운데로 옮긴다.
        if (pin.items.length === 1) {
          setFocusedId(pin.items[0].id)
          // 상세 시트가 열리니 시트 위쪽 보이는 범위 가운데로
          const map = mapRef.current
          if (map) panToVisible(pin.lat, pin.lng, zoomOf(map), true)
          onPick(pin.items[0])
          return
        }
        // 크게 묶인 군집은 목록 대신 확대해서 풀어준다. 확대되면 재군집돼
        // 마커가 갈라지고, 계속 안 갈라지는 자리는 결국 목록으로 떨어진다.
        // 단, 최대 줌에서도 안 갈라지는 자리(같은 건물)는 확대해봐야 소용없으니 바로 목록.
        if (pin.items.length >= ZOOM_INSTEAD_OF_LIST && clusterPins(pin.items, MAX_ZOOM).length > 1) {
          const map = mapRef.current
          if (map && zoomOf(map) < MAX_ZOOM) {
            map.morph(
              new naver.maps.LatLng(pin.lat, pin.lng),
              toMapZoom(Math.min(zoomOf(map) + CLUSTER_TAP_ZOOM_STEP, MAX_ZOOM)),
              PAN_TRANSITION,
            )
            return
          }
        }
        openPinList(pin, marker)
      })
      markers.set(pin.key, marker)
    })
  }, [visiblePins, groups, mapReady, onPick, openPinList, panToVisible, starPins])

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
      const focused = pin.items.some((r) => r.id === focusedId)
      marker.setIcon(pinIcon(pin, groups, focused, starPins))
      // 펼친 이름 알약이 이웃 핀 밑에 깔리지 않게
      marker.setZIndex(focused ? FOCUSED_Z : 0)
    }
  }, [focusedId, visiblePins, groups, mapReady, starPins])

  // 검색 결과에서 고른 가게가 화면 밖일 수 있어 그 가게로 지도만 옮긴다.
  // 시트가 닫히면 핀이 화면 아래쪽으로 치우쳐 보인다 — 보이는 지도의 가운데로 옮긴다.
  // 시트를 연 채 지도를 끌어 다른 데를 보고 있었다면(핀이 시트 위 가운데에 없으면) 그대로 둔다.
  const wasSheetOpenRef = useRef(sheetOpen)
  useEffect(() => {
    const was = wasSheetOpenRef.current
    wasSheetOpenRef.current = sheetOpen
    const map = mapRef.current
    if (!was || sheetOpen || !mapReady || !map || !window.naver) return
    const id = focusedRef.current
    const target = id ? restaurantsRef.current.find((r) => r.id === id) : undefined
    if (!target) return
    const area = visibleAreaRef.current?.(true)
    const width = mapDivRef.current?.clientWidth || window.innerWidth
    const at = map.getProjection().fromCoordToOffset(new window.naver.maps.LatLng(target.lat, target.lng))
    const expectedY = area ? (area.top + area.bottom) / 2 : (mapDivRef.current?.clientHeight || window.innerHeight) / 2
    if (Math.abs(at.x - width / 2) > 80 || Math.abs(at.y - expectedY) > 80) return
    panToVisible(target.lat, target.lng, zoomOf(map), false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen, mapReady, panToVisible])

  useEffect(() => {
    if (!mapReady || !focus) return
    focusRestaurant(restaurantsRef.current.find((r) => r.id === focus.id) ?? focus, !!focus.sheet)
  }, [focus, mapReady, focusRestaurant])

  return (
    <div className={`map-canvas${glActive ? ' map-canvas--gl' : ''}`}>
      <div ref={mapDivRef} className="map-canvas__surface" />
      <button
        type="button"
        className={`map-gps glass${locating ? ' map-gps--locating' : ''}`}
        aria-label="현재 위치로 이동"
        onClick={goToMyLocation}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 4L4 11l7 2 2 7z" />
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
