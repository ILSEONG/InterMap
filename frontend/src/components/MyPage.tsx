import { useDeferredValue, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthSession, BlockedPerson, Person, SocialData, UserItem } from '../lib/api'
import {
  changeNickname,
  followUser,
  unfollowUser,
  searchUsers,
  uploadAvatar,
  deleteAvatar,
  fetchBlocks,
  unblockUser,
  fetchMyPolls,
} from '../lib/api'
import type { PollSummary } from '../lib/api'
import { kstMonth, monthLabel, timeLeft } from '../lib/time'
import { useOpenProfile } from '../lib/openProfile'
import { shrinkImage } from '../lib/image'
import type { Review } from '../data/model'
import Avatar from './Avatar'
import type { PolicyPage } from './PolicyViewer'
import './MyPage.css'

interface MyPageProps {
  open: boolean
  session: AuthSession
  // 팔로잉·팔로워·별칭. App이 로그인 시 받아 두고, 여기서 바꾸면 돌려준다 (후기 이름에 별칭을 씌우는 데도 쓴다)
  social: SocialData | null
  onSocialChange: (next: SocialData) => void
  // 닉네임을 바꾸면 새 세션(localStorage 포함)으로 갱신
  onSessionChange: (next: AuthSession) => void
  // 내가 쓴 후기 전부, 최신순
  myReviews: Review[]
  // 후기를 누르면 그 가게 시트를 연다
  onOpenReview: (review: Review) => void
  // 차단을 풀면 — App이 후기·댓글을 다시 받는다
  onBlocksChange: () => void
  // 회원 탈퇴. 성공하면 App이 로그아웃 상태로 돌리고 이 화면을 닫는다
  onDeleteAccount: () => Promise<void>
  onOpenPolicy: (page: PolicyPage) => void
  // 운영자(주인장)면 신고 관리 화면으로 가는 버튼
  isAdmin: boolean
  onOpenReports: () => void
  // 월간 결산 · 투표 화면 열기 (App이 띄운다)
  onOpenRecap: () => void
  onOpenPoll: (token: string) => void
  // 투표를 만들거나 지우면 App이 올린다 — 목록을 다시 받는다
  pollVersion: number
  onClose: () => void
}

const MIN_SEARCH_LENGTH = 1

// 아바타 바탕색 4가지 — 사람마다 id로 고정해서 목록에서 구분되게 한다
const toneOf = (id: number) => `tone-${Math.abs(id) % 4}`

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export default function MyPage({
  open,
  session,
  social,
  onSocialChange,
  onSessionChange,
  myReviews,
  onOpenReview,
  onBlocksChange,
  onDeleteAccount,
  onOpenPolicy,
  isAdmin,
  onOpenReports,
  onOpenRecap,
  onOpenPoll,
  pollVersion,
  onClose,
}: MyPageProps) {
  // 사람을 누르면 그 사람 프로필 개요 (App이 컨텍스트로 내려준다)
  const openProfile = useOpenProfile()
  const [nickname, setNickname] = useState(session.nickname)
  const [nicknameMsg, setNicknameMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [found, setFound] = useState<UserItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 화면 가운데 2초 토스트 (언팔로우 확인용)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number>(undefined)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  // 차단한 사용자 — 펼칠 때 받는다
  const [blocksOpen, setBlocksOpen] = useState(false)
  const [blocked, setBlocked] = useState<BlockedPerson[] | null>(null)
  // 내가 만들었거나 참여한 투표 — 열릴 때 받는다
  const [polls, setPolls] = useState<PollSummary[] | null>(null)
  // 회원 탈퇴 확인 단계
  const [leaving, setLeaving] = useState(false)
  const [leaveChecked, setLeaveChecked] = useState(false)
  function showToast(text: string) {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1500)
  }

  // 열릴 때마다 입력값을 현재 세션 기준으로 되돌린다
  useEffect(() => {
    if (!open) return
    setNickname(session.nickname)
    setNicknameMsg(null)
    setQuery('')
    setError(null)
    setBlocksOpen(false)
    setBlocked(null)
    setLeaving(false)
    setLeaveChecked(false)
  }, [open, session.nickname])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchMyPolls()
      .then((list) => !cancelled && setPolls(list))
      .catch(() => !cancelled && setPolls([]))
    return () => {
      cancelled = true
    }
  }, [open, pollVersion])

  useEffect(() => {
    if (!open || !blocksOpen || blocked) return
    let cancelled = false
    fetchBlocks()
      .then((list) => {
        if (!cancelled) setBlocked(list)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [open, blocksOpen, blocked])

  // 닉네임 검색 — 팔로우할 사람 찾기
  useEffect(() => {
    const keyword = deferredQuery.trim()
    if (!open || keyword.length < MIN_SEARCH_LENGTH) {
      setFound([])
      return
    }
    let cancelled = false
    searchUsers(keyword)
      .then((list) => {
        if (!cancelled) setFound(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open, deferredQuery])

  if (!open) return null

  const followingIds = new Set((social?.following ?? []).map((p) => p.id))

  // 내 후기는 별점 높은 순으로, 같은 별점끼리는 받은 순서(최신순) 유지
  const sortedReviews = [...myReviews].sort((a, b) => b.rating - a.rating)

  // 저장 버튼은 닉네임을 고쳤을 때만 입력칸 안에 나타난다
  const nicknameDirty = !!nickname.trim() && nickname.trim() !== session.nickname

  // 서버 호출 공통 — 실패 메시지는 화면 위쪽에, 성공 안내(doneMsg)는 가운데 토스트로
  async function run(task: Promise<SocialData>, doneMsg?: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onSocialChange(await task)
      if (doneMsg) showToast(doneMsg)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function saveNickname() {
    const next = nickname.trim()
    if (!next || busy) return
    setBusy(true)
    setNicknameMsg(null)
    try {
      onSessionChange(await changeNickname(next))
      setNicknameMsg({ ok: true, text: '닉네임을 바꿨어요.' })
    } catch (e) {
      setNicknameMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  // 프로필 사진. 512px JPEG로 줄여 올리고, 돌아온 새 경로(?v= 갱신)로 세션을 바꾼다
  async function changeAvatar(file: File | undefined) {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    try {
      const avatar = await uploadAvatar(await shrinkImage(file, 512, 0.85))
      onSessionChange({ ...session, avatar })
      showToast('프로필 사진을 바꿨어요')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function unblock(person: BlockedPerson) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setBlocked(await unblockUser(person.id))
      onBlocksChange()
      showToast(`${person.nickname}님 차단을 풀었어요`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function leave() {
    if (!leaveChecked || busy) return
    setBusy(true)
    setError(null)
    try {
      await onDeleteAccount()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  async function removeAvatar() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteAvatar()
      onSessionChange({ ...session, avatar: null })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="my-page-layer">
      <div className="my-page" role="dialog" aria-label="마이페이지">
        <header className="my-page__header">
          <h2 className="my-page__title">마이페이지</h2>
          <button type="button" className="my-page__close" onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </header>

        <div className="my-page__scroll">
          {error && (
            <p className="my-page__error" role="alert">
              {error}
            </p>
          )}

          <section className="my-page__profile" aria-label="프로필">
            <Avatar className="my-page__avatar my-page__avatar--me" src={session.avatar} name={session.nickname} />
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void changeAvatar(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <div className="my-page__profile-main">
              <div className="my-page__field">
                <label htmlFor="my-page-nickname" className="my-page__field-label">
                  닉네임
                </label>
                <input
                  id="my-page-nickname"
                  className="my-page__nickname-input"
                  type="text"
                  value={nickname}
                  maxLength={20}
                  onChange={(e) => setNickname(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveNickname()}
                  enterKeyHint="done"
                  autoComplete="off"
                />
                {nicknameDirty && (
                  <button type="button" className="my-page__save" onClick={saveNickname} disabled={busy}>
                    저장
                  </button>
                )}
              </div>
              {nicknameMsg && (
                <p className={`my-page__hint my-page__hint--field${nicknameMsg.ok ? '' : ' my-page__hint--error'}`} role="status">
                  {nicknameMsg.text}
                </p>
              )}
              <div className="my-page__photo-actions">
                <button
                  type="button"
                  className="my-page__photo-change"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={busy}
                >
                  <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                    <circle cx="12" cy="13" r="3.5" />
                  </svg>
                  {session.avatar ? '프로필 사진 바꾸기' : '프로필 사진 올리기'}
                </button>
                {session.avatar && (
                  <button type="button" className="my-page__photo-remove" onClick={removeAvatar} disabled={busy} aria-label="사진 지우기">
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12h9l1-12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="my-page__section my-page__section--reviews">
            <h3 className="my-page__section-title">
              내가 쓴 후기 <span className="my-page__count">{myReviews.length}</span>
            </h3>
            {myReviews.length === 0 ? (
              <p className="my-page__empty">아직 남긴 후기가 없어요.</p>
            ) : (
              <ol className="my-page__card my-page__reviews">
                {sortedReviews.map((r, i) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className={`my-page__review${i < 3 ? ' my-page__review--top' : ''}`}
                      onClick={() => onOpenReview(r)}
                    >
                      <span className={`my-page__rank my-page__rank--${Math.min(i + 1, 4)}`}>{i + 1}</span>
                      <span className="my-page__review-name">{r.restaurant.name}</span>
                      <span className="my-page__review-rating">
                        <span aria-hidden="true">★</span>
                        <span className="my-page__sr">별점 </span>
                        {r.rating.toFixed(1)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="my-page__section" aria-label="월간 결산">
            <button type="button" className="my-page__disclosure" onClick={onOpenRecap}>
              월간 결산
              <span className="my-page__disclosure-hint">{monthLabel(kstMonth())}의 나</span>
              <svg className="my-page__chevron my-page__chevron--right" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </section>

          <section className="my-page__section" aria-label="어디 갈래? 투표">
            <h3 className="my-page__section-title">
              어디 갈래? 투표 {polls && polls.length > 0 && <span className="my-page__count">{polls.length}</span>}
            </h3>
            {polls === null ? null : polls.length === 0 ? (
              <p className="my-page__empty">가게 시트의 투표 담기로 후보를 모아 링크를 보내면, 친구들이 앱 없이도 골라요.</p>
            ) : (
              <ul className="my-page__card">
                {polls.map((p) => (
                  <li key={p.token}>
                    <button type="button" className="my-page__review my-page__poll" onClick={() => onOpenPoll(p.token)}>
                      <span className={`my-page__poll-state${p.closed ? '' : ' my-page__poll-state--open'}`}>
                        {p.closed ? '마감' : '진행 중'}
                      </span>
                      <span className="my-page__poll-main">
                        <span className="my-page__review-name">{p.title}</span>
                        <span className="my-page__poll-meta">
                          {p.closed ? (p.leader ? `${p.leader}(으)로 결정` : '아무도 안 골랐어요') : `${timeLeft(p.closesAt)}${p.leader ? ` · ${p.leader} 앞서는 중` : ''}`}
                          {' · '}
                          {p.voterCount}명{p.mine ? '' : ' · 참여'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="my-page__section" aria-label="팔로우 추가">
            <div className="my-page__field my-page__field--search">
              <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="10" cy="8" r="3.5" />
                <path d="M3.5 19c1-3 3.5-4.6 6.5-4.6" />
                <path d="M18 13v6M15 16h6" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="닉네임으로 찾기"
                aria-label="사용자 검색"
                enterKeyHint="search"
                autoComplete="off"
              />
            </div>
            {found.length > 0 && (
              <ul className="my-page__card my-page__people my-page__found">
                {found.map((u) => (
                  <li key={u.id} className="my-page__person">
                    <button
                      type="button"
                      className="my-page__person-open"
                      onClick={() => openProfile?.(u.id)}
                      disabled={!openProfile}
                      aria-label={`${u.nickname}님 프로필`}
                    >
                      <Avatar className={`my-page__avatar ${toneOf(u.id)}`} name={u.nickname} />
                      <span className="my-page__name">{u.nickname}</span>
                    </button>
                    {followingIds.has(u.id) ? (
                      <span className="my-page__status">팔로잉</span>
                    ) : (
                      <button
                        type="button"
                        className="my-page__action my-page__action--primary"
                        onClick={() => run(followUser(u.id))}
                        disabled={busy}
                        aria-label={`${u.nickname} 팔로우`}
                      >
                        팔로우
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {query.trim().length >= MIN_SEARCH_LENGTH && found.length === 0 && (
              <p className="my-page__hint my-page__hint--field">찾는 사람이 없어요.</p>
            )}
          </section>

          <div className="my-page__columns">
            <PersonList
              title="팔로잉"
              people={social?.following ?? []}
              empty="아직 팔로우한 사람이 없어요. 위에서 닉네임으로 찾아보세요."
              renderAction={(p, label) => (
                <button
                  type="button"
                  className="my-page__action"
                  onClick={() => run(unfollowUser(p.id), `${label}님을 언팔로우했어요`)}
                  disabled={busy}
                  aria-label={`${label} 언팔로우`}
                >
                  언팔로우
                </button>
              )}
            />
            <PersonList
              title="팔로워"
              people={social?.followers ?? []}
              empty="아직 나를 팔로우한 사람이 없어요."
              // 이미 맞팔이면 상태만 보여준다 — 언팔로우는 왼쪽 팔로잉 목록에서
              renderAction={(p, label) =>
                p.following ? (
                  <span className="my-page__status">맞팔 중</span>
                ) : (
                  <button
                    type="button"
                    className="my-page__action my-page__action--primary"
                    onClick={() => run(followUser(p.id))}
                    disabled={busy}
                    aria-label={`${label} 맞팔로우`}
                  >
                    맞팔로우
                  </button>
                )
              }
            />
          </div>

          <section className="my-page__section" aria-label="차단한 사용자">
            <button
              type="button"
              className="my-page__disclosure"
              onClick={() => setBlocksOpen((v) => !v)}
              aria-expanded={blocksOpen}
            >
              차단한 사용자
              {blocked && <span className="my-page__count">{blocked.length}</span>}
              <svg
                className={`my-page__chevron${blocksOpen ? ' my-page__chevron--open' : ''}`}
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {blocksOpen &&
              (blocked === null ? (
                <p className="my-page__hint my-page__hint--field" role="status">
                  불러오는 중…
                </p>
              ) : blocked.length === 0 ? (
                <p className="my-page__empty">차단한 사람이 없어요. 프로필이나 신고 화면에서 차단할 수 있어요.</p>
              ) : (
                <ul className="my-page__card my-page__people">
                  {blocked.map((p) => (
                    <li key={p.id} className="my-page__person">
                      <span className="my-page__person-open my-page__person-open--static">
                        <Avatar className={`my-page__avatar ${toneOf(p.id)}`} src={p.avatar} name={p.nickname} />
                        <span className="my-page__name">{p.nickname}</span>
                      </span>
                      <button
                        type="button"
                        className="my-page__action"
                        onClick={() => unblock(p)}
                        disabled={busy}
                        aria-label={`${p.nickname} 차단 해제`}
                      >
                        차단 해제
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </section>

          {isAdmin && (
            <section className="my-page__section" aria-label="운영">
              <button type="button" className="my-page__disclosure" onClick={onOpenReports}>
                신고 관리
                <svg className="my-page__chevron my-page__chevron--right" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </section>
          )}

          <footer className="my-page__footer">
            <nav className="my-page__links" aria-label="약관과 정책">
              <button type="button" onClick={() => onOpenPolicy('terms')}>
                이용약관
              </button>
              <button type="button" onClick={() => onOpenPolicy('privacy')}>
                개인정보처리방침
              </button>
            </nav>
            {!isAdmin &&
              (leaving ? (
                <div className="my-page__leave" role="group" aria-label="회원 탈퇴 확인">
                  <h3 className="my-page__leave-title">정말 탈퇴할까요?</h3>
                  <p className="my-page__leave-text">
                    계정과 내가 쓴 후기·사진·댓글, 찜, 팔로우가 바로 지워지고 되돌릴 수 없어요. 같은 이메일로 다시 가입해도
                    예전 기록은 돌아오지 않아요.
                  </p>
                  <label className="my-page__leave-check">
                    <input type="checkbox" checked={leaveChecked} onChange={(e) => setLeaveChecked(e.target.checked)} />
                    위 내용을 확인했어요
                  </label>
                  <div className="my-page__leave-actions">
                    <button
                      type="button"
                      className="my-page__leave-cancel"
                      onClick={() => {
                        setLeaving(false)
                        setLeaveChecked(false)
                      }}
                      disabled={busy}
                    >
                      취소
                    </button>
                    <button type="button" className="my-page__leave-confirm" onClick={leave} disabled={!leaveChecked || busy}>
                      {busy ? '탈퇴하는 중…' : '탈퇴하기'}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="my-page__leave-open" onClick={() => setLeaving(true)}>
                  회원 탈퇴
                </button>
              ))}
          </footer>
        </div>
      </div>

      {toast && (
        // 연달아 뜰 때 애니메이션이 처음부터 다시 돌도록 key로 리마운트
        <p key={toast} className="my-page__toast" role="status">
          {toast}
        </p>
      )}
    </div>
  )
}

interface PersonListProps {
  title: string
  people: Person[]
  empty: string
  // 오른쪽 버튼(언팔로우/맞팔로우) 또는 상태 글자. label은 보이는 이름(별칭 우선)
  renderAction: (person: Person, label: string) => ReactNode
}

// 사람을 누르면 프로필 개요가 열리고, 별칭(이름 바꾸기)은 거기서 한다.
// 다른 사람 프로필의 팔로잉·팔로워 목록(ProfileSheet)도 이걸 쓴다.
export function PersonList({ title, people, empty, renderAction }: PersonListProps) {
  const openProfile = useOpenProfile()
  return (
    <section className="my-page__column">
      <h3 className="my-page__section-title my-page__section-title--small">
        {title} <span className="my-page__count">{people.length}</span>
      </h3>
      {people.length === 0 ? (
        <p className="my-page__empty">{empty}</p>
      ) : (
        <ul className="my-page__card my-page__people">
          {people.map((p) => {
            const label = p.alias ?? p.nickname
            return (
              <li key={p.id} className="my-page__person">
                <button
                  type="button"
                  className="my-page__person-open"
                  onClick={() => openProfile?.(p.id)}
                  disabled={!openProfile}
                  aria-label={`${label}님 프로필`}
                >
                  <Avatar className={`my-page__avatar ${toneOf(p.id)}`} src={p.avatar} name={label} />
                  <span className="my-page__who">
                    <span className="my-page__name">{label}</span>
                    {p.alias && <span className="my-page__nick">@{p.nickname}</span>}
                  </span>
                </button>
                {renderAction(p, label)}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
