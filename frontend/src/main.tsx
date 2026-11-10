import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { queryClient, restoreQueryCache } from './lib/query'

// iOS Safari는 viewport meta의 user-scalable=no를 무시한다(접근성 정책).
// 페이지 핀치줌을 여기서 막는다 — 지도 줌은 지도 라이브러리가 touch 이벤트로 자체 처리해 영향 없음.
document.addEventListener('gesturestart', (e) => e.preventDefault())

// 안드로이드 앱(WebView) 표시 — index.css가 유리 블러를 끄고 불투명한 면으로 바꾼다
if (Capacitor.getPlatform() === 'android') document.documentElement.classList.add('platform-android')

// 첫 화면 글자가 기본 글꼴로 그려졌다가 웹폰트로 바뀌면 글자 폭이 달라져 칩·목록이 몇 px씩 흔들린다.
// (한글 웹폰트는 글자 묶음 파일 수십 개로 나뉘어 화면에 쓰인 글자의 묶음만 받는다.)
// 첫 화면에 쓰인 묶음이 다 올 때까지 가려 뒀다가 한 번에 보여 준다 — 최대 0.6초
const root = document.getElementById('root')!
root.style.visibility = 'hidden'
const reveal = () => {
  root.style.visibility = ''
}

// 기기에 남겨 둔 후기·스토리를 먼저 불러온 뒤 그린다 — 첫 화면부터 핀이 떠 있게 (최대 0.4초)
void restoreQueryCache().then(() => {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </QueryClientProvider>
    </StrictMode>,
  )
  // 그린 다음 프레임이면 첫 화면 글자들이 필요한 폰트 묶음을 이미 요청했다
  requestAnimationFrame(() => {
    void Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 600))]).finally(reveal)
  })
})
