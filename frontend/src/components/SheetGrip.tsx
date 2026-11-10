import { useRef } from 'react'
import './SheetGrip.css'

interface SheetGripProps {
  // 끝까지 끌어내리거나 아래로 튕기면 부른다 (시트가 다 내려간 뒤)
  onClose: () => void
}

// 시트 맨 위 손잡이. 하단 시트는 전부 이 손잡이로만 끈다 — 본문을 끌면 본문이 스크롤된다.
// 손잡이를 잡고 내리면 시트가 손가락을 따라 내려가고, 충분히 내리거나 아래로 튕기면 닫힌다. 아니면 제자리로.
// 끄는 대상은 가장 가까운 시트(.modal-sheet / .my-page / .person-panel)라 각 시트에 첫 자식으로 넣기만 하면 된다.
const CLOSE_DISTANCE = 96
const FLICK = 0.6 // px/ms

export default function SheetGrip({ onClose }: SheetGripProps) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startY: number; lastY: number; lastT: number; v: number; dy: number; sheet: HTMLElement } | null>(null)

  const sheetOf = () => ref.current?.closest<HTMLElement>('.modal-sheet, .my-page, .person-panel') ?? null

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const sheet = sheetOf()
    if (!sheet) return
    e.currentTarget.setPointerCapture(e.pointerId)
    // 올라오는 애니메이션이 덮어쓰지 않게 끄고, 손가락을 그대로 따라오게 transition도 끈다
    sheet.style.animation = 'none'
    sheet.style.transition = 'none'
    drag.current = { startY: e.clientY, lastY: e.clientY, lastT: performance.now(), v: 0, dy: 0, sheet }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    const now = performance.now()
    const dt = now - d.lastT
    if (dt > 0) {
      d.v = 0.25 * d.v + 0.75 * ((e.clientY - d.lastY) / dt)
      d.lastY = e.clientY
      d.lastT = now
    }
    const raw = e.clientY - d.startY
    // 위로는 거의 안 움직이게(고무줄), 아래로는 그대로
    d.dy = raw < 0 ? raw * 0.15 : raw
    d.sheet.style.transform = `translateY(${Math.round(d.dy)}px)`
  }

  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (!d) return
    const { sheet } = d
    // 손가락을 멈췄다 떼면 튕긴 게 아니다
    const v = performance.now() - d.lastT > 90 ? 0 : d.v
    sheet.style.transition = 'transform 240ms cubic-bezier(0.32, 0.72, 0, 1)'
    if (d.dy > CLOSE_DISTANCE || (v > FLICK && d.dy > 12)) {
      sheet.style.transform = `translateY(${sheet.offsetHeight + 40}px)`
      window.setTimeout(onClose, 200)
      return
    }
    sheet.style.transform = ''
    window.setTimeout(() => {
      if (!drag.current) sheet.style.transition = ''
    }, 260)
  }

  return (
    <div
      ref={ref}
      className="sheet-grip"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-hidden="true"
    >
      <span className="sheet-grip__bar" />
    </div>
  )
}
