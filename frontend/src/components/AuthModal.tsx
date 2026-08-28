import { useEffect, useRef, useState } from 'react'
import { login, signup } from '../lib/api'
import type { AuthSession } from '../lib/api'
import './AuthModal.css'

export type AuthMode = 'login' | 'signup'

interface AuthModalProps {
  mode: AuthMode | null
  onClose: () => void
  onSwitch: (mode: AuthMode) => void
  onAuthed: (session: AuthSession) => void
}

// 간편 로그인은 각 플랫폼 콘솔에 앱을 등록해야 열 수 있다.
// 등록 후 BE OAuth 연동이 붙으면 authorizeUrl로 이동시키는 구조.
const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google로 계속하기' },
  { id: 'naver', label: '네이버로 계속하기' },
  { id: 'kakao', label: '카카오로 계속하기' },
] as const

export default function AuthModal({ mode, onClose, onSwitch, onAuthed }: AuthModalProps) {
  const open = mode !== null
  // 닫히는 애니메이션 동안 내용이 유지되도록 마지막 모드를 기억한다
  const lastModeRef = useRef<AuthMode>('login')
  if (mode) lastModeRef.current = mode
  const shown = mode ?? lastModeRef.current

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 모달을 열거나 로그인<->회원가입 전환 시 입력·에러 초기화
  useEffect(() => {
    setError(null)
    setPassword('')
    if (!open) {
      setEmail('')
      setNickname('')
    }
  }, [open, shown])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const request = shown === 'login' ? login(email, password) : signup(email, password, nickname)
    request
      .then(onAuthed)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className={`auth-overlay${open ? ' auth-overlay--open' : ''}`} onClick={onClose}>
      <div
        className="auth-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={shown === 'login' ? '로그인' : '회원가입'}
      >
        <h2 className="auth-modal__title">{shown === 'login' ? '다시 만나서 반가워요' : '인터맵에 어서오세요'}</h2>

        <form className="auth-modal__form" onSubmit={submit}>
          {shown === 'signup' && (
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="닉네임"
              maxLength={20}
              required
              aria-label="닉네임"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            autoComplete="email"
            required
            aria-label="이메일"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={shown === 'signup' ? '비밀번호 (8자 이상)' : '비밀번호'}
            autoComplete={shown === 'signup' ? 'new-password' : 'current-password'}
            minLength={shown === 'signup' ? 8 : undefined}
            required
            aria-label="비밀번호"
          />
          {error && <p className="auth-modal__error">{error}</p>}
          <button type="submit" className="auth-modal__submit" disabled={busy}>
            {busy ? '잠시만요…' : shown === 'login' ? '로그인' : '가입하기'}
          </button>
        </form>

        {shown === 'login' && (
          <>
            <div className="auth-modal__divider">
              <span>또는</span>
            </div>
            <div className="auth-modal__social">
              {SOCIAL_PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className={`auth-modal__social-btn auth-modal__social-btn--${provider.id}`}
                  onClick={() => setError('간편 로그인은 준비 중이에요. 이메일로 로그인해주세요.')}
                >
                  {provider.label}
                </button>
              ))}
            </div>
          </>
        )}

        <p className="auth-modal__switch">
          {shown === 'login' ? (
            <>
              아직 계정이 없나요?{' '}
              <button type="button" onClick={() => onSwitch('signup')}>
                회원가입
              </button>
            </>
          ) : (
            <>
              이미 계정이 있나요?{' '}
              <button type="button" onClick={() => onSwitch('login')}>
                로그인
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
