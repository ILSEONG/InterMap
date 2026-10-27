import { useEffect, useState } from 'react'
import type { Restaurant } from '../data/model'
import type { SocialData, UserProfile } from '../lib/api'
import { blockUser, fetchUserProfile, fetchUserSocial, followUser, unblockUser, unfollowUser, setAlias } from '../lib/api'
import type { ProfileList } from '../lib/profileStack'
import { topPicksOf } from '../lib/topPicks'
import Avatar from './Avatar'
import { PersonList } from './MyPage'
import TopPicksCard from './TopPicksCard'
import './MyPage.css'
import './ProfileSheet.css'

interface ProfileSheetProps {
  userId: number
  // 서버 응답이 오기 전에도 이름은 보여준다 (검색 결과·후기에서 이미 아는 이름)
  fallbackName: string
  // 후기가 붙은 가게 목록 — 팔로우한 사람의 별점 TOP 5를 여기서 뽑는다
  restaurants: Restaurant[]
  // 팔로잉·팔로워 목록에서 나 자신을 "나"로 표시하는 데 쓴다
  myUserId?: number
  // 팔로잉·팔로워 수를 누르면 개요 대신 그 목록을 보여준다. App이 들고 있어 안드로이드 뒤로가기로 한 단계씩 닫힌다
  list: ProfileList | null
  onListChange: (list: ProfileList | null) => void
  onSocialChange: (next: SocialData) => void
  // 차단·해제 뒤 — App이 후기·댓글·팔로우 목록을 다시 받는다
  onBlockChange: () => void
  onPick: (restaurant: Restaurant) => void
  onClose: () => void
}

// 다른 사람의 마이페이지 개요. 팔로우하지 않았으면 이름·사진·후기 개수까지만 보이고
// 후기 내용은 팔로우해야 열린다 (지도·스토리에 그 사람 후기가 안 나오는 것과 같은 기준).
export default function ProfileSheet({
  userId,
  fallbackName,
  restaurants,
  myUserId,
  list: listKind,
  onListChange: setListKind,
  onSocialChange,
  onBlockChange,
  onPick,
  onClose,
}: ProfileSheetProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [lists, setLists] = useState<SocialData | null>(null)

  useEffect(() => {
    let cancelled = false
    setProfile(null)
    setError(null)
    setLists(null)
    fetchUserProfile(userId)
      .then((p) => {
        if (!cancelled) setProfile(p)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  // 목록은 처음 펼칠 때 한 번 받는다
  useEffect(() => {
    if (!listKind || lists) return
    let cancelled = false
    fetchUserSocial(userId)
      .then((data) => {
        if (!cancelled) setLists(data)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [listKind, lists, userId])

  // 팔로우/언팔로우/별칭은 소셜 목록을 새로 받고, 프로필도 바뀐 관계로 다시 받는다.
  // 목록 속 팔로우 버튼 상태도 바뀐다 — 펼쳐 있으면 제자리에서 다시 받고, 아니면 버려서 다음에 새로 받는다.
  async function run(task: Promise<SocialData>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onSocialChange(await task)
      setProfile(await fetchUserProfile(userId))
      setLists(listKind ? await fetchUserSocial(userId) : null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // 차단: 서로의 후기·댓글이 안 보이고 팔로우가 끊긴다. 해제하면 다시 보이지만 팔로우는 새로 해야 한다
  async function toggleBlock() {
    if (!profile || busy) return
    const blocking = !profile.blocked
    if (
      blocking &&
      !window.confirm(`${name}님을 차단할까요?\n서로의 후기와 댓글이 보이지 않고, 팔로우도 끊겨요. 상대에게 알림은 가지 않아요.`)
    ) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await (blocking ? blockUser(userId) : unblockUser(userId))
      setProfile(await fetchUserProfile(userId))
      setLists(null)
      onBlockChange()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function rename() {
    if (!profile) return
    const next = window.prompt(`${profile.nickname}님을 뭐라고 부를까요? (비우면 원래 이름)`, profile.alias ?? '')
    if (next === null) return
    void run(setAlias(userId, next.trim()))
  }

  const name = profile ? (profile.alias ?? profile.nickname) : fallbackName
  // 서버가 센다 — 팔로우 전엔 후기 내용이 안 오지만 개수는 보여준다 (주인장 후기는 가게 시트 전용이라 0)
  const reviewCount = profile?.reviewCount ?? 0
  const picks = profile?.following ? topPicksOf(restaurants, userId) : []
  // 별칭은 팔로우 관계(어느 쪽이든)인 사람에게만 붙일 수 있다 — 서버 규칙과 같다.
  // 마이페이지 팔로잉·팔로워 목록은 두 칸이라 좁아서, 사람을 눌러 여기로 와서 이름을 바꾼다.
  const canRename = !!profile && !profile.blocked && (profile.following || profile.followsMe)
  const isMe = myUserId === userId

  return (
    <div className="my-page-layer my-page-layer--profile">
      <div className="my-page my-page--profile" role="dialog" aria-label={`${name}님 프로필`}>
        <button type="button" className="my-page__close profile-sheet__close" onClick={onClose} aria-label="닫기">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="my-page__scroll">
          {listKind ? (
            <>
              <button type="button" className="profile-sheet__back" onClick={() => setListKind(null)}>
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
                {name}
              </button>
              {error && (
                <p className="my-page__error" role="alert">
                  {error}
                </p>
              )}
              {lists === null ? (
                !error && (
                  <p className="my-page__hint profile-sheet__loading" role="status">
                    불러오는 중…
                  </p>
                )
              ) : (
                <PersonList
                  title={listKind === 'following' ? '팔로잉' : '팔로워'}
                  people={lists[listKind]}
                  empty={listKind === 'following' ? '아직 팔로우한 사람이 없어요.' : '아직 팔로워가 없어요.'}
                  renderAction={(p, label) =>
                    p.id === myUserId ? (
                      <span className="my-page__status">나</span>
                    ) : p.following ? (
                      <span className="my-page__status">팔로잉</span>
                    ) : (
                      <button
                        type="button"
                        className="my-page__action my-page__action--primary"
                        onClick={() => run(followUser(p.id))}
                        disabled={busy}
                        aria-label={`${label} 팔로우`}
                      >
                        팔로우
                      </button>
                    )
                  }
                />
              )}
            </>
          ) : (
            <>
              <div className="profile-sheet__hero">
                <Avatar className={`my-page__avatar profile-sheet__avatar tone-${Math.abs(userId) % 4}`} src={profile?.avatar} name={name} />
                <h2 className="profile-sheet__name">{name}</h2>
                {profile?.alias && <p className="profile-sheet__nick">@{profile.nickname}</p>}
                {profile?.blocked && <span className="profile-sheet__badge profile-sheet__badge--blocked">차단한 사용자</span>}
                {profile?.followsMe && !profile.blocked && (
                  <span className="profile-sheet__badge">
                    <span className="profile-sheet__badge-dot" aria-hidden="true" />
                    {profile.following ? '맞팔 중' : '나를 팔로우하고 있어요'}
                  </span>
                )}
              </div>

              <div className="profile-sheet__stats">
                <div className="profile-sheet__stat">
                  <span className="profile-sheet__stat-label">후기</span>
                  <span className="profile-sheet__stat-value">{reviewCount}개</span>
                </div>
                {profile?.following && !profile.blocked && (
                  <>
                    <button type="button" className="profile-sheet__stat" onClick={() => setListKind('following')}>
                      <span className="profile-sheet__stat-label">팔로잉</span>
                      <span className="profile-sheet__stat-value">{profile.followingCount}</span>
                    </button>
                    <button type="button" className="profile-sheet__stat" onClick={() => setListKind('followers')}>
                      <span className="profile-sheet__stat-label">팔로워</span>
                      <span className="profile-sheet__stat-value">{profile.followerCount}</span>
                    </button>
                  </>
                )}
              </div>

              {error && (
                <p className="my-page__error" role="alert">
                  {error}
                </p>
              )}

              {profile === null ? (
                !error && (
                  <p className="my-page__hint profile-sheet__loading" role="status">
                    불러오는 중…
                  </p>
                )
              ) : (
                <>
                  {profile.blocked ? (
                    <>
                      <div className="profile-sheet__actions">
                        <button type="button" className="profile-sheet__follow" onClick={toggleBlock} disabled={busy}>
                          차단 해제
                        </button>
                      </div>
                      <p className="profile-sheet__locked">
                        차단한 사용자예요. 서로의 후기와 댓글이 보이지 않아요. 차단을 풀면 다시 팔로우할 수 있어요.
                      </p>
                    </>
                  ) : (
                  <>
                  <div className="profile-sheet__actions">
                    <button
                      type="button"
                      className={`profile-sheet__follow${profile.following ? ' profile-sheet__follow--on' : ''}`}
                      aria-pressed={profile.following}
                      onClick={() => run(profile.following ? unfollowUser(userId) : followUser(userId))}
                      disabled={busy}
                    >
                      {profile.following ? (
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12.5l4.5 4.5L19 7.5" />
                        </svg>
                      ) : (
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      )}
                      {profile.following ? '팔로잉' : '팔로우'}
                    </button>
                    {canRename && (
                      <button type="button" className="profile-sheet__rename" onClick={rename} disabled={busy}>
                        <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 20h4L19 9l-4-4L4 16z" />
                          <path d="M13.5 6.5l4 4" />
                        </svg>
                        이름 바꾸기
                      </button>
                    )}
                  </div>

                  {profile.following ? (
                    picks.length === 0 ? (
                      <>
                        <h3 className="profile-sheet__section-title">{name}의 별점 TOP 5</h3>
                        <p className="profile-sheet__locked">아직 별점을 남긴 가게가 없어요.</p>
                      </>
                    ) : (
                      <TopPicksCard className="profile-sheet__picks" name={name} picks={picks} onPick={onPick} />
                    )
                  ) : (
                    <p className="profile-sheet__locked">
                      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="11" width="14" height="9" rx="2.5" />
                        <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
                      </svg>
                      팔로우하면 {name}님의 후기와 별점을 볼 수 있어요.
                    </p>
                  )}
                  {!isMe && (
                    <button type="button" className="profile-sheet__block" onClick={toggleBlock} disabled={busy}>
                      <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="8.5" />
                        <path d="M6 6l12 12" />
                      </svg>
                      {name}님 차단
                    </button>
                  )}
                  </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
