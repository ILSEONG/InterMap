import { useEffect, useRef, useState } from 'react'
import {
  checkNickname,
  login,
  oauthUrl,
  requestEmailCode,
  requestPhoneCode,
  signup,
  verifyEmailCode,
  verifyPhoneCode,
  linkSocial,
} from '../lib/api'
import type { AuthSession, SocialLink } from '../lib/api'
import { WORDMARK_COLORS } from './Header'
import './AuthModal.css'

// link: 소셜 로그인 직후, 아직 연결 안 된 우리 계정을 이메일+비밀번호로 증명해 연결하는 화면
export type AuthMode = 'login' | 'signup' | 'link'

// 각 provider 콘솔에 앱을 등록하고 CLIENT_ID/SECRET을 넣기 전까지는
// 서버가 /api/auth/oauth/{provider}에서 "아직 연결 안 됨" 에러로 돌려보낸다.
const SOCIAL_PROVIDERS = [
  { id: 'google', name: 'Google', label: 'Google로 계속하기' },
  { id: 'naver', name: '네이버', label: '네이버로 계속하기' },
  { id: 'kakao', name: '카카오', label: '카카오로 계속하기' },
] as const

interface Hint {
  text: string
  tone: 'ok' | 'error' | 'info'
}

// 인증번호 진행 단계: 발송 전 → 발송 중 → 발송됨(입력 대기) → 확인됨
type CodeStep = 'idle' | 'sending' | 'sent' | 'verified'

function makeCodeHandlers(
  step: CodeStep,
  setStep: (s: CodeStep) => void,
  setHint: (h: Hint | null) => void,
  request: () => Promise<string>,
  verify: () => Promise<string>,
) {
  return {
    send() {
      const wasSent = step !== 'idle'
      setStep('sending')
      setHint({ text: '인증번호 발송 중...', tone: 'info' })
      request()
        .then((message) => {
          setStep('sent')
          setHint({ text: message, tone: 'ok' })
        })
        .catch((err: Error) => {
          setStep(wasSent ? 'sent' : 'idle')
          setHint({ text: err.message, tone: 'error' })
        })
    },
    confirm() {
      verify()
        .then((message) => {
          setStep('verified')
          setHint({ text: message, tone: 'ok' })
        })
        .catch((err: Error) => setHint({ text: err.message, tone: 'error' }))
    },
  }
}

interface AuthModalProps {
  mode: AuthMode | null
  // mode가 'link'일 때: 소셜 로그인은 됐지만 아직 연결 안 된 계정의 서버 티켓. 이메일+비밀번호로 계정을 증명하면 연결된다.
  link?: SocialLink | null
  onClose: () => void
  onSwitch: (mode: AuthMode) => void
  onAuthed: (session: AuthSession) => void
}

export default function AuthModal({ mode, link, onClose, onSwitch, onAuthed }: AuthModalProps) {
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
  const [emailStep, setEmailStep] = useState<CodeStep>('idle')
  const [phoneStep, setPhoneStep] = useState<CodeStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 회원가입 성공 직후. 완료 화면을 덮어 보여주고 "시작하기"에서 onAuthed로 넘긴다.
  const [done, setDone] = useState<AuthSession | null>(null)

  // 모달을 열거나 로그인<->회원가입 전환 시 전부 초기화
  useEffect(() => {
    setError(null)
    setPassword('')
    setNickHint(null)
    setEmailHint(null)
    setPhoneHint(null)
    setEmailCode('')
    setPhoneCode('')
    setEmailStep('idle')
    setPhoneStep('idle')
    setDone(null)
    if (!open) {
      setEmail('')
      setNickname('')
      setPhone('')
    }
    // 계정 연결 화면은 provider가 알려준 이메일을 미리 채워준다 (수정 가능)
    if (open && shown === 'link' && link?.email) setEmail(link.email)
  }, [open, shown, link])

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

  // 발송/확인 버튼: 서버가 중복·불일치면 에러 메시지로 알려준다
  const emailField = makeCodeHandlers(
    emailStep, setEmailStep, setEmailHint,
    () => requestEmailCode(email),
    () => verifyEmailCode(email, emailCode),
  )
  const phoneField = makeCodeHandlers(
    phoneStep, setPhoneStep, setPhoneHint,
    () => requestPhoneCode(phone),
    () => verifyPhoneCode(phone, phoneCode),
  )
  const sendLabel = (step: CodeStep) =>
    step === 'sending' ? '발송 중' : step === 'idle' ? '인증번호 발송' : '재발송'
  const codeShown = (step: CodeStep) => step === 'sent' || step === 'verified'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const request =
      shown === 'login'
        ? login(email, password)
        : shown === 'link'
          ? linkSocial(link?.ticket ?? '', email, password)
          : signup({ email, emailCode, phone, phoneCode, password, nickname })
    request
      // 회원가입만 완료 화면을 한 번 보여주고, "시작하기"를 눌러야 로그인 상태로 넘어간다
      .then((session) => (shown === 'signup' ? setDone(session) : onAuthed(session)))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false))
  }

  const hintEl = (hint: Hint | null) =>
    hint && <p className={`auth-modal__hint auth-modal__hint--${hint.tone}`}>{hint.text}</p>

  return (
    <div className={`auth-overlay${open ? ' auth-overlay--open' : ''}`} onClick={onClose}>
      <div
        className={`auth-modal${done ? ' auth-modal--done' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={shown === 'login' ? '로그인' : shown === 'link' ? 'SNS 계정 연결' : '회원가입'}
      >
        {done && (
          <div className="auth-modal__done" role="status">
            <p className="auth-modal__done-icon" aria-hidden="true">🎉</p>
            <h2 className="auth-modal__title">회원가입 완료!</h2>
            <p className="auth-modal__desc">
              <b>{done.nickname}</b>님, 인터맵에 오신 걸 환영해요.
              <br />
              이제 후기를 남기고 친구들의 맛집을 볼 수 있어요.
            </p>
            <button type="button" className="auth-modal__submit" onClick={() => onAuthed(done)}>
              시작하기
            </button>
          </div>
        )}
        <h2 className="auth-modal__title">
          {shown === 'login' ? (
            '다시 만나서 반가워요'
          ) : shown === 'link' ? (
            'SNS 계정 연결하기'
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
        {shown === 'link' && (
          <p className="auth-modal__desc">
            아직 연결되지 않은 {SOCIAL_PROVIDERS.find((p) => p.id === link?.provider)?.name ?? 'SNS'} 계정이에요.
            가입한 이메일과 비밀번호로 로그인하면 이 계정과 연결되고, 다음부터는 바로 로그인돼요.
          </p>
        )}

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
                    <button
                      type="button"
                      className="auth-modal__send"
                      onClick={emailField.send}
                      disabled={!email || emailStep === 'sending' || emailStep === 'verified'}
                    >
                      {sendLabel(emailStep)}
                    </button>
                  </div>
                </div>
                {codeShown(emailStep) && (
                  <div className="auth-modal__row">
                    <div className="auth-modal__float">
                      <input
                        id="auth-email-code"
                        className="auth-modal__code"
                        type="text"
                        inputMode="numeric"
                        value={emailCode}
                        onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder=" "
                        disabled={emailStep === 'verified'}
                        required
                      />
                      <label htmlFor="auth-email-code">인증번호 6자리</label>
                    </div>
                    <button
                      type="button"
                      className="auth-modal__send"
                      onClick={emailField.confirm}
                      disabled={emailCode.length !== 6 || emailStep === 'verified'}
                    >
                      {emailStep === 'verified' ? '인증됨' : '확인'}
                    </button>
                  </div>
                )}
                {hintEl(emailHint)}
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
                    <button
                      type="button"
                      className="auth-modal__send"
                      onClick={phoneField.send}
                      disabled={!phone || phoneStep === 'sending' || phoneStep === 'verified'}
                    >
                      {sendLabel(phoneStep)}
                    </button>
                  </div>
                </div>
                {codeShown(phoneStep) && (
                  <div className="auth-modal__row">
                    <div className="auth-modal__float">
                      <input
                        id="auth-phone-code"
                        className="auth-modal__code"
                        type="text"
                        inputMode="numeric"
                        value={phoneCode}
                        onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder=" "
                        disabled={phoneStep === 'verified'}
                        required
                      />
                      <label htmlFor="auth-phone-code">인증번호 6자리</label>
                    </div>
                    <button
                      type="button"
                      className="auth-modal__send"
                      onClick={phoneField.confirm}
                      disabled={phoneCode.length !== 6 || phoneStep === 'verified'}
                    >
                      {phoneStep === 'verified' ? '인증됨' : '확인'}
                    </button>
                  </div>
                )}
                {hintEl(phoneHint)}
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
                    // 관리자 아이디(admin)는 이메일 형식이 아니라 브라우저 검증을 걸지 않는다
                    type="text"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder=" "
                    autoComplete="username"
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
          <button
            type="submit"
            className="auth-modal__submit"
            disabled={busy || (shown === 'signup' && (emailStep !== 'verified' || phoneStep !== 'verified'))}
          >
            {busy ? '잠시만요…' : shown === 'login' ? '로그인' : shown === 'link' ? '연결하고 로그인' : '가입하기'}
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
          {shown !== 'signup' ? (
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
