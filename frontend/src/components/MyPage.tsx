import { useDeferredValue, useEffect, useRef, useState } from 'react'
import type { AuthSession, Person, SocialData, UserItem } from '../lib/api'
import { changeNickname, followUser, unfollowUser, setAlias, searchUsers } from '../lib/api'
import './MyPage.css'

interface MyPageProps {
  open: boolean
  session: AuthSession
  // 팔로잉·팔로워·별칭. App이 로그인 시 받아 두고, 여기서 바꾸면 돌려준다 (후기 이름에 별칭을 씌우는 데도 쓴다)
  social: SocialData | null
  onSocialChange: (next: SocialData) => void
  // 닉네임을 바꾸면 새 세션(localStorage 포함)으로 갱신
  onSessionChange: (next: AuthSession) => void
  onClose: () => void
}

const MIN_SEARCH_LENGTH = 1

export default function MyPage({ open, session, social, onSocialChange, onSessionChange, onClose }: MyPageProps) {
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
  function showToast(text: string) {
    setToast(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2000)
  }

  // 열릴 때마다 입력값을 현재 세션 기준으로 되돌린다
  useEffect(() => {
    if (!open) return
    setNickname(session.nickname)
    setNicknameMsg(null)
    setQuery('')
    setError(null)
  }, [open, session.nickname])

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

  // 나만 보이는 이름. 비우면 원래 닉네임으로 돌아간다.
  function rename(person: Person) {
    const next = window.prompt(`${person.nickname}님을 뭐라고 부를까요? (비우면 원래 이름)`, person.alias ?? '')
    if (next === null) return
    void run(setAlias(person.id, next.trim()))
  }

  return (
    <div className="my-page" role="dialog" aria-label="마이페이지">
      <header className="my-page__header">
        <button type="button" className="my-page__back" onClick={onClose} aria-label="닫기">
          ←
        </button>
        <h2 className="my-page__title">마이페이지</h2>
      </header>

      <div className="my-page__scroll">
        {error && <p className="my-page__error">{error}</p>}

        <section className="my-page__section">
          <h3 className="my-page__section-title">닉네임</h3>
          <div className="my-page__row-input">
            <input
              type="text"
              value={nickname}
              maxLength={20}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveNickname()}
              aria-label="닉네임"
            />
            <button type="button" onClick={saveNickname} disabled={busy || !nickname.trim() || nickname.trim() === session.nickname}>
              저장
            </button>
          </div>
          {nicknameMsg && <p className={`my-page__hint${nicknameMsg.ok ? '' : ' my-page__hint--error'}`}>{nicknameMsg.text}</p>}
        </section>

        <section className="my-page__section">
          <h3 className="my-page__section-title">팔로우 추가</h3>
          <div className="my-page__row-input">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="닉네임으로 찾기"
              aria-label="사용자 검색"
              enterKeyHint="search"
            />
          </div>
          {found.length > 0 && (
            <ul className="my-page__list">
              {found.map((u) => (
                <li key={u.id} className="my-page__person">
                  <span className="my-page__name">{u.nickname}</span>
                  {followingIds.has(u.id) ? (
                    <span className="my-page__hint">팔로잉</span>
                  ) : (
                    <button type="button" className="my-page__action" onClick={() => run(followUser(u.id))} disabled={busy}>
                      팔로우
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= MIN_SEARCH_LENGTH && found.length === 0 && <p className="my-page__hint">찾는 사람이 없어요.</p>}
        </section>

        <PersonList
          title={`팔로잉 ${social?.following.length ?? 0}`}
          people={social?.following ?? []}
          empty="아직 팔로우한 사람이 없어요. 위에서 닉네임으로 찾아보세요."
          busy={busy}
          onRename={rename}
          onToggleFollow={(p) => run(unfollowUser(p.id), `${p.alias ?? p.nickname}님을 언팔로우했어요`)}
          toggleLabel={() => '언팔로우'}
        />
        <PersonList
          title={`팔로워 ${social?.followers.length ?? 0}`}
          people={social?.followers ?? []}
          empty="아직 나를 팔로우한 사람이 없어요."
          busy={busy}
          onRename={rename}
          onToggleFollow={(p) =>
            run(p.following ? unfollowUser(p.id) : followUser(p.id), p.following ? `${p.alias ?? p.nickname}님을 언팔로우했어요` : undefined)
          }
          toggleLabel={(p) => (p.following ? '언팔로우' : '맞팔로우')}
        />
      </div>

      {toast && (
        <p className="my-page__toast" role="status">
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
  busy: boolean
  onRename: (person: Person) => void
  onToggleFollow: (person: Person) => void
  toggleLabel: (person: Person) => string
}

function PersonList({ title, people, empty, busy, onRename, onToggleFollow, toggleLabel }: PersonListProps) {
  return (
    <section className="my-page__section">
      <h3 className="my-page__section-title">{title}</h3>
      {people.length === 0 ? (
        <p className="my-page__hint">{empty}</p>
      ) : (
        <ul className="my-page__list">
          {people.map((p) => (
            <li key={p.id} className="my-page__person">
              <span className="my-page__avatar" aria-hidden="true">
                {(p.alias ?? p.nickname).slice(0, 1)}
              </span>
              <span className="my-page__who">
                <span className="my-page__name">{p.alias ?? p.nickname}</span>
                {p.alias && <span className="my-page__nick">@{p.nickname}</span>}
              </span>
              <button type="button" className="my-page__action" onClick={() => onRename(p)} disabled={busy}>
                이름 바꾸기
              </button>
              <button type="button" className="my-page__action my-page__action--ghost" onClick={() => onToggleFollow(p)} disabled={busy}>
                {toggleLabel(p)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
