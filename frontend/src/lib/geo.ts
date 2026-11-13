import { Capacitor } from '@capacitor/core'

// 현재 위치.
// 웹·안드로이드 앱은 브라우저 표준(navigator.geolocation)을 쓴다 — 안드로이드 WebView는 이걸 앱 위치 권한으로 이어 준다.
// 아이폰 앱은 네이티브 플러그인을 쓴다. 아이폰 웹뷰에서 표준 API를 쓰면 앱 권한 창 뒤에
// '"intermap.app"이(가) 현재 위치를 사용하려고 합니다'라는 웹사이트용 창이 한 번 더 뜬다.
const NATIVE_IOS = Capacitor.getPlatform() === 'ios'

export interface LatLng {
  lat: number
  lng: number
}

export const geoAvailable = () => NATIVE_IOS || 'geolocation' in navigator

export async function currentPosition(timeoutMs = 10000): Promise<LatLng> {
  if (NATIVE_IOS) {
    const { Geolocation } = await import('@capacitor/geolocation')
    const { coords } = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: timeoutMs })
    return { lat: coords.latitude, lng: coords.longitude }
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: timeoutMs },
    )
  })
}

// 위치가 바뀔 때마다 알려 준다. 권한 거부 등 실패는 조용히 넘긴다 (안내는 GPS 버튼이 한다).
// 돌려주는 함수로 멈춘다.
export function watchPosition(onPosition: (pos: LatLng) => void): () => void {
  if (NATIVE_IOS) {
    let stopped = false
    let watchId: string | null = null
    void import('@capacitor/geolocation')
      .then(async ({ Geolocation }) => {
        const id = await Geolocation.watchPosition({ enableHighAccuracy: true }, (position) => {
          if (!stopped && position) onPosition({ lat: position.coords.latitude, lng: position.coords.longitude })
        })
        // 시작되기 전에 이미 멈추라고 했으면 바로 걷는다
        if (stopped) void Geolocation.clearWatch({ id })
        else watchId = id
      })
      .catch(() => {})
    return () => {
      stopped = true
      if (watchId) void import('@capacitor/geolocation').then(({ Geolocation }) => Geolocation.clearWatch({ id: watchId! }))
    }
  }
  if (!('geolocation' in navigator)) return () => {}
  const id = navigator.geolocation.watchPosition(
    ({ coords }) => onPosition({ lat: coords.latitude, lng: coords.longitude }),
    () => {},
    { enableHighAccuracy: true },
  )
  return () => navigator.geolocation.clearWatch(id)
}
