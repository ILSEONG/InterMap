import { useEffect, useRef, useState } from 'react'
import happy from '../assets/turtle-happy.svg'
import rest from '../assets/turtle-rest.svg'
import wave from '../assets/turtle-wave.svg'
import { chatLines, pickGreeting, rememberVisit } from '../lib/pet'
import type { PetAction, PetLine, PetMood } from '../lib/pet'
import './TurtlePet.css'

// 자세별 그림과 원래 크기(픽셀 칸 수). 화면에는 한 칸을 SCALE px로 그린다
const ART: Record<PetMood, { src: string; w: number; h: number }> = {
  wave: { src: wave, w: 39, h: 33 },
  happy: { src: happy, w: 48, h: 39 },
  rest: { src: rest, w: 51, h: 34 },
}
const SCALE = 1.75

// 앱을 열고 이만큼 뒤에 인사한다 (지도가 먼저 자리를 잡게)
const GREET_AFTER_MS = 1200
// 말풍선이 떠 있는 시간 — 인사는 잠깐
const BUBBLE_MS = 8000

interface TurtlePetProps {
  userId: number
  nickname: string
  hasFavorites: boolean
  // 다른 화면이 지도를 덮고 있으면 잠시 숨는다 (말풍선 타이머는 계속 간다)
  hidden: boolean
  onAction: (action: PetAction) => void
}

// 지도 왼쪽 아래에 사는 거북이. 앱을 열면 상황에 맞는 한마디를 건네고(lib/pet), 말풍선은 곧 사라진다.
// 거북이는 작게 남아 있다가, 누르면 한마디 더 한다.
export default function TurtlePet({ userId, nickname, hasFavorites, hidden, onAction }: TurtlePetProps) {
  const [line, setLine] = useState<PetLine | null>(null)
  const [mood, setMood] = useState<PetMood>('rest')
  const chatIndex = useRef(0)
  // 인사는 사람마다 앱을 켠 동안 한 번 — 즐겨찾기 목록이 늦게 와서 다시 그려져도 또 인사하지 않는다
  const latest = useRef({ nickname, hasFavorites })
  useEffect(() => {
    latest.current = { nickname, hasFavorites }
  }, [nickname, hasFavorites])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const greeting = pickGreeting(userId, latest.current.nickname, latest.current.hasFavorites)
      rememberVisit(userId, greeting !== null)
      if (greeting) {
        setLine(greeting)
        setMood(greeting.mood)
      }
    }, GREET_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [userId])

  // 말풍선은 잠깐 떠 있다 사라진다
  useEffect(() => {
    if (!line) return
    const timer = window.setTimeout(() => setLine(null), BUBBLE_MS)
    return () => window.clearTimeout(timer)
  }, [line])

  function talk() {
    if (line) {
      setLine(null)
      return
    }
    const lines = chatLines(hasFavorites)
    const next = lines[chatIndex.current % lines.length]
    chatIndex.current += 1
    setLine(next)
    setMood(next.mood)
  }

  return (
    <div className="pet" hidden={hidden}>
      <button type="button" className="pet__turtle" onClick={talk} aria-label={line ? '거북이 말풍선 닫기' : '거북이에게 말 걸기'}>
        <img key={mood} src={ART[mood].src} alt="" width={Math.round(ART[mood].w * SCALE)} height={Math.round(ART[mood].h * SCALE)} />
      </button>
      {line && (
        <div className="pet__bubble" role="status">
          <button type="button" className="pet__close" onClick={() => setLine(null)} aria-label="말풍선 닫기">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <p className="pet__title">{line.title}</p>
          <p className="pet__body">{line.body}</p>
          {line.action && (
            <button
              type="button"
              className="pet__action"
              onClick={() => {
                const action = line.action
                setLine(null)
                if (action) onAction(action)
              }}
            >
              {line.actionLabel}
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
