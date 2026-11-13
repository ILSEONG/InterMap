import { Capacitor } from '@capacitor/core'

declare global {
  interface Window {
    naver?: typeof naver
  }
}

let loadPromise: Promise<typeof naver> | null = null

// GL(벡터) 지도 — 지도를 WebGL 한 장으로 그려 이동·확대가 훨씬 부드럽다. 하드웨어 가속이 없으면 SDK가 알아서 이미지 타일로 돌아간다.
// 문제가 생기면 주소에 ?raster=1 을 붙이거나 localStorage intermap.mapRaster=1 로 예전 방식으로 볼 수 있다.
export const useGlMap = (() => {
  try {
    return !new URLSearchParams(window.location.search).has('raster') && localStorage.getItem('intermap.mapRaster') !== '1'
  } catch {
    return true
  }
})()

// 아이폰 앱은 화면 주소가 capacitor://intermap.app:8443 이다 (iOS 웹뷰는 앱 안 파일을 https로 내줄 수 없다).
// 네이버 지도 인증 서버는 https가 아닌 주소를 받으면 인증 실패가 아니라 500 오류를 내서 지도가 뜨지 않는다.
// 그래서 지도 SDK가 네이버로 보내는 요청 주소 안의 "내 주소"를 안드로이드 앱과 같은 https://intermap.app:8443 으로 바꿔 보낸다
// (NCP 콘솔 Web 서비스 URL에 등록해 둔 그 주소 — capacitor.config.ts 참고).
// SDK가 인증을 <script>(JSONP)·fetch·XHR 어느 쪽으로 하든 걸리도록 세 군데를 모두 감싼다.
let iosAuthPatched = false
function patchNaverAuthForIos() {
  if (iosAuthPatched || Capacitor.getPlatform() !== 'ios') return
  iosAuthPatched = true
  const origin = window.location.origin
  if (!origin.startsWith('capacitor://')) return
  const httpsOrigin = origin.replace(/^capacitor:/, 'https:')
  const variants: [string, string][] = [
    [origin, httpsOrigin],
    [encodeURIComponent(origin), encodeURIComponent(httpsOrigin)],
  ]
  const fix = (url: string): string => {
    if (!/^https?:\/\/[^/]*naver\.(com|net)\//.test(url)) return url
    let out = url
    for (const [from, to] of variants) out = out.split(from).join(to)
    return out
  }

  const srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src')
  if (srcDesc?.set && srcDesc.get) {
    const { get, set } = srcDesc
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
      configurable: true,
      enumerable: srcDesc.enumerable,
      get() {
        return get.call(this)
      },
      set(value: string) {
        set.call(this, fix(String(value)))
      },
    })
  }
  const setAttribute = HTMLScriptElement.prototype.setAttribute
  HTMLScriptElement.prototype.setAttribute = function (name: string, value: string) {
    setAttribute.call(this, name, name.toLowerCase() === 'src' ? fix(String(value)) : value)
  }
  const realFetch = window.fetch
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === 'string' ? fix(input) : input instanceof URL ? fix(input.href) : input, init)
  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    // @ts-expect-error 나머지 인자(async, user, password)는 그대로 넘긴다
    return open.call(this, method, fix(String(url)), ...rest)
  }
}

export function loadNaverMaps(): Promise<typeof naver> {
  if (window.naver?.maps) return Promise.resolve(window.naver)
  if (loadPromise) return loadPromise

  const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID
  if (!clientId) {
    return Promise.reject(new Error('VITE_NAVER_MAP_CLIENT_ID가 설정되지 않았습니다 (frontend/.env.local)'))
  }

  patchNaverAuthForIos()
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}${useGlMap ? '&submodules=gl' : ''}`
    script.async = true
    script.onload = () => (window.naver ? resolve(window.naver) : reject(new Error('네이버 지도 SDK 로드 실패')))
    script.onerror = () => reject(new Error('네이버 지도 SDK 스크립트를 불러오지 못했습니다'))
    document.head.appendChild(script)
  })

  return loadPromise
}
