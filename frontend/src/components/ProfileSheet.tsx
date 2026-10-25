import { useEffect, useState } from 'react'
import type { Restaurant, Review } from '../data/model'
import type { SocialData, UserProfile } from '../lib/api'
import { fetchUserProfile, followUser, unfollowUser, setAlias } from '../lib/api'
import { topPicksOf } from '../lib/topPicks'
import Avatar from './Avatar'
import TopPicksCard from './TopPicksCard'
import './MyPage.css'
import './ProfileSheet.css'

interface ProfileSheetProps {
  userId: number
  // 서버 응답이 오기 전에도 이름은 보여준다 (검색 결과·후기에서 이미 아는 이름)
  fallbackName: string
  // 모든 후기 — 팔로우 전에도 "후기 N개"는 보여주므로 필터 전 목록을 받는다
  allReviews: Review[]
  // 후기가 붙은 가게 목록 — 팔로우한 사람의 별점 TOP 5를 여기서 뽑는다
  restaurants: Restaurant[]
  onSocialChange: (next: SocialData) => void
  onPick: (restaurant: Restaurant) => void
  onClose: () => void
}

// 다른 사람의 마이페이지 개요. 팔로우하지 않았으면 이름·사진·후기 개수까지만 보이고
// 후기 내용은 팔로우해야 열린다 (지도·스토리에 그 사람 후기가 안 나오는 것과 같은 기준).
export default function ProfileSheet({
  userId,
  fallbackName,
  allReviews,
  restaurants,
  onSocialChange,
  onPick,
  onClose,
}: ProfileSheetProps) {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setProfile(null)
    setError(null)
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

  // 팔로우/언팔로우/별칭은 소셜 목록을 새로 받고, 프로필도 바뀐 관계로 다시 받는다
  async function run(task: Promise<SocialData>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onSocialChange(await task)
      setProfile(await fetchUserProfile(userId))
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
  // 주인장 후기는 가게 시트 전용이라 개수에서 뺀다 (지도·스토리 기준과 같게)
  const reviewCount = allReviews.filter((rv) => rv.author.id === userId && !rv.author.owner).length
  const picks = profile?.following ? topPicksOf(restaurants, userId) : []
  // 별칭은 팔로우 관계(어느 쪽이든)인 사람에게만 붙일 수 있다 — 서버 규칙과 같다.
  // 마이페이지 팔로잉·팔로워 목록은 두 칸이라 좁아서, 사람을 눌러 여기로 와서 이름을 바꾼다.
  const canRename = !!profile && (profile.following || profile.followsMe)

  return (
    <div className="my-page-layer my-page-layer--profile">
      <div className="my-page my-page--profile" role="dialog" aria-label={`${name}님 프로필`}>
        <button type="button" className="my-page__close profile-sheet__close" onClick={onClose} aria-label="닫기">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="my-page__scroll">
          <div className="profile-sheet__hero">
            <Avatar className={`my-page__avatar profile-sheet__avatar tone-${Math.abs(userId) % 4}`} src={profile?.avatar} name={name} />
            <h2 className="profile-sheet__name">{name}</h2>
            {profile?.alias && <p className="profile-sheet__nick">@{profile.nickname}</p>}
            {profile?.followsMe && (
              <span className="profile-sheet__badge">
                <span className="profile-sheet__badge-dot" aria-hidden="true" />
                {profile.following ? '맞팔 중' : '나를 팔로우하고 있어요'}
              </span>
            )}
          </div>

          <dl className="profile-sheet__stats">
            <div className="profile-sheet__stat">
              <dt>후기</dt>
              <dd>{reviewCount}개</dd>
            </div>
            {profile?.following && (
              <>
                <div className="profile-sheet__stat">
                  <dt>팔로잉</dt>
                  <dd>{profile.followingCount}</dd>
                </div>
                <div className="profile-sheet__stat">
                  <dt>팔로워</dt>
                  <dd>{profile.followerCount}</dd>
                </div>
              </>
            )}
          </dl>

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
            </>
          )}
        </div>
      </div>
    </div>
  )
}
