import { useState } from 'react'
import type { CommonPlace, TasteMatch } from '../lib/taste'
import { iGa, MIN_COMMON } from '../lib/taste'
import { useBackLayer } from '../lib/backLayer'
import { RatingStar } from './Stars'
import { ShareIcon } from './PollIcons'
import './ModalSheet.css'
import './TasteMatchSection.css'
import SheetGrip from './SheetGrip'

export interface OtherPlace {
  key: string
  name: string
  category: string | null
  area: string
  rating: number
}

interface TasteMatchSectionProps {
  name: string
  match: TasteMatch
  // 상대는 가 봤고 나는 아직 안 가 본 곳 — 겹치는 곳이 적을 때 보여 준다
  others: OtherPlace[]
  // 서로 팔로우일 때만 궁합 카드를 밖으로 공유할 수 있다
  canShare: boolean
  onPickPlace: (key: string) => void
  onShare: () => void
}

const pos = (v: number) => `${((v - 1) / 4) * 100}%`
const PREVIEW = 3

function badgeOf(p: CommonPlace): [string, string] {
  const gap = Math.abs(p.mine - p.theirs)
  if (gap === 0) return ['same', '같아요']
  if (gap <= 0.5) return ['near', '비슷해요']
  return ['diff', '달라요']
}

// 친구 프로필 속 "나와의 입맛 궁합" — 둘 다 후기를 남긴 가게의 별점으로 계산한다 (lib/taste)
export default function TasteMatchSection({ name, match, others, canShare, onPickPlace, onShare }: TasteMatchSectionProps) {
  const [howOpen, setHowOpen] = useState(false)
  const [all, setAll] = useState(false)
  useBackLayer(howOpen, () => setHowOpen(false))
  const n = match.common.length
  const places = all ? match.common : match.common.slice(0, PREVIEW)

  return (
    <>
      <section className="taste" aria-labelledby="taste-title">
        <div className="taste__head">
          <h3 id="taste-title" className="taste__title">
            나와의 입맛 궁합
          </h3>
          <button type="button" className="taste__how" onClick={() => setHowOpen(true)}>
            계산 방법
            <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </button>
        </div>

        {match.ready ? (
          <>
            <p className="taste__score">
              <span className="taste__percent">{match.score}%</span>
              <span className="taste__headline">{match.headline}</span>
            </p>
            <span className="taste__chip">{match.title}</span>
            <p className="taste__lead">
              {match.lead}
              {match.insight && ` ${match.insight}`}
            </p>

            {match.genres.length > 0 && (
              <div className="taste__chart" role="img" aria-label="분류별 평균 별점 비교">
                <div className="taste__legend" aria-hidden="true">
                  <span>
                    <i className="taste__dot taste__dot--me" />나
                  </span>
                  <span>
                    <i className="taste__dot taste__dot--you" />
                    {name}
                  </span>
                  <span className="taste__legend-note">분류별 평균 별점</span>
                </div>
                {match.genres.map((g) => {
                  const lo = Math.min(g.mine, g.theirs)
                  const hi = Math.max(g.mine, g.theirs)
                  return (
                    <div key={g.name} className="taste__row">
                      <span className="taste__genre">
                        {g.name} · {g.count}곳
                      </span>
                      <span className="taste__track">
                        <i className="taste__line" style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }} />
                        {g.mine === g.theirs ? (
                          <i className="taste__dot taste__dot--same" style={{ left: pos(g.mine) }} />
                        ) : (
                          <>
                            <i className="taste__dot taste__dot--me" style={{ left: pos(g.mine) }} />
                            <i className="taste__dot taste__dot--you" style={{ left: pos(g.theirs) }} />
                          </>
                        )}
                      </span>
                    </div>
                  )
                })}
                <div className="taste__axis" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <span key={v} style={{ left: pos(v) }}>
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {canShare && (
              <button type="button" className="taste__share" onClick={onShare}>
                <ShareIcon size={18} /> 궁합 카드 공유하기
              </button>
            )}
          </>
        ) : (
          <>
            <p className="taste__empty-title">아직 궁합을 보기엔 겹치는 곳이 적어요</p>
            <p className="taste__lead">
              {n === 0
                ? `둘 다 가 본 곳이 아직 없어요. ${MIN_COMMON}곳이 겹치면 궁합을 볼 수 있어요.`
                : `둘 다 가 본 곳이 ${n}곳이에요. ${MIN_COMMON - n}곳만 더 겹치면 궁합을 볼 수 있어요.`}
            </p>
            <div className="taste__progress" aria-label={`${n} / ${MIN_COMMON}곳`}>
              {Array.from({ length: MIN_COMMON }, (_, i) => (
                <i key={i} className={i < n ? 'taste__step taste__step--on' : 'taste__step'} />
              ))}
            </div>
            <p className="taste__progress-label">
              {n} / {MIN_COMMON}곳
            </p>
          </>
        )}
      </section>

      {n > 0 && (
        <section className="taste-list" aria-labelledby="taste-common">
          <div className="taste-list__head">
            <h3 id="taste-common">둘 다 가 본 곳</h3>
            <span>{n}곳</span>
          </div>
          <ul>
            {places.map((p) => {
              const [tone, label] = badgeOf(p)
              return (
                <li key={p.key}>
                  <button type="button" className="taste-list__item" onClick={() => onPickPlace(p.key)}>
                    <span className="taste-list__text">
                      <span className="taste-list__name">{p.name}</span>
                      <span className="taste-list__sub">{p.category ?? '음식점'}</span>
                    </span>
                    <span className="taste-list__ratings">
                      <span>
                        나 <RatingStar />
                        {p.mine.toFixed(1)}
                      </span>
                      <span>
                        {name} <RatingStar />
                        {p.theirs.toFixed(1)}
                      </span>
                    </span>
                    <span className={`taste-list__badge taste-list__badge--${tone}`}>{label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {n > PREVIEW && (
            <button type="button" className="taste-list__more" onClick={() => setAll((v) => !v)}>
              {all ? '접기' : `${n}곳 모두 보기`}
            </button>
          )}
        </section>
      )}

      {!match.ready && others.length > 0 && (
        <section className="taste-list" aria-labelledby="taste-others">
          <div className="taste-list__head">
            <h3 id="taste-others">{iGa(name)} 다녀온 곳 중 나만 안 가 본 곳</h3>
          </div>
          <ul>
            {others.map((p) => (
              <li key={p.key}>
                <button type="button" className="taste-list__item" onClick={() => onPickPlace(p.key)}>
                  <span className="taste-list__text">
                    <span className="taste-list__name">{p.name}</span>
                    <span className="taste-list__sub">
                      {p.category ?? '음식점'}
                      {p.area && ` · ${p.area}`}
                    </span>
                  </span>
                  <span className="taste-list__ratings taste-list__ratings--one">
                    <span>
                      <RatingStar />
                      {p.rating.toFixed(1)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {howOpen && (
        <div className="modal-layer" onClick={(e) => e.target === e.currentTarget && setHowOpen(false)}>
          <div className="modal-sheet taste-how" role="dialog" aria-modal="true" aria-labelledby="taste-how-title">
            <SheetGrip onClose={() => setHowOpen(false)} />
            <header className="modal-sheet__header">
              <h2 id="taste-how-title" className="modal-sheet__title">
                입맛 궁합은 이렇게 계산해요
              </h2>
            </header>
            <div className="modal-sheet__body">
              <ol className="taste-how__steps">
                <li>
                  <b>둘 다 가 본 곳을 찾아요</b>
                  <p>두 사람이 각각 후기를 남긴 같은 가게를 짝지어요. 같이 갔는지는 상관없어요.</p>
                </li>
                <li>
                  <b>가게마다 별점 차이를 재요</b>
                  <p>차이가 작을수록 점수가 높아요.</p>
                  <p className="taste-how__table">
                    별점 차이 0점 → 100%
                    <br />
                    평균 0.5점 → 88% · 평균 1점 → 75%
                    <br />
                    평균 2점 → 50% · 평균 4점 → 0%
                  </p>
                </li>
                <li>
                  <b>칭호를 붙여요</b>
                  <p>
                    둘 다 가 본 곳 중 절반 이상이 같은 분류면 그 분류를 앞에 붙이고, 점수에 따라 단짝(80% 이상) · 잘 통하는
                    사이(60~79%) · 입맛 정반대(60% 미만)로 불러요.
                  </p>
                </li>
                <li>
                  <b>{MIN_COMMON}곳부터 보여 줘요</b>
                  <p>둘 다 가 본 곳이 {MIN_COMMON}곳보다 적으면 점수가 들쭉날쭉해서 아직 보여 주지 않아요.</p>
                </li>
              </ol>
            </div>
            <div className="modal-sheet__actions">
              <button type="button" className="modal-sheet__btn" onClick={() => setHowOpen(false)}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
