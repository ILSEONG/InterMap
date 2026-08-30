import { useEffect, useRef, useState } from 'react'
import { checkNickname, login, oauthUrl, requestEmailCode, requestPhoneCode, signup } from '../lib/api'
import type { AuthSession } from '../lib/api'
import { WORDMARK_COLORS } from './Header'
import './AuthModal.css'

export type AuthMode = 'login' | 'signup'

// 각 provider 콘솔에 앱을 등록하고 CLIENT_ID/SECRET을 넣기 전까지는
// 서버가 /api/auth/oauth/{provider}에서 "아직 연결 안 됨" 에러로 돌려보낸다.
const SOCIAL_PROVIDERS = [
  { id: 'google', label: 'Google로 계속하기' },
  { id: 'naver', label: '네이버로 계속하기' },
  { id: 'kakao', label: '카카오로 계속하기' },
] as const

interface Hint {
  text: string
  tone: 'ok' | 'error'
}

interface AuthModalProps {
  mode: AuthMode | null
  onClose: () => void
  onSwitch: (mode: AuthMode) => void
  onAuthed: (session: AuthSession) => void
}

export default function AuthModal({ mode, onClose, onSwitch, onAuthed }: AuthModalProps) {
  const open = mode !== null
  // 닫히는 애니메이션 동안 내용이 유지되도록 마지막 모드를 기억한다
  const lastModeRef = useRef<AuthMode>('login')
  if (mode) lastModeRef.current = mode
  const shown = mode ?? lastModeRef.current

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [phone, setPhone] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  // 각 필드 밑에 붙는 작은 안내 (중복 여부, 발송 결과)
  const [nickHint, setNickHint] = useState<Hint | null>(null)
  const [emailHint, setEmailHint] = useState<Hint | null>(null)
  const [phoneHint, setPhoneHint] = useState<Hint | null>(null)
  const [emailSent, setEmailSent] = useState(false)
  const [phoneSent, setPhoneSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // 모달을 열거나 로그인<->회원가입 전환 시 전부 초기화
  useEffect(() => {
    setError(null)
    setPassword('')
    setNickHint(null)
    setEmailHint(null)
    setPhoneHint(null)
    setEmailCode('')
    setPhoneCode('')
    setEmailSent(false)
    setPhoneSent(false)
    if (!open) {
      setEmail('')
      setNickname('')
      setPhone('')
    }
  }, [open, shown])

  // 닉네임 칸을 떠날 때 중복 확인
  function blurNickname() {
    const value = nickname.trim()
    if (!value) {
      setNickHint(null)
      return
    }
    checkNickname(value)
      .then((available) =>
        setNickHint(
          available
            ? { text: '사용할 수 있는 닉네임이에요.', tone: 'ok' }
            : { text: '이미 사용 중인 닉네임이에요.', tone: 'error' },
        ),
      )
      .catch(() => setNickHint(null))
  }

  // 발송 버튼: 서버가 중복이면 에러 메시지로 알려준다
  function sendEmailCode() {
    setEmailHint(null)
    requestEmailCode(email)
      .then((message) => {
        setEmailSent(true)
        setEmailHint({ text: message, tone: 'ok' })
      })
      .catch((err: Error) => setEmailHint({ text: err.message, tone: 'error' }))
  }

  function sendPhoneCode() {
    setPhoneHint(null)
    requestPhoneCode(phone)
      .then((message) => {
        setPhoneSent(true)
        setPhoneHint({ text: message, tone: 'ok' })
      })
      .catch((err: Error) => setPhoneHint({ text: err.message, tone: 'error' }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const request =
      shown === 'login'
        ? login(email, password)
        : signup({ email, emailCode, phone, phoneCode, password, nickname })
    request
      .then(onAuthed)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false))
  }

  const hintEl = (hint: Hint | null) =>
    hint && <p className={`auth-modal__hint auth-modal__hint--${hint.tone}`}>{hint.text}</p>

  return (
    <div className={`auth-overlay${open ? ' auth-overlay--open' : ''}`} onClick={onClose}>
      <div
        className="auth-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={shown === 'login' ? '로그인' : '회원가입'}
      >
        <h2 className="auth-modal__title">
          {shown === 'login' ? (
            '다시 만나서 반가워요'
          ) : (
            <>
              <span className="auth-modal__brand">
                {['인', '터', '맵'].map((letter, i) => (
                  <span key={i} style={{ color: WORDMARK_COLORS[i % WORDMARK_COLORS.length] }}>
                    {letter}
                  </span>
                ))}
              </span>
              에 어서오세요
            </>
          )}
        </h2>

        <form className="auth-modal__form" onSubmit={submit}>
          {shown === 'signup' ? (
            <>
              <div className="auth-modal__field">
                <div className="auth-modal__float">
                  <input
                    id="auth-nickname"
                    type="text"
                    value={nickname}
                    onChange={(e) => {
                      setNickname(e.target.value)
                      setNickHint(null)
                    }}
                    onBlur={blurNickname}
                    placeholder=" "
                    maxLength={20}
                    required
                  />
                  <label htmlFor="auth-nickname">닉네임</label>
                </div>
                {hintEl(nickHint)}
              </div>

              {/* 이메일과 그 인증번호는 한 덩어리로 묶어 보여준다 */}
              <div className="auth-modal__group">
                <div className="auth-modal__field">
                  <div className="auth-modal__row">
                    <div className="auth-modal__float">
                      <input
                        id="auth-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder=" "
                        autoComplete="email"
                        required
                      />
                      <label htmlFor="auth-email">이메일</label>
                    </div>
                    <button type="button" className="auth-modal__send" onClick={sendEmailCode} disabled={!email}>
                      {emailSent ? '재발송' : '인증번호 발송'}
                    </button>
                  </div>
                  {hintEl(emailHint)}
                </div>
                {emailSent && (
                  <div className="auth-modal__float">
                    <input
                      id="auth-email-code"
                      className="auth-modal__code"
                      type="text"
                      inputMode="numeric"
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder=" "
                      required
                    />
                    <label htmlFor="auth-email-code">인증번호 6자리</label>
                  </div>
                )}
              </div>

              <div className="auth-modal__group">
                <div className="auth-modal__field">
                  <div className="auth-modal__row">
                    <div className="auth-modal__float">
                      <input
                        id="auth-phone"
                        type="tel"
                        inputMode="numeric"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                        placeholder=" "
                        autoComplete="tel"
                        required
                      />
                      <label htmlFor="auth-phone">휴대폰 번호</label>
                    </div>
                    <button type="button" className="auth-modal__send" onClick={sendPhoneCode} disabled={!phone}>
                      {phoneSent ? '재발송' : '인증번호 발송'}
                    </button>
                  </div>
                  {hintEl(phoneHint)}
                </div>
                {phoneSent && (
                  <div className="auth-modal__float">
                    <input
                      id="auth-phone-code"
                      className="auth-modal__code"
                      type="text"
                      inputMode="numeric"
                      value={phoneCode}
                      onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder=" "
                      required
                    />
                    <label htmlFor="auth-phone-code">인증번호 6자리</label>
                  </div>
                )}
              </div>

              <div className="auth-modal__field">
                <div className="auth-modal__float">
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder=" "
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                  <label htmlFor="auth-password">비밀번호 (8자 이상)</label>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="auth-modal__field">
                <div className="auth-modal__float">
                  <input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder=" "
                    autoComplete="email"
                    required
                  />
                  <label htmlFor="auth-email">이메일</label>
                </div>
              </div>
              <div className="auth-modal__field">
                <div className="auth-modal__float">
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder=" "
                    autoComplete="current-password"
                    required
                  />
                  <label htmlFor="auth-password">비밀번호</label>
                </div>
              </div>
            </>
          )}
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
                  onClick={() => {
                    window.location.href = oauthUrl(provider.id)
                  }}
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
