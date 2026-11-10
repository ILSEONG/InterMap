import { useRef, useState } from 'react'
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
import './AuthModal.css'
import { FcGoogle } from 'react-icons/fc'
import { RiKakaoTalkFill } from 'react-icons/ri'
import { SiNaver } from 'react-icons/si'

// start: 소셜 버튼 + 이메일 입력. 이메일이 기존 회원이면 로그인, 아니면 가입으로 이어진다.
// social: 소셜 최초 인증 뒤 닉네임+약관만 받는 가입 화면
// link: 소셜 이메일과 같은 기존 계정을 인증번호로 연결하는 화면
export type AuthMode = 'start' | 'social' | 'link'

// 각 provider 콘솔에 앱을 등록하고 CLIENT_ID/SECRET을 넣기 전까지는
// 서버가 /api/auth/oauth/{provider}에서 "아직 연결 안 됨" 에러로 돌려보낸다.
// 시작 화면에는 시안 순서대로 네이버 → 카카오 → Google 순으로 놓는다
const SOCIAL_PROVIDERS = [
  { id: 'naver', name: '네이버' },
  { id: 'kakao', name: '카카오' },
  { id: 'google', name: 'Google' },
] as const

// 선 아이콘 공통 속성 (24 그리드, currentColor)
const STROKE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

const ICONS = {
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="3" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  code: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M7.5 12h.01M12 12h.01M16.5 12h.01" strokeWidth={3} />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20c.9-3.6 3.9-5.6 7.5-5.6s6.6 2 7.5 5.6" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5A1.5 1.5 0 0 1 7.5 3.5z" />
      <path d="M9.5 12.5l2 2 3.5-4" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  back: <path d="M15 5l-7 7 7 7" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16.2h.01" />
    </>
  ),
}

function Icon({ name, size = 20, strokeWidth = 2 }: { name: keyof typeof ICONS; size?: number; strokeWidth?: number }) {
  return (
    <svg {...STROKE} width={size} height={size} strokeWidth={strokeWidth}>
      {ICONS[name]}
    </svg>
  )
}

// 소셜 버튼 앞 로고 — 아이콘 라이브러리(react-icons)의 브랜드 로고.
// 네이버는 초록 네모 안 흰 N, 카카오는 노란 네모 안 검은 말풍선(각 사 로그인 버튼 안내 형태), Google은 컬러 G
function SocialIcon({ id }: { id: (typeof SOCIAL_PROVIDERS)[number]['id'] }) {
  if (id === 'naver') {
    return (
      <span className="auth-modal__social-icon auth-modal__social-icon--naver" aria-hidden="true">
        <SiNaver size={12} />
      </span>
    )
  }
  if (id === 'kakao') {
    return (
      <span className="auth-modal__social-icon auth-modal__social-icon--kakao" aria-hidden="true">
        <RiKakaoTalkFill size={18} />
      </span>
    )
  }
  return (
    <span className="auth-modal__social-icon" aria-hidden="true">
      <FcGoogle size={22} />
    </span>
  )
}

// 이메일 흐름 안의 단계. start → (password | code) → terms → nickname(+비밀번호) → done
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
  // 약관 '보기' — App이 약관 시트를 이 모달 위에 띄운다
  onOpenPolicy?: (page: 'terms' | 'privacy') => void
}

export default function AuthModal({ mode, social, onClose, onAuthed, onOpenPolicy }: AuthModalProps) {
  const open = mode !== null
  // 닫히는 애니메이션 동안 내용이 유지되도록 마지막 모드를 기억한다
  const lastModeRef = useRef<AuthMode>('start')
  if (mode) lastModeRef.current = mode
  const shown = mode ?? lastModeRef.current

  const [step, setStep] = useState<Step>('start')
  const [email, setEmail] = useState('')
  // 처음 화면에선 이메일 입력칸을 접어 두고 글자 링크만 — 누르면 펼친다
  const [emailOpen, setEmailOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [nickname, setNickname] = useState('')
  // 만 14세 미만은 법정대리인 동의가 필요해(개인정보보호법 제22조의2) 가입을 받지 않는다
  const [age, setAge] = useState(false)
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

  // 열 때(또는 열린 채로 화면 종류가 바뀔 때) 전부 초기화. 소셜 가입은 provider가 준 닉네임을 미리 채워준다 (수정 가능).
  // 닫을 때는 건드리지 않는다 — 닫히는 0.26초 동안 첫 화면으로 튀어 깜빡이지 않게.
  // 렌더 중에 맞춰서 여는 첫 프레임부터 깨끗한 화면이 나온다 (effect면 한 프레임 이전 화면이 보인다)
  const [resetFor, setResetFor] = useState<{ open: boolean; shown: typeof shown; social: typeof social } | null>(null)
  if (!resetFor || resetFor.open !== open || resetFor.shown !== shown || resetFor.social !== social) {
    setResetFor({ open, shown, social })
    if (open) {
      setStep('start')
      setEmailOpen(false)
      setPassword('')
      setCode('')
      setAge(false)
      setTerms(false)
      setPrivacy(false)
      setMarketing(false)
      setExisting(false)
      setCodeHint(null)
      setNickHint(null)
      setCodeSent(false)
      setError(null)
      setDone(null)
      setEmail(shown === 'link' ? (social?.email ?? '') : '')
      setNickname(shown === 'social' ? (social?.nickname ?? '') : '')
    }
  }

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

  // 이메일 조회: 기존 회원은 비밀번호로, 신규는 인증번호로. 소셜로만 가입한 계정은 그 버튼으로 안내.
  function continueWithEmail(e: React.FormEvent) {
    e.preventDefault()
    run(lookupEmail(email), ({ exists, hasPassword, provider: p }) => {
      setExisting(exists)
      if (exists && !hasPassword) {
        const name = SOCIAL_PROVIDERS.find((s) => s.id === p)?.name ?? 'SNS'
        setError(`${name}로 가입한 계정이에요. 위의 "${name}로 시작하기"를 눌러주세요.`)
        return
      }
      if (exists) {
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
      // 새 비밀번호 칸을 채웠으면 로그인하면서 비밀번호도 바꾼다
      run(loginWithCode(email, code, password || undefined), onAuthed)
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
        : signup({ email, emailCode: code, nickname, password, termsAgreed: true, marketingAgreed: marketing })
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

  const required = age && terms && privacy
  const allAgreed = required && marketing
  function toggleAll() {
    const next = !allAgreed
    setAge(next)
    setTerms(next)
    setPrivacy(next)
    setMarketing(next)
  }


  const hintEl = (hint: Hint | null) =>
    hint && <p className={`auth-modal__hint auth-modal__hint--${hint.tone}`}>{hint.text}</p>

  const errorEl = error && (
    <p className="auth-modal__error" role="alert">
      <Icon name="alert" size={18} />
      <span>{error}</span>
    </p>
  )

  // 아이콘 + 입력칸이 한 알약 안에 들어간 시안의 입력 필드. 라벨은 화면에선 숨기고 placeholder로 보여준다.
  const fieldBox = (icon: keyof typeof ICONS, id: string, label: string, input: React.ReactNode, extra = '') => (
    <div className={`auth-modal__input${extra}`}>
      <Icon name={icon} />
      <label htmlFor={id} className="auth-modal__sr">
        {label}
      </label>
      {input}
    </div>
  )

  // 단계 화면 머리: 아이콘 타일 + 제목 + 안내문
  const stepHead = (icon: keyof typeof ICONS, title: string, desc?: React.ReactNode) => (
    <div className="auth-modal__head">
      <span className="auth-modal__tile" aria-hidden="true">
        <Icon name={icon} size={28} strokeWidth={2.1} />
      </span>
      <h2 className="auth-modal__title">{title}</h2>
      {desc && <p className="auth-modal__desc">{desc}</p>}
    </div>
  )

  const backButton = (
    <button type="button" className="auth-modal__back" onClick={() => setStep('start')} aria-label="처음으로">
      <Icon name="back" size={22} strokeWidth={2.4} />
    </button>
  )

  const codeInput = fieldBox(
    'code',
    'auth-code',
    '인증번호 6자리',
    <input
      id="auth-code"
      className="auth-modal__code"
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
      placeholder="인증번호 6자리"
      autoFocus
      required
    />,
  )

  const resendButton = (
    <button type="button" className="auth-modal__link" onClick={sendCode}>
      인증번호 다시 받기
    </button>
  )

  const termsFields = (
    <div className="auth-modal__terms">
      <label className="auth-modal__check auth-modal__check--all">
        <input type="checkbox" checked={allAgreed} onChange={toggleAll} />
        <span>전체 동의</span>
      </label>
      <label className="auth-modal__check">
        <input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} required />
        <span>
          만 14세 이상이에요 <em>(필수)</em>
        </span>
      </label>
      <div className="auth-modal__check-row">
        <label className="auth-modal__check">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} required />
          <span>
            서비스 이용약관 동의 <em>(필수)</em>
          </span>
        </label>
        {onOpenPolicy && (
          <button type="button" className="auth-modal__view" onClick={() => onOpenPolicy('terms')} aria-label="서비스 이용약관 보기">
            보기
          </button>
        )}
      </div>
      <div className="auth-modal__check-row">
        <label className="auth-modal__check">
          <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} required />
          <span>
            개인정보 수집·이용 동의 <em>(필수)</em>
          </span>
        </label>
        {onOpenPolicy && (
          <button type="button" className="auth-modal__view" onClick={() => onOpenPolicy('privacy')} aria-label="개인정보처리방침 보기">
            보기
          </button>
        )}
      </div>
      <label className="auth-modal__check">
        <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        <span>
          새 소식·이벤트 알림 받기 <small>(선택)</small>
        </span>
      </label>
    </div>
  )

  const nicknameField = (
    <div className="auth-modal__field">
      {fieldBox(
        'user',
        'auth-nickname',
        '닉네임',
        <input
          id="auth-nickname"
          type="text"
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value)
            setNickHint(null)
          }}
          onBlur={blurNickname}
          placeholder="닉네임"
          maxLength={20}
          autoFocus
          required
        />,
      )}
      {hintEl(nickHint)}
    </div>
  )

  const submitLabel = (label: string) => (busy ? '잠시만요…' : label)

  function renderBody() {
    if (shown === 'social') {
      return (
        <>
          {stepHead('pin', '거의 다 됐어요!', `${provider} 계정으로 인터맵을 시작해요. 이웃들에게 보일 이름을 정해주세요.`)}
          <form className="auth-modal__form" onSubmit={submitSignup}>
            {nicknameField}
            {termsFields}
            {errorEl}
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
          {stepHead(
            'link',
            '이미 가입된 이메일이에요',
            <>
              <b>{email}</b>로 가입한 계정이 있어요. 인증번호로 본인 확인을 하면 {provider} 계정과 연결되고, 다음부터는
              바로 로그인돼요.
            </>,
          )}
          <form className="auth-modal__form" onSubmit={submitLink}>
            {codeSent ? (
              <div className="auth-modal__field">
                {codeInput}
                {hintEl(codeHint)}
                {resendButton}
              </div>
            ) : (
              hintEl(codeHint)
            )}
            {errorEl}
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
            {stepHead('lock', '다시 만나서 반가워요', email)}
            <form className="auth-modal__form" onSubmit={submitPassword}>
              <div className="auth-modal__field">
                {fieldBox(
                  'lock',
                  'auth-password',
                  '비밀번호',
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호"
                    autoComplete="current-password"
                    autoFocus
                    required
                  />,
                )}
              </div>
              {errorEl}
              <button type="submit" className="auth-modal__submit" disabled={busy}>
                {submitLabel('로그인')}
              </button>
              <button
                type="button"
                className="auth-modal__link"
                onClick={() => {
                  setError(null)
                  // 틀린 비밀번호가 다음 단계의 새 비밀번호 칸에 남지 않게
                  setPassword('')
                  setStep('code')
                  sendCode()
                }}
              >
                비밀번호를 잊으셨나요? 인증번호로 로그인
              </button>
            </form>
          </>
        )
      case 'code':
        return (
          <>
            {backButton}
            {stepHead(
              'mail',
              existing ? '인증번호로 로그인해요' : '이메일을 확인해주세요',
              <>
                <b>{email}</b>로 보낸 6자리 숫자를 입력해주세요.
              </>,
            )}
            <form className="auth-modal__form" onSubmit={submitCode}>
              <div className="auth-modal__field">
                {codeInput}
                {hintEl(codeHint)}
                {resendButton}
              </div>
              {existing && (
                <div className="auth-modal__field">
                  {fieldBox(
                    'lock',
                    'auth-new-password',
                    '새 비밀번호 (선택)',
                    <input
                      id="auth-new-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="새 비밀번호 (바꿀 때만, 8자 이상)"
                      autoComplete="new-password"
                      minLength={8}
                    />,
                  )}
                </div>
              )}
              {errorEl}
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
            {stepHead('doc', '시작하기 전에 확인해주세요')}
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
            {stepHead('user', '마지막이에요!', '이웃들에게 보일 이름과 로그인할 때 쓸 비밀번호를 정해주세요.')}
            <form className="auth-modal__form" onSubmit={submitSignup}>
              {nicknameField}
              <div className="auth-modal__field">
                {fieldBox(
                  'lock',
                  'auth-new-password',
                  '비밀번호 (8자 이상)',
                  <input
                    id="auth-new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="비밀번호 (8자 이상)"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />,
                )}
              </div>
              {errorEl}
              <button
                type="submit"
                className="auth-modal__submit"
                disabled={busy || !nickname.trim() || password.length < 8}
              >
                {submitLabel('가입 완료')}
              </button>
            </form>
          </>
        )
      default:
        return (
          <>
            <div className="auth-modal__hero">
              <span className="auth-modal__mark" aria-hidden="true">
                <Icon name="pin" size={32} strokeWidth={2.2} />
              </span>
              <h2 className="auth-modal__brand">인터맵</h2>
              <p className="auth-modal__tagline">
                이웃들이 다녀온 맛집,
                <br />
                지도에서 바로 확인해요.
              </p>
            </div>
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
                  <SocialIcon id={p.id} />
                  {p.name}로 시작하기
                </button>
              ))}
            </div>
            {!emailOpen && !email ? (
              <button type="button" className="auth-modal__email-link" onClick={() => setEmailOpen(true)}>
                이메일로 계속하기
              </button>
            ) : (
            <form className="auth-modal__form auth-modal__form--start" onSubmit={continueWithEmail}>
              {fieldBox(
                'mail',
                'auth-email',
                '이메일',
                <input
                  id="auth-email"
                  // 관리자 아이디(admin)는 이메일 형식이 아니라 브라우저 검증을 걸지 않는다
                  type="text"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="이메일 주소"
                  autoComplete="username"
                  autoFocus
                  required
                />,
              )}
              {errorEl}
              <button type="submit" className="auth-modal__submit" disabled={busy || !email.trim()}>
                {submitLabel('이메일로 계속하기')}
              </button>
            </form>
            )}
            <p className="auth-modal__foot">로그인 또는 회원가입</p>
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
            <span className="auth-modal__mark" aria-hidden="true">
              <Icon name="check" size={32} strokeWidth={2.6} />
            </span>
            <h2 className="auth-modal__title">가입 완료!</h2>
            <p className="auth-modal__desc">
              <b>{done.nickname}</b>님, 인터맵에 오신 걸 환영해요.
              <br />
              이제 후기를 남기고 이웃들의 맛집을 볼 수 있어요.
            </p>
            <button type="button" className="auth-modal__submit auth-modal__submit--accent" onClick={() => onAuthed(done)}>
              시작하기
            </button>
          </div>
        )}
        {renderBody()}
      </div>
    </div>
  )
}
