import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { closePoll, deletePoll, fetchPoll, pollLink, votePoll } from '../lib/api'
import type { AuthSession, PollOptionView, PollView } from '../lib/api'
import { shareLink } from '../lib/share'
import { timeLeft } from '../lib/time'
import { PLAY_STORE_URL, isAndroidWeb, pollIntentUrl } from '../lib/deepLink'
import { BallotIcon, CheckIcon, CrownIcon, PinIcon, ShareIcon } from './PollIcons'
import './ModalSheet.css'
import './Poll.css'
import { RatingStar } from './Stars'

interface PollSheetProps {
  token: string
  session: AuthSession | null
  // 비회원에게 보이는 "인터맵 시작하기"
  onLogin: () => void
  // 투표를 지우거나 마감하면 — 마이페이지 목록을 다시 받게
  onChanged?: () => void
  // 방금 만든 투표 — 만들기 창에서 바로 넘어올 때. 다시 받는 동안 빈 시트가 보이지 않고,
  // 뒤 배경도 다시 페이드하지 않는다 (만들기 창 배경이 그대로 이어지는 것처럼)
  initial?: PollView
  onClose: () => void
}

// 비회원이 마지막에 쓴 이름 — 다음 투표에 미리 채운다
const NAME_KEY = 'intermap.voterName'
// 열어 둔 동안 다른 사람 선택을 따라잡는 주기
const REFRESH_MS = 20_000

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // 저장 못 해도 이번 투표엔 지장 없다
  }
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

// 네이버 지도에서 가게 찾기 — 같은 이름이 많아 구 이름을 같이 넣는다
function naverMapUrl(option: PollOptionView): string {
  const gu = option.address.split(/\s+/).find((t) => /(구|군)$/.test(t)) ?? ''
  return `https://map.naver.com/p/search/${encodeURIComponent(`${option.name} ${gu}`.trim())}`
}

// 주소는 길어서 시·도를 떼고 보여준다
function shortAddress(address: string): string {
  const tokens = address.split(/\s+/)
  return tokens.length > 2 ? tokens.slice(1).join(' ') : address
}

const sameSet = (a: Set<number>, b: number[]) => a.size === b.length && b.every((id) => a.has(id))

// "어디 갈래?" 투표 화면 — 링크로 들어온 친구(비회원 포함)와 만든 사람이 같이 쓴다.
// 괜찮은 곳을 여러 개 고를 수 있고, 다시 고르면 바뀐다. 마감되면 가장 많이 골린 곳이 결정된다.
export default function PollSheet({ token, session, onLogin, onChanged, initial, onClose }: PollSheetProps) {
  const [poll, setPoll] = useState<PollView | null>(initial ?? null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [picks, setPicks] = useState<Set<number>>(new Set())
  const [name, setName] = useState(readName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 처음 받은 뒤엔 내 선택을 서버 값으로 덮지 않는다 (고르는 중에 새로고침돼도 손대던 게 남게)
  const [touched, setTouched] = useState(false)

  const apply = useCallback((next: PollView, resetPicks: boolean) => {
    setPoll(next)
    if (resetPicks) setPicks(new Set(next.myChoices))
    if (next.myName && !session) setName((prev) => prev || next.myName!)
  }, [session])

  // 처음 열 때 + 로그인 상태가 바뀔 때 (계정 기준으로 내 선택이 달라진다)
  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    fetchPoll(token)
      .then((next) => {
        if (cancelled) return
        apply(next, true)
        setTouched(false)
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message))
    return () => {
      cancelled = true
    }
  }, [token, session?.id, apply])

  // 진행 중이면 주기적으로 다른 사람 선택을 받아 온다 (화면이 보일 때만)
  const closed = poll?.closed ?? false
  // 투표·마감을 보낼 때마다 올린다 — 그 전에 출발한 새로고침 응답이 늦게 와서 방금 한 투표를 되돌리지 않게
  const writes = useRef(0)
  useEffect(() => {
    if (!poll || closed) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const seq = writes.current
      fetchPoll(token)
        .then((next) => seq === writes.current && apply(next, !touched))
        .catch(() => {})
    }, REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [poll, closed, token, touched, apply])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2400)
    return () => window.clearTimeout(timer)
  }, [toast])

  const maxVotes = useMemo(() => Math.max(1, ...(poll?.options.map((o) => o.votes) ?? [0])), [poll])
  const winners = useMemo(() => new Set(poll?.winnerIds ?? []), [poll])
  const voted = (poll?.myChoices.length ?? 0) > 0
  const changed = poll ? !sameSet(picks, poll.myChoices) : false
  const needName = !session && !name.trim()
  const canVote = !!poll && !poll.closed && changed && (picks.size > 0 || voted) && !needName && !busy

  function toggle(id: number) {
    if (!poll || poll.closed) return
    setTouched(true)
    setPicks((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    if (!poll || !canVote) return
    setBusy(true)
    setError(null)
    try {
      const trimmed = name.trim()
      if (!session) saveName(trimmed)
      writes.current++
      const next = await votePoll(poll.token, [...picks], session ? undefined : trimmed)
      apply(next, true)
      setTouched(false)
      setToast(picks.size === 0 ? '선택을 지웠어요' : voted ? '다시 골랐어요' : '투표했어요!')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    if (!poll) return
    const winnerNames = poll.options.filter((o) => winners.has(o.id)).map((o) => o.name)
    const text = poll.closed
      ? winnerNames.length > 0
        ? `'${poll.title}' 결과: ${winnerNames.join(', ')}(으)로 결정!`
        : `'${poll.title}' 투표가 끝났어요`
      : `${poll.creator.name}님이 '${poll.title}' 투표를 열었어요. 괜찮은 곳을 골라주세요!`
    const result = await shareLink(poll.title, text, pollLink(poll.token))
    // 안드로이드 13+는 복사하면 시스템이 "클립보드에 복사했어요"를 띄운다 — 겹치지 않게 우리 안내는 생략
    if (result === 'copied' && !/Android/i.test(navigator.userAgent)) setToast('링크를 복사했어요. 카톡에 붙여 넣어 보내세요')
  }

  async function close() {
    if (!poll || busy) return
    setBusy(true)
    setError(null)
    try {
      writes.current++
      apply(await closePoll(poll.token), true)
      setTouched(false)
      onChanged?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!poll || busy) return
    setBusy(true)
    try {
      await deletePoll(poll.token)
      onChanged?.()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const winnerOptions = poll?.options.filter((o) => winners.has(o.id)) ?? []

  return (
    <div className={`modal-layer${initial ? ' modal-layer--handoff' : ''}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet poll-sheet poll-sheet--view" role="dialog" aria-modal="true" aria-labelledby="poll-title">
        <header className="modal-sheet__header">
          <span className="poll-sheet__badge" aria-hidden="true">
            <BallotIcon size={20} />
          </span>
          <h2 id="poll-title" className="modal-sheet__title">
            {poll?.title ?? '투표'}
          </h2>
          <button type="button" className="modal-sheet__icon-btn" onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </button>
        </header>

        <div className="modal-sheet__body">
          {loadError ? (
            <p className="modal-sheet__error" role="alert">
              {loadError}
            </p>
          ) : !poll ? (
            <p className="modal-sheet__lead" role="status">
              불러오는 중…
            </p>
          ) : (
            <>
              <p className="poll-sheet__meta">
                <strong>{poll.creator.name}</strong>님이 만든 투표 · {poll.closed ? '마감됐어요' : timeLeft(poll.closesAt)} ·{' '}
                {poll.voterCount}명 참여
              </p>

              {poll.closed ? (
                <div className={`poll-result${winnerOptions.length ? '' : ' poll-result--empty'}`} role="status">
                  {winnerOptions.length > 0 ? (
                    <>
                      <span className="poll-result__label">
                        <CrownIcon size={16} /> {winnerOptions.length > 1 ? '공동 1등' : '여기로 결정!'}
                      </span>
                      <span className="poll-result__name">{winnerOptions.map((o) => o.name).join(' · ')}</span>
                    </>
                  ) : (
                    <span className="poll-result__label">아무도 고르지 않고 끝났어요</span>
                  )}
                </div>
              ) : (
                <p className="poll-sheet__lead">괜찮은 곳을 모두 골라주세요. 다시 고르면 바뀌어요.</p>
              )}

              {error && (
                <p className="modal-sheet__error" role="alert">
                  {error}
                </p>
              )}

              <ul className="poll-options">
                {poll.options.map((o) => {
                  const picked = picks.has(o.id)
                  const winner = winners.has(o.id)
                  return (
                    <li key={o.id} className={`poll-option${picked ? ' poll-option--picked' : ''}${winner ? ' poll-option--winner' : ''}`}>
                      <button
                        type="button"
                        className="poll-option__pick"
                        onClick={() => toggle(o.id)}
                        disabled={poll.closed}
                        aria-pressed={picked}
                      >
                        <span className="poll-option__check" aria-hidden="true">
                          {winner ? <CrownIcon size={15} /> : picked && <CheckIcon size={15} />}
                        </span>
                        <span className="poll-option__main">
                          <span className="poll-option__name">{o.name}</span>
                          {o.rating !== null && (
                            <span className="poll-option__rating">
                              <RatingStar />
                              {o.rating.toFixed(1)}
                              <span className="poll-option__rating-count">이웃 후기 {o.reviewCount}개</span>
                            </span>
                          )}
                          <span className="poll-option__meta">
                            {o.category ? `${o.category.split('>').at(-1)} · ` : ''}
                            {shortAddress(o.address)}
                          </span>
                          {o.note && <span className="poll-option__note">“{o.note}”</span>}
                          <span className="poll-option__bar" aria-hidden="true">
                            <span style={{ width: `${(o.votes / maxVotes) * 100}%` }} />
                          </span>
                          <span className="poll-option__voters">
                            {o.votes > 0 ? `${o.votes}표 · ${o.voters.join(', ')}` : '아직 아무도 안 골랐어요'}
                          </span>
                        </span>
                      </button>
                      <a className="poll-option__map" href={naverMapUrl(o)} target="_blank" rel="noopener noreferrer" aria-label={`${o.name} 네이버 지도에서 보기`}>
                        <PinIcon />
                      </a>
                    </li>
                  )
                })}
              </ul>

              {!poll.closed && !session && (
                <label className="poll-field">
                  <span className="poll-field__label">내 이름</span>
                  <input
                    className="poll-field__input"
                    type="text"
                    value={name}
                    maxLength={12}
                    placeholder="친구들이 알아볼 이름"
                    onChange={(e) => setName(e.target.value)}
                    enterKeyHint="done"
                    autoComplete="nickname"
                  />
                </label>
              )}

              <div className="modal-sheet__actions poll-sheet__actions">
                {!poll.closed && (
                  <button type="button" className="modal-sheet__btn modal-sheet__btn--primary" onClick={submit} disabled={!canVote}>
                    {busy
                      ? '보내는 중…'
                      : needName && picks.size > 0
                        ? '이름을 적어주세요'
                        : voted
                          ? changed
                            ? picks.size === 0
                              ? '선택 지우기'
                              : '다시 고르기'
                            : '골랐어요'
                          : picks.size > 0
                            ? `${picks.size}곳 골라서 투표`
                            : '가게를 골라주세요'}
                  </button>
                )}
              </div>
              <div className="poll-sheet__tools">
                {isAndroidWeb() && (
                  <a className="poll-tool" href={pollIntentUrl(poll.token, PLAY_STORE_URL)}>
                    앱에서 열기
                  </a>
                )}
                <button type="button" className="poll-tool" onClick={share}>
                  <ShareIcon /> {poll.closed ? '결과 보내기' : '친구에게 보내기'}
                </button>
                {poll.mine && !poll.closed && (
                  <button type="button" className="poll-tool" onClick={close} disabled={busy}>
                    지금 마감하기
                  </button>
                )}
                {poll.mine &&
                  (confirmDelete ? (
                    <button type="button" className="poll-tool poll-tool--danger" onClick={remove} disabled={busy}>
                      정말 지울까요?
                    </button>
                  ) : (
                    <button type="button" className="poll-tool poll-tool--quiet" onClick={() => setConfirmDelete(true)}>
                      투표 지우기
                    </button>
                  ))}
              </div>

              {!session && (
                <div className="poll-invite">
                  <p className="poll-invite__text">
                    <strong>인터맵</strong>은 친구들이 남긴 맛집 후기를 지도로 모아 보는 앱이에요.
                  </p>
                  <button type="button" className="poll-invite__btn" onClick={onLogin}>
                    시작하기
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        {toast && (
          <p className="poll-toast" role="status">
            {toast}
          </p>
        )}
      </div>
    </div>
  )
}
