import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import './ErrorBoundary.css'

interface ErrorBoundaryProps {
  children: ReactNode
}

// 화면 어딘가에서 렌더 오류가 나면 앱 전체가 하얗게 비는 대신 다시 시도할 수 있는 안내를 띄운다.
// 저장된 로그인·투표 담기는 localStorage에 있어 새로고침해도 그대로다.
export default class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[InterMap] 화면 오류', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="error-boundary" role="alert">
        <p className="error-boundary__title">화면을 그리다 문제가 생겼어요</p>
        <p className="error-boundary__text">다시 불러오면 대부분 해결돼요. 로그인은 그대로 남아 있어요.</p>
        <button type="button" className="error-boundary__btn" onClick={() => window.location.reload()}>
          다시 불러오기
        </button>
      </div>
    )
  }
}
