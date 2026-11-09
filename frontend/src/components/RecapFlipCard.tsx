import { useEffect, useRef } from 'react'

interface RecapFlipCardProps {
  frontUrl: string
  backUrl: string
  alt: string
  flipped: boolean
  onFlippedChange: (flipped: boolean) => void
}

// 스프링 — 반 바퀴에 0.5초 남짓, 끝에서 5%쯤 넘쳤다가 자리 잡는다 (감쇠비 약 0.67)
const STIFFNESS = 95
const DAMPING = 13
// 손가락을 이만큼 안 움직였으면 끌기가 아니라 누르기
const TAP_SLOP = 6

// 180°의 홀수 배면 뒷면 (각도는 0·180에 묶이지 않고 이어진다)
const isBack = (angle: number) => Math.abs(Math.round(angle / 180)) % 2 === 1

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

// 월간 결산 카드 — 누르거나 좌우로 끌어서 앞·뒤를 넘긴다.
// 각도 하나를 스프링으로 움직이고, 거기서 들림(크기·그림자)과 표면 빛을 함께 계산한다.
// 매 프레임 React 상태를 바꾸지 않고 DOM 스타일만 바꾼다 (이미지 두 장이 다시 그려지지 않게).
export default function RecapFlipCard({ frontUrl, backUrl, alt, flipped, onFlippedChange }: RecapFlipCardProps) {
  const rootRef = useRef<HTMLButtonElement>(null)
  const innerRef = useRef<HTMLSpanElement>(null)
  const motion = useRef({ angle: flipped ? 180 : 0, velocity: 0, target: flipped ? 180 : 0, frame: 0, last: 0 })
  const drag = useRef<{ x: number; startAngle: number; lastX: number; lastT: number; moved: boolean; v: number } | null>(null)

  // 각도 → 화면. 90°에서 가장 높이 들리고 빛이 가장 밝다
  function paint() {
    const el = innerRef.current
    if (!el) return
    const { angle } = motion.current
    const lift = Math.abs(Math.sin((angle * Math.PI) / 180))
    el.style.transform = `translateZ(0) rotateY(${angle}deg) scale(${1 + 0.05 * lift})`
    el.style.setProperty('--lift', lift.toFixed(3))
    // 빛줄기는 넘기는 방향으로 카드 면을 가로지른다 (음수 각도도 0~100%로)
    el.style.setProperty('--sheen-x', `${(((angle % 180) + 180) % 180) / 1.8}%`)
  }

  function step(now: number) {
    const m = motion.current
    const dt = Math.min(0.032, (now - (m.last || now)) / 1000 || 0.016)
    m.last = now
    const accel = (m.target - m.angle) * STIFFNESS - m.velocity * DAMPING
    m.velocity += accel * dt
    m.angle += m.velocity * dt
    paint()
    if (Math.abs(m.target - m.angle) < 0.05 && Math.abs(m.velocity) < 0.05) {
      m.angle = m.target
      m.velocity = 0
      m.frame = 0
      paint()
      return
    }
    m.frame = requestAnimationFrame(step)
  }

  function animateTo(target: number, velocity?: number) {
    const m = motion.current
    m.target = target
    if (velocity !== undefined) m.velocity = velocity
    if (reduceMotion()) {
      m.angle = target
      m.velocity = 0
      paint()
      return
    }
    if (!m.frame) {
      m.last = 0
      m.frame = requestAnimationFrame(step)
    }
  }

  // 앞뒤가 바뀌면(누르기·키보드) 지금 각도에서 같은 방향(앞으로)으로 반 바퀴 더.
  // 각도는 0·180에 묶지 않고 계속 이어진다 — 360°면 다시 앞면, -180°면 뒷면
  useEffect(() => {
    if (drag.current) return
    const m = motion.current
    const showingBack = isBack(m.target)
    if (showingBack !== flipped) animateTo(m.target + 180)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped])

  // 처음 뜰 때 한 번 살짝 들썩여 뒤집을 수 있다는 걸 보여 준다
  useEffect(() => {
    const m = motion.current
    paint()
    if (reduceMotion()) return
    const timer = window.setTimeout(() => {
      if (drag.current || m.target !== 0) return
      m.velocity = -260
      animateTo(0)
    }, 700)
    return () => {
      window.clearTimeout(timer)
      cancelAnimationFrame(m.frame)
      m.frame = 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    drag.current = { x: e.clientX, startAngle: motion.current.angle, lastX: e.clientX, lastT: e.timeStamp, moved: false, v: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current
    const root = rootRef.current
    if (!d || !root) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < TAP_SLOP) return
    d.moved = true
    const width = root.getBoundingClientRect().width || 1
    // 카드 폭만큼 끌면 반 바퀴 — 어느 면에서든 왼쪽·오른쪽 어느 쪽으로도 넘어간다
    const angle = d.startAngle + (dx / width) * 180
    const dt = (e.timeStamp - d.lastT) / 1000
    if (dt > 0) d.v = 0.3 * d.v + 0.7 * ((((e.clientX - d.lastX) / width) * 180) / dt)
    d.lastX = e.clientX
    d.lastT = e.timeStamp
    const m = motion.current
    cancelAnimationFrame(m.frame)
    m.frame = 0
    m.angle = angle
    m.velocity = 0
    paint()
  }

  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (!d.moved) {
      // 누르기 — 반대쪽으로
      onFlippedChange(!flipped)
      return
    }
    // 놓는 순간의 속도까지 더해 가장 가까운 면(180° 배수)으로. 한 번에 반 바퀴까지만 넘긴다
    const m = motion.current
    const projected = m.angle + d.v * 0.18
    let target = Math.round(projected / 180) * 180
    const base = Math.round(d.startAngle / 180) * 180
    target = Math.min(Math.max(target, base - 180), base + 180)
    animateTo(target, d.v)
    const toBack = isBack(target)
    if (toBack !== flipped) onFlippedChange(toBack)
  }

  return (
    <button
      ref={rootRef}
      type="button"
      className="recap-flip"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => {
        // 키보드(Enter·Space)로 누른 경우만 — 손가락·마우스는 onPointerUp이 처리한다
        if (e.detail === 0) onFlippedChange(!flipped)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') onFlippedChange(!flipped)
      }}
      aria-label={flipped ? '앞면 보기' : '뒷면 보기'}
    >
      <span ref={innerRef} className="recap-flip__inner">
        <span className="recap-flip__face">
          <img src={frontUrl} alt={flipped ? '' : alt} draggable={false} />
          <span className="recap-flip__sheen" aria-hidden="true" />
        </span>
        <span className="recap-flip__face recap-flip__face--back">
          <img src={backUrl} alt={flipped ? alt : ''} draggable={false} />
          <span className="recap-flip__sheen" aria-hidden="true" />
        </span>
      </span>
    </button>
  )
}
