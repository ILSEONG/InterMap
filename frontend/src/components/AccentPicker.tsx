import { useRef, useState } from 'react'
import { ACCENT_PRESETS, DEFAULT_ACCENT, hexToHsv, hsvToHex, isHex } from '../lib/theme'
import { RatingStar } from './Stars'
import './AccentPicker.css'

interface AccentPickerProps {
  value: string
  onChange: (hex: string) => void
}

// 포인트 색 고르기 — 미리 골라 둔 색 + 어떤 색이든 고르는 색상판(채도·밝기 판, 색조 막대, 색 코드 입력).
// 고르는 즉시 앱 전체에 입혀진다 (위 미리보기와 뒤 화면이 같이 바뀐다)
export default function AccentPicker({ value, onChange }: AccentPickerProps) {
  // 색조는 따로 들고 있는다 — 회색·검정(채도 0)에서는 색 코드만으로 색조를 알 수 없어 막대가 0으로 튄다
  const [hsv, setHsv] = useState(() => hexToHsv(value))
  const [text, setText] = useState(value)
  const padRef = useRef<HTMLDivElement>(null)
  const [h, s, v] = hsv

  const pick = (next: [number, number, number]) => {
    setHsv(next)
    const hex = hsvToHex(...next)
    setText(hex)
    onChange(hex)
  }
  const pickHex = (hex: string) => {
    setHsv(hexToHsv(hex))
    setText(hex)
    onChange(hex)
  }

  // 채도(가로)·밝기(세로) 판 — 누르거나 끄는 자리의 색
  const onPad = (e: React.PointerEvent) => {
    const el = padRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    pick([h, x, 1 - y])
  }

  return (
    <div className="accent-picker">
      <div className="accent-picker__preview" aria-hidden="true">
        <span className="accent-picker__sample-rating">
          <RatingStar />
          4.7
        </span>
        <span className="accent-picker__sample-flag">새 후기 1개</span>
        <span className="accent-picker__sample-badge">3</span>
        <span className="accent-picker__sample-tint">이웃 추천</span>
        <span className="accent-picker__sample-bar">
          <i />
        </span>
      </div>

      <div className="accent-picker__presets" role="group" aria-label="추천 색">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.hex}
            type="button"
            className={`accent-picker__swatch${value.toLowerCase() === p.hex ? ' accent-picker__swatch--on' : ''}`}
            style={{ background: p.hex }}
            aria-label={p.name}
            aria-pressed={value.toLowerCase() === p.hex}
            onClick={() => pickHex(p.hex)}
          />
        ))}
      </div>

      <p className="accent-picker__label">직접 고르기</p>
      <div
        ref={padRef}
        className="accent-picker__pad"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          onPad(e)
        }}
        onPointerMove={(e) => e.buttons > 0 && onPad(e)}
        role="img"
        aria-label="채도와 밝기"
      >
        <span className="accent-picker__thumb" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: value }} />
      </div>
      <input
        className="accent-picker__hue"
        type="range"
        min={0}
        max={360}
        step={1}
        value={Math.round(h)}
        onChange={(e) => pick([Number(e.target.value), s, v])}
        aria-label="색조"
      />

      <div className="accent-picker__row">
        <label className="accent-picker__hex">
          <span className="accent-picker__chip" style={{ background: value }} />
          <input
            type="text"
            value={text}
            onChange={(e) => {
              const raw = e.target.value.trim()
              const next = raw.startsWith('#') ? raw : `#${raw}`
              setText(next)
              if (isHex(next)) {
                setHsv(hexToHsv(next))
                onChange(next.toLowerCase())
              }
            }}
            maxLength={7}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label="색 코드"
          />
        </label>
        <button type="button" className="accent-picker__reset" onClick={() => pickHex(DEFAULT_ACCENT)} disabled={value.toLowerCase() === DEFAULT_ACCENT}>
          기본 색으로
        </button>
      </div>
      <p className="accent-picker__hint">고른 색은 이 기기에만 적용돼요. 밝은 색을 고르면 그 위 글자는 자동으로 어둡게 바뀌어요.</p>
    </div>
  )
}
