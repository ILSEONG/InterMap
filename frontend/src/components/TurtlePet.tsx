import { useEffect, useRef, useState } from 'react'
import happy from '../assets/turtle-happy.png'
import rest from '../assets/turtle-rest.png'
import wave from '../assets/turtle-wave.png'
import { chatLines, pickGreeting, rememberVisit } from '../lib/pet'
import type { PetAction, PetLine, PetMood } from '../lib/pet'
import './TurtlePet.css'

// 자세별 그림(원본 시안에서 그대로 오린 것)과 화면에 그릴 크기 — 거북이 몸집이 세 장 모두 비슷하게 보이도록 맞췄다
const ART: Record<PetMood, { src: string; w: number; h: number }> = {
  wave: { src: wave, w: 66, h: 65 },
  happy: { src: happy, w: 78, h: 51 },
  rest: { src: rest, w: 76, h: 50 },
}

// 앱을 열고 이만큼 뒤에 인사한다 — 거북이가 걸어 들어와 자리를 잡은 직후 (TurtlePet.css의 pet-enter: 450ms 기다렸다 1200ms)
const GREET_AFTER_MS = 1750
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
  // 걸어 들어올 때는 서 있는 자세로 — 자리를 잡으면 인사하는 자세로, 오늘 이미 인사했으면 엎드린다
  const [mood, setMood] = useState<PetMood>('wave')
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
      if (greeting) setLine(greeting)
      setMood(greeting ? greeting.mood : 'rest')
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
    const lines = chatLines(nickname, hasFavorites)
    const next = lines[chatIndex.current % lines.length]
    chatIndex.current += 1
    setLine(next)
    setMood(next.mood)
  }

  return (
    <div className="pet" hidden={hidden}>
      <button type="button" className="pet__turtle" onClick={talk} aria-label={line ? '거북이 말풍선 닫기' : '거북이에게 말 걸기'}>
        <img key={mood} className={`pet__img pet__img--${mood}`} src={ART[mood].src} alt="" width={ART[mood].w} height={ART[mood].h} />
      </button>
      {line && (
        <div className="pet__bubble" role="status">
          <button type="button" className="pet__close" onClick={() => setLine(null)} aria-label="말풍선 닫기">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <p className="pet__title">{line.title}</p>
          <p className="pet__body">
            {line.icon === 'star' ? (
              <>
                {/* 별이 혼자 다음 줄로 떨어지지 않게 마지막 낱말과 묶는다 */}
                {line.body.slice(0, line.body.lastIndexOf(' ') + 1)}
                <span className="pet__tail">
                  {line.body.slice(line.body.lastIndexOf(' ') + 1)}
                  <svg className="pet__star" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
                    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
                  </svg>
                </span>
              </>
            ) : (
              line.body
            )}
          </p>
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
