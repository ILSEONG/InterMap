declare global {
  interface Window {
    naver?: typeof naver
  }
}

let loadPromise: Promise<typeof naver> | null = null

export function loadNaverMaps(): Promise<typeof naver> {
  if (window.naver?.maps) return Promise.resolve(window.naver)
  if (loadPromise) return loadPromise

  const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID
  if (!clientId) {
    return Promise.reject(new Error('VITE_NAVER_MAP_CLIENT_ID가 설정되지 않았습니다 (frontend/.env.local)'))
  }

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}`
    script.async = true
    script.onload = () => (window.naver ? resolve(window.naver) : reject(new Error('네이버 지도 SDK 로드 실패')))
    script.onerror = () => reject(new Error('네이버 지도 SDK 스크립트를 불러오지 못했습니다'))
    document.head.appendChild(script)
  })

  return loadPromise
}
