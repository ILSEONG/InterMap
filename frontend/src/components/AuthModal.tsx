import { useEffect, useRef, useState } from 'react'
import {
  checkNickname,
  login,
  loginWithCode,
  lookupEmail,
  oauthUrl,
  requestEmailCode,
  signup,
  signupSocial,
  verifyEmailCode,
  linkSocial,
} from '../lib/api'
import type { AuthSession, SocialTicket } from '../lib/api'
import { WORDMARK_COLORS } from './Header'
import './AuthModal.css'

// start: 소셜 버튼 + 이메일 입력. 이메일이 기존 회원이면 로그인, 아니면 가입으로 이어진다.
// social: 소셜 최초 인증 뒤 닉네임+약관만 받는 가입 화면
// link: 소셜 이메일과 같은 기존 계정을 인증번호로 연결하는 화면
export type AuthMode = 'start' | 'social' | 'link'

// 각 provider 콘솔에 앱을 등록하고 CLIENT_ID/SECRET을 넣기 전까지는
// 서버가 /api/auth/oauth/{provider}에서 "아직 연결 안 됨" 에러로 돌려보낸다.
const SOCIAL_PROVIDERS = [
  { id: 'google', name: 'Google', initial: 'G' },
  { id: 'naver', name: '네이버', initial: 'N' },
  { id: 'kakao', name: '카카오', initial: 'K' },
] as const

// 이메일 흐름 안의 단계. start → (password | code) → terms → nickname → done
type Step = 'start' | 'password' | 'code' | 'terms' | 'nickname'

interface Hint {
  text: string
  tone: 'ok' | 'error' | 'info'
}

interface AuthModalProps {
  mode: AuthMode | null
  // mode가 'social' | 'link'일 때 서버가 준 소셜 티켓
  social?: SocialTicket | null
  onClose: () => void
  onAuthed: (session: AuthSession) => void
}

export default function AuthModal({ mode, social, onClose, onAuthed }: AuthModalProps) {
  const open = mode !== null
  // 닫히는 애니메이션 동안 내용이 유지되도록 마지막 모드를 기억한다
  const lastModeRef = useRef<AuthMode>('start')
  if (mode) lastModeRef.current = mode
  const shown = mode ?? lastModeRef.current

  const [step, setStep] = useState<Step>('start')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [marketing, setMarketing] = useState(false)
  // 이메일 조회 결과. 인증번호가 맞았을 때 로그인할지 가입으로 넘어갈지 가른다.
  const [existing, setExisting] = useState(false)
  // 인증번호 발송/재발송 안내와 닉네임 중복 안내
  const [codeHint, setCodeHint] = useState<Hint | null>(null)
  const [nickHint, setNickHint] = useState<Hint | null>(null)
  const [codeSent, setCodeSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 가입 성공 직후. 완료 화면을 보여주고 "시작하기"에서 onAuthed로 넘긴다.
  const [done, setDone] = useState<AuthSession | null>(null)

  const provider = SOCIAL_PROVIDERS.find((p) => p.id === social?.provider)?.name ?? 'SNS'

  // 열고 닫을 때 전부 초기화. 소셜 가입은 provider가 준 닉네임을 미리 채워준다 (수정 가능)
  useEffect(() => {
    setStep('start')
    setPassword('')
    setCode('')
    setTerms(false)
    setPrivacy(false)
    setMarketing(false)
    setExisting(false)
    setCodeHint(null)
    setNickHint(null)
    setCodeSent(false)
    setError(null)
    setDone(null)
    setEmail(open && shown === 'link' ? (social?.email ?? '') : '')
    setNickname(open && shown === 'social' ? (social?.nickname ?? '') : '')
  }, [open, shown, social])

  function run<T>(request: Promise<T>, then: (value: T) => void) {
    if (busy) return
    setBusy(true)
    setError(null)
    request
      .then(then)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false))
  }

  function sendCode() {
    setCodeHint({ text: '인증번호 발송 중...', tone: 'info' })
    return requestEmailCode(email)
      .then((message) => {
        setCodeSent(true)
        setCodeHint({ text: message, tone: 'ok' })
      })
      .catch((err: Error) => setCodeHint({ text: err.message, tone: 'error' }))
  }

  // 이메일 조회: 옛 계정(비밀번호 있음)은 비밀번호로, 그 외 기존 회원과 신규는 인증번호로
  function continueWithEmail(e: React.FormEvent) {
    e.preventDefault()
    run(lookupEmail(email), ({ exists, hasPassword }) => {
      setExisting(exists)
      if (exists && hasPassword) {
        setStep('password')
        return
      }
      setStep('code')
      sendCode()
    })
  }

  function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    run(login(email, password), onAuthed)
  }

  function submitCode(e: React.FormEvent) {
    e.preventDefault()
    if (existing) {
      run(loginWithCode(email, code), onAuthed)
    } else {
      run(verifyEmailCode(email, code), () => setStep('terms'))
    }
  }

  function submitLink(e: React.FormEvent) {
    e.preventDefault()
    run(linkSocial(social?.ticket ?? '', code), onAuthed)
  }

  function submitSignup(e: React.FormEvent) {
    e.preventDefault()
    const request =
      shown === 'social'
        ? signupSocial(social?.ticket ?? '', nickname, marketing)
        : signup({ email, emailCode: code, nickname, termsAgreed: true, marketingAgreed: marketing })
    run(request, setDone)
  }

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

  const required = terms && privacy
  const allAgreed = required && marketing
  function toggleAll() {
    const next = !allAgreed
    setTerms(next)
    setPrivacy(next)
    setMarketing(next)
  }

  const hintEl = (hint: Hint | null) =>
    hint && <p className={`auth-modal__hint auth-modal__hint--${hint.tone}`}>{hint.text}</p>

  const brand = (
    <span className="auth-modal__brand">
      {['인', '터', '맵'].map((letter, i) => (
        <span key={i} style={{ color: WORDMARK_COLORS[i % WORDMARK_COLORS.length] }}>
          {letter}
        </span>
      ))}
    </span>
  )

  const backButton = (
    <button type="button" className="auth-modal__back" onClick={() => setStep('start')} aria-label="처음으로">
      ←
    </button>
  )

  const codeInput = (
    <div className="auth-modal__float">
      <input
        id="auth-code"
        className="auth-modal__code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder=" "
        autoFocus
        required
      />
      <label htmlFor="auth-code">인증번호 6자리</label>
    </div>
  )

  const termsFields = (
    <div className="auth-modal__terms">
      <label className="auth-modal__check auth-modal__check--all">
        <input type="checkbox" checked={allAgreed} onChange={toggleAll} />
        <span>전체 동의</span>
      </label>
      <label className="auth-modal__check">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} required />
        <span>
          서비스 이용약관 동의 <em>(필수)</em>
        </span>
      </label>
      <label className="auth-modal__check">
        <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} required />
        <span>
          개인정보 수집·이용 동의 <em>(필수)</em>
        </span>
      </label>
      <label className="auth-modal__check">
        <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        <span>새 소식·이벤트 알림 받기 (선택)</span>
      </label>
    </div>
  )

  const nicknameField = (
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
          autoFocus
          required
        />
        <label htmlFor="auth-nickname">닉네임</label>
      </div>
      {hintEl(nickHint)}
    </div>
  )

  const submitLabel = (label: string) => (busy ? '잠시만요…' : label)

  function renderBody() {
    if (shown === 'social') {
      return (
        <>
          <h2 className="auth-modal__title">거의 다 됐어요!</h2>
          <p className="auth-modal__desc">{provider} 계정으로 인터맵을 시작해요. 친구들에게 보일 이름을 정해주세요.</p>
          <form className="auth-modal__form" onSubmit={submitSignup}>
            {nicknameField}
            {termsFields}
            {error && <p className="auth-modal__error">{error}</p>}
            <button type="submit" className="auth-modal__submit" disabled={busy || !required || !nickname.trim()}>
              {submitLabel('시작하기')}
            </button>
          </form>
        </>
      )
    }

    if (shown === 'link') {
      return (
        <>
          <h2 className="auth-modal__title">이미 가입된 이메일이에요</h2>
          <p className="auth-modal__desc">
            <b>{email}</b>로 가입한 계정이 있어요. 인증번호로 본인 확인을 하면 {provider} 계정과 연결되고, 다음부터는 바로
            로그인돼요.
          </p>
          <form className="auth-modal__form" onSubmit={submitLink}>
            {codeSent ? (
              <div className="auth-modal__field">
                {codeInput}
                {hintEl(codeHint)}
                <button type="button" className="auth-modal__link" onClick={sendCode}>
                  인증번호 다시 받기
                </button>
              </div>
            ) : (
              hintEl(codeHint)
            )}
            {error && <p className="auth-modal__error">{error}</p>}
            {codeSent ? (
              <button type="submit" className="auth-modal__submit" disabled={busy || code.length !== 6}>
                {submitLabel('연결하고 로그인')}
              </button>
            ) : (
              <button type="button" className="auth-modal__submit" onClick={sendCode}>
                인증번호 받기
              </button>
            )}
          </form>
        </>
      )
    }

    switch (step) {
      case 'password':
        return (
          <>
            {backButton}
            <h2 className="auth-modal__title">다시 만나서 반가워요</h2>
            <p className="auth-modal__desc">{email}</p>
            <form className="auth-modal__form" onSubmit={submitPassword}>
              <div className="auth-modal__field">
                <div className="auth-modal__float">
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder=" "
                    autoComplete="current-password"
                    autoFocus
                    required
                  />
                  <label htmlFor="auth-password">비밀번호</label>
                </div>
              </div>
              {error && <p className="auth-modal__error">{error}</p>}
              <button type="submit" className="auth-modal__submit" disabled={busy}>
                {submitLabel('로그인')}
              </button>
              <button
                type="button"
                className="auth-modal__link"
                onClick={() => {
                  setError(null)
                  setStep('code')
                  sendCode()
                }}
              >
                비밀번호 대신 이메일 인증번호로 로그인
              </button>
            </form>
          </>
        )
      case 'code':
        return (
          <>
            {backButton}
            <h2 className="auth-modal__title">{existing ? '인증번호로 로그인해요' : '이메일을 확인해주세요'}</h2>
            <p className="auth-modal__desc">
              <b>{email}</b>로 보낸 6자리 숫자를 입력해주세요.
            </p>
            <form className="auth-modal__form" onSubmit={submitCode}>
              <div className="auth-modal__field">
                {codeInput}
                {hintEl(codeHint)}
                <button type="button" className="auth-modal__link" onClick={sendCode}>
                  인증번호 다시 받기
                </button>
              </div>
              {error && <p className="auth-modal__error">{error}</p>}
              <button type="submit" className="auth-modal__submit" disabled={busy || code.length !== 6}>
                {submitLabel(existing ? '로그인' : '다음')}
              </button>
            </form>
          </>
        )
      case 'terms':
        return (
          <>
            {backButton}
            <h2 className="auth-modal__title">시작하기 전에 확인해주세요</h2>
            <form
              className="auth-modal__form"
              onSubmit={(e) => {
                e.preventDefault()
                setStep('nickname')
              }}
            >
              {termsFields}
              <button type="submit" className="auth-modal__submit" disabled={!required}>
                다음
              </button>
            </form>
          </>
        )
      case 'nickname':
        return (
          <>
            {backButton}
            <h2 className="auth-modal__title">어떻게 불러드릴까요?</h2>
            <p className="auth-modal__desc">친구들에게 보일 이름이에요.</p>
            <form className="auth-modal__form" onSubmit={submitSignup}>
              {nicknameField}
              {error && <p className="auth-modal__error">{error}</p>}
              <button type="submit" className="auth-modal__submit" disabled={busy || !nickname.trim()}>
                {submitLabel('가입 완료')}
              </button>
            </form>
          </>
        )
      default:
        return (
          <>
            <h2 className="auth-modal__title auth-modal__title--brand">{brand}</h2>
            <p className="auth-modal__desc">친구들이 다녀온 맛집, 지도에서 바로 확인해요.</p>
            <div className="auth-modal__social">
              {SOCIAL_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`auth-modal__social-btn auth-modal__social-btn--${p.id}`}
                  onClick={() => {
                    window.location.href = oauthUrl(p.id)
                  }}
                >
                  <span className="auth-modal__social-icon" aria-hidden="true">
                    {p.initial}
                  </span>
                  {p.name}로 계속하기
                </button>
              ))}
            </div>
            <div className="auth-modal__divider">
              <span>또는</span>
            </div>
            <form className="auth-modal__form" onSubmit={continueWithEmail}>
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
              {error && <p className="auth-modal__error">{error}</p>}
              <button type="submit" className="auth-modal__submit" disabled={busy || !email.trim()}>
                {submitLabel('이메일로 계속하기')}
              </button>
            </form>
          </>
        )
    }
  }

  return (
    <div className={`auth-overlay${open ? ' auth-overlay--open' : ''}`} onClick={onClose}>
      <div
        className={`auth-modal${done ? ' auth-modal--done' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="로그인 또는 회원가입"
      >
        {done && (
          <div className="auth-modal__done" role="status">
            <p className="auth-modal__done-icon" aria-hidden="true">🎉</p>
            <h2 className="auth-modal__title">가입 완료!</h2>
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
        {renderBody()}
      </div>
    </div>
  )
}
