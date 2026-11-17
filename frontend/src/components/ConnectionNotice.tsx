import { useEffect } from 'react'
import { refreshAll } from '../lib/query'
import { useUnreachable } from '../lib/reach'
import './ConnectionNotice.css'

// 서버에 연결하지 못할 때 위쪽에 뜨는 알림. 연결되면 스스로 사라진다.
// 받아 둔 내용은 그대로 보이므로 화면을 막지 않고, 왜 새 내용이 안 뜨는지만 알려 준다
export default function ConnectionNotice() {
  const unreachable = useUnreachable()

  // 인터넷이 돌아오면 바로 다시 받아 본다 — 성공하면 알림이 사라진다
  useEffect(() => {
    if (!unreachable) return
    window.addEventListener('online', refreshAll)
    return () => window.removeEventListener('online', refreshAll)
  }, [unreachable])

  if (!unreachable) return null
  return (
    <div className="connection-notice" role="status">
      <span>서버에 연결하지 못했어요</span>
      <button type="button" className="connection-notice__retry" onClick={refreshAll}>
        다시 시도
      </button>
    </div>
  )
}
