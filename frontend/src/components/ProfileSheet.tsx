import { useEffect, useMemo, useRef, useState } from 'react'
import type { Restaurant, Review } from '../data/model'
import type { SocialData, UserProfile } from '../lib/api'
import { blockUser, fetchUserProfile, fetchUserSocial, followUser, restaurantKey, unblockUser, unfollowUser, setAlias } from '../lib/api'
import type { ProfileList } from '../lib/profileStack'
import { cacheKey, queryClient, useServerState } from '../lib/query'
import { categoryName, MIN_COMMON, tasteMatch } from '../lib/taste'
import { shortLocation, topPicksOf } from '../lib/topPicks'
import { timeAgo } from '../lib/time'
import { useBackLayer } from '../lib/backLayer'
import { RatingStar } from './Stars'
import Avatar from './Avatar'
import { PersonList } from './MyPage'
import TasteCardSheet from './TasteCardSheet'
import TasteMatchSection from './TasteMatchSection'
import type { OtherPlace } from './TasteMatchSection'
import TopPicksCard from './TopPicksCard'
import './MyPage.css'
import './ProfileSheet.css'

interface ProfileSheetProps {
  userId: number
  // 서버 응답이 오기 전에도 이름은 보여준다 (검색 결과·후기에서 이미 아는 이름)
  fallbackName: string
  // 앱이 이미 아는 것(팔로우 관계·사진·별칭·후기 수) — 이걸로 처음부터 같은 모양을 그리고 서버 응답은 숫자만 채운다.
  // 없으면 서버 응답이 올 때까지 "불러오는 중"
  known?: Pick<UserProfile, 'nickname' | 'alias' | 'avatar' | 'following' | 'followsMe' | 'reviewCount'>
  // 후기가 붙은 가게 목록 — 팔로우한 사람의 별점 TOP 5를 여기서 뽑는다
  restaurants: Restaurant[]
  // 팔로잉·팔로워 목록에서 나 자신을 "나"로 표시하는 데 쓴다
  myUserId?: number
  // 궁합 카드에 들어갈 내 이름
  myName: string
  // 앱이 받은 후기 전체 (팔로우한 사람 + 나) — 나와의 입맛 궁합을 여기서 계산한다
  reviews: Review[]
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
  known,
  restaurants,
  myUserId,
  myName,
  reviews,
  list: listKind,
  onListChange: setListKind,
  onSocialChange,
  onBlockChange,
  onPick,
  onClose,
}: ProfileSheetProps) {
  // 전에 본 프로필이면 받아 둔 걸로 바로 (숫자까지) — 새 값은 뒤에서 받아 바꾼다 (lib/query)
  const [fetched, setProfile, profileQuery] = useServerState<UserProfile>(['profile', userId], () => fetchUserProfile(userId))
  // 서버 응답 전에는 앱이 아는 값으로 — 팔로잉·팔로워 수만 비워 둔다(-1). 응답이 오면 숫자만 바뀌어 화면이 튀지 않는다
  const profile = useMemo<UserProfile | null>(
    () => fetched ?? (known ? { id: userId, ...known, followingCount: -1, followerCount: -1, blocked: false } : null),
    [fetched, known, userId],
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 팔로잉·팔로워 목록은 처음 펼칠 때 받는다 (받아 둔 게 있으면 그걸 먼저 보여 준다)
  const [listData, setListData, listsQuery] = useServerState<SocialData>(['people', userId], () => fetchUserSocial(userId), {
    enabled: Boolean(listKind),
  })
  const lists = listData ?? null
  const setLists = (data: SocialData | null) => {
    if (data) setListData(data)
    // 버리면(관계가 바뀌면) 다음에 펼칠 때 새로 받는다
    else queryClient.removeQueries({ queryKey: cacheKey('people', userId), exact: true })
  }
  const loadError = profileQuery.error ?? listsQuery.error
  useEffect(() => {
    if (loadError) setError(loadError.message)
  }, [loadError])
  const [shareOpen, setShareOpen] = useState(false)
  // 입맛 궁합 / 다녀온 곳 / 별점 TOP 5
  const [tab, setTab] = useState<'taste' | 'visited' | 'top' | null>(null)
  // 오른쪽 위 ⋯ 메뉴 (차단·차단 해제)
  const [moreOpen, setMoreOpen] = useState(false)
  useBackLayer(moreOpen, () => setMoreOpen(false))
  const moreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!moreOpen) return
    const close = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [moreOpen])

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

  // 나와의 입맛 궁합 — 둘 다 후기를 남긴 가게의 별점으로 (팔로우해야 상대 후기가 오므로 팔로우 중일 때만)
  const showTaste = !!profile?.following && !profile.blocked && !isMe && myUserId !== undefined
  const match = useMemo(() => {
    if (!showTaste) return null
    const mine = reviews.filter((rv) => rv.author.id === myUserId && !rv.author.owner)
    const theirs = reviews.filter((rv) => rv.author.id === userId)
    return tasteMatch(mine, theirs)
  }, [showTaste, reviews, myUserId, userId])
  // 겹치는 곳이 적을 때 — 상대는 가 봤고 나는 아직 안 가 본 곳 (별점 높은 순 3곳)
  const others = useMemo<OtherPlace[]>(() => {
    if (!match || match.ready) return []
    const mineKeys = new Set(reviews.filter((rv) => rv.author.id === myUserId).map((rv) => restaurantKey(rv.restaurant)))
    const seen = new Set<string>()
    return reviews
      .filter((rv) => rv.author.id === userId)
      .sort((a, b) => b.rating - a.rating || Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .flatMap((rv) => {
        const key = restaurantKey(rv.restaurant)
        if (mineKeys.has(key) || seen.has(key)) return []
        seen.add(key)
        return [{ key, name: rv.restaurant.name, category: categoryName(rv.restaurant.category), area: shortLocation(rv.restaurant.address), rating: rv.rating }]
      })
      .slice(0, 3)
  }, [match, reviews, myUserId, userId])
  // 다녀온 곳 — 그 사람 후기를 최근 순으로 (가게마다 하나)
  const visited = useMemo(() => {
    if (!profile?.following) return []
    return reviews
      .filter((rv) => rv.author.id === userId && !rv.author.owner)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((rv) => ({
        key: restaurantKey(rv.restaurant),
        name: rv.restaurant.name,
        category: categoryName(rv.restaurant.category),
        area: shortLocation(rv.restaurant.address),
        rating: rv.rating,
        at: rv.createdAt,
      }))
  }, [profile?.following, reviews, userId])
  const tabs: ['taste' | 'visited' | 'top', string][] = [
    ...(showTaste ? ([['taste', '입맛 궁합']] as ['taste', string][]) : []),
    ['visited', `다녀온 곳 ${visited.length}`],
    ['top', '별점 TOP 5'],
  ]
  const activeTab = tab && tabs.some(([v]) => v === tab) ? tab : tabs[0][0]
  const cardInput = useMemo(() => (match?.ready ? { myName, theirName: name, match } : null), [match, myName, name])
  const pickPlace = (key: string) => {
    const restaurant = restaurants.find((r) => restaurantKey(r) === key)
    if (restaurant) onPick(restaurant)
  }

  return (
    <div className="my-page-layer my-page-layer--profile">
      <div className="my-page my-page--profile" role="dialog" aria-label={`${name}님 프로필`}>
        {/* 위 줄 — 뒤로(닫기) · 이름 · ⋯(차단) */}
        <div className="profile-sheet__top">
          <button
            type="button"
            className="profile-sheet__top-btn"
            onClick={() => (listKind ? setListKind(null) : onClose())}
            aria-label={listKind ? `${name}님 프로필로 돌아가기` : '닫기'}
          >
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <span className="profile-sheet__top-name">{listKind ? (listKind === 'following' ? '팔로잉' : '팔로워') : name}</span>
          {!isMe && profile && !listKind ? (
            <div className="profile-sheet__more" ref={moreRef}>
              <button
                type="button"
                className="profile-sheet__top-btn"
                onClick={() => setMoreOpen((v) => !v)}
                aria-label="더 보기"
                aria-expanded={moreOpen}
              >
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
              {moreOpen && (
                <div className="profile-sheet__menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className={profile.blocked ? undefined : 'profile-sheet__menu-danger'}
                    onClick={() => {
                      setMoreOpen(false)
                      void toggleBlock()
                    }}
                    disabled={busy}
                  >
                    {profile.blocked ? '차단 해제' : `${name}님 차단`}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <span className="profile-sheet__top-btn" aria-hidden="true" />
          )}
        </div>

        <div className="my-page__scroll">
          {listKind ? (
            <>
              {error && (
                <p className="my-page__error" role="alert">
                  {error}
                </p>
              )}
              {lists === null ? (
                !error && <ListSkeleton />
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
                <div className="profile-sheet__who">
                  <p className="profile-sheet__name-line">
                    <span className="profile-sheet__name">{name}</span>
                    {profile?.blocked ? (
                      <span className="profile-sheet__badge profile-sheet__badge--blocked">차단함</span>
                    ) : (
                      profile?.followsMe && <span className="profile-sheet__badge">{profile.following ? '맞팔' : '나를 팔로우'}</span>
                    )}
                  </p>
                  {profile?.alias && <p className="profile-sheet__nick">@{profile.nickname}</p>}
                  <p className="profile-sheet__stats">
                    <span className="profile-sheet__stat">
                      후기 <b>{reviewCount >= 0 ? reviewCount : '–'}</b>
                    </span>
                    {profile?.following && !profile.blocked && (
                      <>
                        <button type="button" className="profile-sheet__stat" onClick={() => setListKind('following')}>
                          팔로잉 <b>{profile.followingCount >= 0 ? profile.followingCount : '–'}</b>
                        </button>
                        <button type="button" className="profile-sheet__stat" onClick={() => setListKind('followers')}>
                          팔로워 <b>{profile.followerCount >= 0 ? profile.followerCount : '–'}</b>
                        </button>
                      </>
                    )}
                  </p>
                </div>
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
                    <>
                      <div className="profile-sheet__tabs" role="tablist" aria-label={`${name}님 보기`}>
                        {tabs.map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === value}
                            className={`profile-sheet__tab${activeTab === value ? ' profile-sheet__tab--on' : ''}`}
                            onClick={() => setTab(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {activeTab === 'taste' && match && (
                        <TasteMatchSection
                          name={name}
                          match={match}
                          others={others}
                          canShare={profile.followsMe && match.ready && match.common.length >= MIN_COMMON}
                          onPickPlace={pickPlace}
                          onShare={() => setShareOpen(true)}
                        />
                      )}
                      {activeTab === 'visited' &&
                        (visited.length === 0 ? (
                          <p className="profile-sheet__locked">아직 다녀온 곳이 없어요.</p>
                        ) : (
                          <ul className="profile-sheet__visited">
                            {visited.map((v) => (
                              <li key={v.key}>
                                <button type="button" className="profile-sheet__place" onClick={() => pickPlace(v.key)}>
                                  <span className="profile-sheet__place-text">
                                    <span className="profile-sheet__place-name">{v.name}</span>
                                    <span className="profile-sheet__place-sub">
                                      {v.category ?? '음식점'}
                                      {v.area && ` · ${v.area}`} · {timeAgo(v.at)}
                                    </span>
                                  </span>
                                  <span className="profile-sheet__place-rating">
                                    <RatingStar />
                                    {v.rating.toFixed(1)}
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ))}
                      {activeTab === 'top' &&
                        (picks.length === 0 ? (
                          <p className="profile-sheet__locked">아직 별점을 남긴 가게가 없어요.</p>
                        ) : (
                          <TopPicksCard className="profile-sheet__picks" name={name} picks={picks} onPick={onPick} />
                        ))}
                    </>
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
                </>
              )}
            </>
          )}
        </div>
      </div>
      {shareOpen && cardInput && <TasteCardSheet input={cardInput} onClose={() => setShareOpen(false)} />}
    </div>
  )
}

// 목록을 처음 받는 동안 — 실제 줄과 같은 높이의 회색 줄 (받아 오면 그 자리에 그대로 채워져 화면이 밀리지 않는다)
function ListSkeleton() {
  return (
    <div className="profile-sheet__skeleton" role="status" aria-label="불러오는 중">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="profile-sheet__skeleton-row">
          <span className="profile-sheet__skeleton-avatar" />
          <span className="profile-sheet__skeleton-bar" style={{ width: `${46 + ((i * 17) % 30)}%` }} />
        </div>
      ))}
    </div>
  )
}
