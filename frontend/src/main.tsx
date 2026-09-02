import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// iOS Safari는 viewport meta의 user-scalable=no를 무시한다(접근성 정책).
// 페이지 핀치줌을 여기서 막는다 — 지도 줌은 지도 라이브러리가 touch 이벤트로 자체 처리해 영향 없음.
document.addEventListener('gesturestart', (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
