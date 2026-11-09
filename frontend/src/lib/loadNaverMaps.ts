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

export function loadNaverMaps(): Promise<typeof naver> {
  if (window.naver?.maps) return Promise.resolve(window.naver)
  if (loadPromise) return loadPromise

  const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID
  if (!clientId) {
    return Promise.reject(new Error('VITE_NAVER_MAP_CLIENT_ID가 설정되지 않았습니다 (frontend/.env.local)'))
  }

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
