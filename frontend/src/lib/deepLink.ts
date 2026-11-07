import { Capacitor } from '@capacitor/core'

// 투표 링크로 앱 열기.
// - 앱 딥링크: intermap://poll?t=<토큰> (AndroidManifest의 intent-filter)
// - 웹 링크:   https://<웹>/?poll=<토큰>
// 카톡은 링크를 자기 인앱 브라우저로 열어 안드로이드에 넘기지 않는다. 그래서 웹 페이지가 열리자마자
// intent:// 주소로 앱을 한 번 불러 보고, 앱이 없으면 안드로이드가 fallback 주소(같은 웹 + web=1)로 돌려보낸다.

export const APP_PACKAGE = 'com.intermap.app'
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${APP_PACKAGE}`

// intermap://poll?t=… 또는 …?poll=… 에서 투표 토큰. 아니면 null
export function pollTokenFromUrl(url: string): string | null {
  // 비표준 스킴은 WebView 버전마다 URL 파싱이 달라 직접 자른다
  const app = /^intermap:\/\/poll\/?\?(.*)$/i.exec(url)
  if (app) return new URLSearchParams(app[1]).get('t')
  try {
    return new URL(url).searchParams.get('poll')
  } catch {
    return null
  }
}

// 안드로이드 휴대폰의 브라우저(카톡 인앱 브라우저 포함)로 웹을 보고 있는지 — 앱 안(WebView)은 제외
export function isAndroidWeb(): boolean {
  return !Capacitor.isNativePlatform() && /Android/i.test(navigator.userAgent)
}

// 앱이 있으면 앱을, 없으면 fallback 주소를 여는 안드로이드 intent 주소
export function pollIntentUrl(token: string, fallback: string): string {
  return (
    `intent://poll?t=${encodeURIComponent(token)}` +
    `#Intent;scheme=intermap;package=${APP_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`
  )
}

// 앱이 없을 때 돌아올 웹 주소 — web=1이 붙어 있으면 다시 앱을 부르지 않는다
export function pollWebFallback(token: string): string {
  return `${window.location.origin}/?poll=${encodeURIComponent(token)}&web=1`
}

// 링크로 들어온 안드로이드 웹이면 앱을 한 번 불러 본다. 같은 투표는 이 탭에서 한 번만 (되돌아와 무한 반복 방지)
export function tryOpenPollInApp(token: string): void {
  if (!isAndroidWeb()) return
  if (new URLSearchParams(window.location.search).has('web')) return
  const key = `intermap.appTried.${token}`
  try {
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch {
    // 저장소를 못 쓰면 web=1 표시만으로 반복을 막는다
  }
  window.location.href = pollIntentUrl(token, pollWebFallback(token))
}
