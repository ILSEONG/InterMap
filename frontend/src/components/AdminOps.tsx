import { useCallback, useEffect, useState } from 'react'
import { fetchOps } from '../lib/api'
import type { OpsData } from '../lib/api'
import { timeAgo } from '../lib/time'
import './ModalSheet.css'
import './AdminOps.css'
import SheetGrip from './SheetGrip'

// 운영 관리자 전용 — 서버가 잘 돌고 있는지 한 화면에서 본다.
// 위에서부터: 요약 → 바깥 서비스(메일·푸시·간편 로그인) → 시간대별 요청 → 시간을 많이 쓰는 API → 최근 경고·오류 → 쌓인 데이터.
// 요청·오류 숫자는 서버 메모리에 있어 서버가 다시 켜지면 0부터 다시 센다 (맨 위에 켜진 지 얼마나 됐는지 적는다).

const EXTERNAL_NAMES: Record<string, string> = {
  mail: '인증번호 메일',
  push: '푸시 알림',
  'login:naver': '네이버 로그인',
  'login:kakao': '카카오 로그인',
  'login:google': 'Google 로그인',
  'login:apple': 'Apple 로그인',
}

const num = (n: number) => n.toLocaleString('ko-KR')
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}초` : `${n}ms`)
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`

function uptime(startedAt: string, now: string): string {
  const min = Math.max(0, Math.floor((Date.parse(now) - Date.parse(startedAt)) / 60_000))
  if (min < 60) return `${min}분`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}시간 ${min % 60}분`
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간`
}

const KST_HOUR = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false })
const hourOf = (iso: string) => Number(KST_HOUR.format(new Date(iso)).replace(/\D/g, '')) % 24

// 시간대별 요청 수 막대 (최근 24시간). 막대를 누르면 그 시간의 요청·오류·평균 응답이 아래에 뜬다.
// 오류가 있던 시간은 막대 위에 표시를 얹는다 — 색만으로 알리지 않게 누르면 건수가 글로도 나온다.
function HourChart({ hours }: { hours: OpsData['traffic']['hours'] }) {
  const [picked, setPicked] = useState<number | null>(null)
  const max = Math.max(1, ...hours.map((h) => h.count))
  const shown = picked !== null ? hours[picked] : null
  return (
    <div className="admin-ops__chart">
      <div className="admin-ops__bars" role="group" aria-label="최근 24시간 시간대별 요청 수">
        {hours.map((h, i) => (
          <button
            key={h.at}
            type="button"
            className={`admin-ops__bar${picked === i ? ' admin-ops__bar--on' : ''}`}
            aria-pressed={picked === i}
            aria-label={`${hourOf(h.at)}시 요청 ${h.count}건, 오류 ${h.errors}건`}
            onClick={() => setPicked(picked === i ? null : i)}
            onMouseEnter={() => setPicked(i)}
            onMouseLeave={() => setPicked(null)}
          >
            {h.errors > 0 && <span className="admin-ops__bar-flag" aria-hidden="true" />}
            <span className="admin-ops__bar-fill" style={{ height: `${h.count === 0 ? 0 : Math.max(3, (h.count / max) * 100)}%` }} />
          </button>
        ))}
      </div>
      <div className="admin-ops__axis" aria-hidden="true">
        {hours.map((h, i) => (
          <span key={h.at}>{i % 6 === 0 || i === hours.length - 1 ? `${hourOf(h.at)}시` : ''}</span>
        ))}
      </div>
      <p className="admin-ops__chart-note" role="status">
        {shown
          ? `${hourOf(shown.at)}시 · 요청 ${num(shown.count)}건${shown.errors > 0 ? ` · 오류 ${num(shown.errors)}건` : ''}${shown.count > 0 ? ` · 평균 ${ms(shown.avgMs)}` : ''}`
          : `가장 많은 시간 ${num(max === 1 && hours.every((h) => h.count === 0) ? 0 : max)}건 · 막대를 누르면 자세히 보여요`}
      </p>
    </div>
  )
}

export default function AdminOps({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<OpsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchOps())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const errorRate = data && data.traffic.total > 0 ? (data.traffic.errors / data.traffic.total) * 100 : 0
  const failing = data ? data.external.filter((e) => e.fail > 0 && (!e.lastOkAt || (e.lastFailAt ?? '') > e.lastOkAt)) : []

  return (
    <div className="modal-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet modal-sheet--tall" role="dialog" aria-modal="true" aria-labelledby="admin-ops-title">
        <SheetGrip onClose={onClose} />
        <header className="modal-sheet__header">
          <h2 id="admin-ops-title" className="modal-sheet__title">
            서버 상태
          </h2>
          <button type="button" className="modal-sheet__icon-btn" onClick={() => void load()} disabled={loading} aria-label="새로 고침">
            <svg aria-hidden="true" className={loading ? 'admin-ops__spin' : undefined} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 11a8 8 0 1 0-2.3 6.2" />
              <path d="M20 4v7h-7" />
            </svg>
          </button>
          <button type="button" className="modal-sheet__icon-btn" onClick={onClose} aria-label="닫기">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <div className="modal-sheet__body">
          {error && (
            <p className="modal-sheet__error" role="alert">
              {error}
            </p>
          )}
          {!data ? (
            !error && (
              <p className="modal-sheet__lead" role="status">
                불러오는 중…
              </p>
            )
          ) : (
            <>
              <p className="admin-ops__lead">
                서버가 켜진 지 <strong>{uptime(data.server.startedAt, data.server.now)}</strong> · 요청과 오류는 그때부터 센 값이에요
              </p>

              {failing.length > 0 && (
                <p className="admin-ops__alert" role="alert">
                  <span aria-hidden="true">!</span>
                  {failing.map((e) => EXTERNAL_NAMES[e.name] ?? e.name).join(', ')} — 마지막 호출이 실패했어요
                </p>
              )}

              <dl className="admin-ops__tiles">
                <div className="admin-ops__tile">
                  <dt>요청 (24시간)</dt>
                  <dd>{num(data.traffic.total)}</dd>
                </div>
                <div className="admin-ops__tile">
                  <dt>서버 오류</dt>
                  <dd>
                    {num(data.traffic.errors)}
                    <small>{data.traffic.total > 0 ? `${errorRate.toFixed(errorRate < 10 ? 1 : 0)}%` : '—'}</small>
                  </dd>
                </div>
                <div className="admin-ops__tile">
                  <dt>평균 응답</dt>
                  <dd>{data.traffic.total > 0 ? ms(data.traffic.avgMs) : '—'}</dd>
                </div>
                <div className="admin-ops__tile">
                  <dt>메모리</dt>
                  <dd>
                    {num(data.server.heapUsedMb)}
                    <small>/ {num(data.server.heapMaxMb)}MB</small>
                  </dd>
                </div>
              </dl>

              <section className="admin-ops__section">
                <h3>바깥 서비스</h3>
                {data.external.length === 0 ? (
                  <p className="admin-ops__empty">서버가 켜진 뒤로 메일·푸시·간편 로그인 호출이 아직 없어요.</p>
                ) : (
                  <ul className="admin-ops__list">
                    {data.external.map((e) => {
                      const bad = e.fail > 0 && (!e.lastOkAt || (e.lastFailAt ?? '') > e.lastOkAt)
                      return (
                        <li key={e.name} className="admin-ops__item">
                          <div className="admin-ops__item-head">
                            <strong>{EXTERNAL_NAMES[e.name] ?? e.name}</strong>
                            <span className={`admin-ops__state${bad ? ' admin-ops__state--bad' : ''}`}>
                              {bad ? '실패 중' : e.fail > 0 ? '지금은 정상' : '정상'}
                            </span>
                          </div>
                          <p className="admin-ops__meta">
                            성공 {num(e.ok)}건 · 실패 {num(e.fail)}건
                            {e.lastFailAt && ` · 마지막 실패 ${timeAgo(e.lastFailAt)}`}
                          </p>
                          {e.lastError && <p className="admin-ops__code">{e.lastError}</p>}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <section className="admin-ops__section">
                <h3>시간대별 요청</h3>
                <HourChart hours={data.traffic.hours} />
              </section>

              <section className="admin-ops__section">
                <h3>시간을 많이 쓰는 API</h3>
                {data.routes.length === 0 ? (
                  <p className="admin-ops__empty">아직 들어온 요청이 없어요.</p>
                ) : (
                  <ul className="admin-ops__list">
                    {data.routes.map((r) => (
                      <li key={r.route} className="admin-ops__item">
                        <p className="admin-ops__route">{r.route}</p>
                        <p className="admin-ops__meta">
                          {num(r.count)}번 · 평균 {ms(r.avgMs)} · 느린 편(p95) {ms(r.p95Ms)} · 최대 {ms(r.maxMs)}
                          {r.errors > 0 && <span className="admin-ops__bad"> · 오류 {num(r.errors)}건</span>}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {data.slow.length > 0 && (
                  <>
                    <h4>1초 넘게 걸린 최근 요청</h4>
                    <ul className="admin-ops__list">
                      {data.slow.slice(0, 8).map((s, i) => (
                        <li key={`${s.at}-${i}`} className="admin-ops__item">
                          <p className="admin-ops__route">{s.route}</p>
                          <p className="admin-ops__meta">
                            {ms(s.ms)} · 응답 {s.status} · {timeAgo(s.at)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <section className="admin-ops__section">
                <h3>
                  최근 경고·오류
                  <small>
                    오류 {num(data.logs.errors)} · 경고 {num(data.logs.warnings)}
                  </small>
                </h3>
                {data.logs.recent.length === 0 ? (
                  <p className="admin-ops__empty">서버가 켜진 뒤로 경고나 오류가 없어요.</p>
                ) : (
                  <ul className="admin-ops__list">
                    {data.logs.recent.slice(0, 20).map((l, i) => (
                      <li key={`${l.at}-${i}`} className="admin-ops__item">
                        <div className="admin-ops__item-head">
                          <span className={`admin-ops__state${l.level === 'ERROR' ? ' admin-ops__state--bad' : ''}`}>
                            {l.level === 'ERROR' ? '오류' : '경고'}
                          </span>
                          <span className="admin-ops__meta">
                            {l.logger} · {timeAgo(l.at)}
                          </span>
                        </div>
                        <p className="admin-ops__log">{l.message}</p>
                        {l.error && <p className="admin-ops__code">{l.error}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="admin-ops__section">
                <h3>쌓인 데이터</h3>
                <dl className="admin-ops__facts">
                  <div>
                    <dt>회원</dt>
                    <dd>
                      {num(data.data.users)}명
                      <small>
                        오늘 +{num(data.data.usersToday)} · 7일 +{num(data.data.usersWeek)}
                      </small>
                    </dd>
                  </div>
                  <div>
                    <dt>후기</dt>
                    <dd>
                      {num(data.data.reviews)}개<small>오늘 +{num(data.data.reviewsToday)}</small>
                    </dd>
                  </div>
                  <div>
                    <dt>댓글</dt>
                    <dd>{num(data.data.comments)}개</dd>
                  </div>
                  <div>
                    <dt>처리 전 신고</dt>
                    <dd>{num(data.data.openReports)}건</dd>
                  </div>
                  <div>
                    <dt>푸시 받는 회원</dt>
                    <dd>{num(data.data.pushDevices)}명</dd>
                  </div>
                  {data.data.dbBytes !== null && (
                    <div>
                      <dt>DB 용량</dt>
                      <dd>
                        {mb(data.data.dbBytes)}
                        {data.data.photoBytes !== null && <small>그중 사진 {mb(data.data.photoBytes)}</small>}
                      </dd>
                    </div>
                  )}
                  {data.server.dbPool && (
                    <div>
                      <dt>DB 연결</dt>
                      <dd>
                        사용 {data.server.dbPool.active} · 대기 {data.server.dbPool.waiting}
                        <small>최대 {data.server.dbPool.max}</small>
                      </dd>
                    </div>
                  )}
                </dl>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
