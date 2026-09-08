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

  return (
    <div className="my-page" role="dialog" aria-label={`${name}님 프로필`}>
      <header className="my-page__header">
        <button type="button" className="my-page__back" onClick={onClose} aria-label="닫기">
          ←
        </button>
        <h2 className="my-page__title">{name}님</h2>
      </header>

      <div className="my-page__scroll">
        {error && <p className="my-page__error">{error}</p>}

        <section className="my-page__section">
          <div className="my-page__profile">
            <Avatar className="my-page__avatar" src={profile?.avatar} name={name} />
            <div className="my-page__profile-main">
              <p className="profile-sheet__name">{name}</p>
              {profile?.alias && <p className="my-page__nick">@{profile.nickname}</p>}
              <p className="profile-sheet__counts">
                후기 {reviewCount}
                {profile?.following && (
                  <>
                    <span aria-hidden="true"> · </span>팔로잉 {profile.followingCount}
                    <span aria-hidden="true"> · </span>팔로워 {profile.followerCount}
                  </>
                )}
              </p>
            </div>
          </div>
        </section>

        {profile === null ? (
          !error && <p className="my-page__hint">불러오는 중…</p>
        ) : profile.following ? (
          <>
            <section className="my-page__section">
              <h3 className="my-page__section-title">별점 TOP 5</h3>
              {picks.length === 0 ? (
                <p className="my-page__hint">아직 별점을 남긴 가게가 없어요.</p>
              ) : (
                <TopPicksCard name={name} picks={picks} onPick={onPick} />
              )}
            </section>
            <section className="my-page__section profile-sheet__actions">
              <button type="button" className="my-page__action" onClick={rename} disabled={busy}>
                이름 바꾸기
              </button>
              <button
                type="button"
                className="my-page__action my-page__action--ghost"
                onClick={() => run(unfollowUser(userId))}
                disabled={busy}
              >
                언팔로우
              </button>
            </section>
          </>
        ) : (
          <section className="my-page__section">
            <p className="my-page__hint">팔로우하면 {name}님의 후기와 별점을 볼 수 있어요.</p>
            <button
              type="button"
              className="my-page__action profile-sheet__follow"
              onClick={() => run(followUser(userId))}
              disabled={busy}
            >
              팔로우
            </button>
            {profile.followsMe && <p className="my-page__hint">{name}님은 나를 팔로우하고 있어요.</p>}
          </section>
        )}
      </div>
    </div>
  )
}
