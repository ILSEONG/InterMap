import { useEffect, useRef, useState } from 'react'
import rabbitHappy from '../assets/rabbit-happy.png'
import rabbitRest from '../assets/rabbit-rest.png'
import rabbitWave from '../assets/rabbit-wave.png'
import happy from '../assets/turtle-happy.png'
import rest from '../assets/turtle-rest.png'
import wave from '../assets/turtle-wave.png'
import type { PetCharacter } from '../lib/character'
import { chatLines, pickGreeting, rememberVisit } from '../lib/pet'
import type { PetAction, PetLine, PetMood } from '../lib/pet'
import './TurtlePet.css'

// 자세별 그림과 화면에 그릴 크기.
// 거북이는 원본 시안에서 그대로 오린 것 — 몸집이 세 장 모두 비슷하게 보이도록 맞췄다.
// 토끼도 원본 시안(인사·점프·앉아 있는 그림)에서 그대로 오린 것 — 머리 크기가 거북이와 비슷하게 보이도록 맞췄다. 그림은 화면 크기의 3배로 담았다
const ART: Record<PetCharacter, Record<PetMood, { src: string; w: number; h: number }>> = {
  turtle: {
    wave: { src: wave, w: 66, h: 65 },
    happy: { src: happy, w: 78, h: 51 },
    rest: { src: rest, w: 76, h: 50 },
  },
  rabbit: {
    wave: { src: rabbitWave, w: 59, h: 71 },
    happy: { src: rabbitHappy, w: 66, h: 79 },
    rest: { src: rabbitRest, w: 52, h: 71 },
  },
}

const NAME: Record<PetCharacter, string> = { turtle: '거북이', rabbit: '토끼' }

// 앱을 열고 이만큼 뒤에 인사한다 — 거북이가 걸어 들어와 자리를 잡은 직후 (TurtlePet.css의 pet-enter: 450ms 기다렸다 1200ms)
const GREET_AFTER_MS = 1750
// 말풍선이 떠 있는 시간 — 인사는 잠깐
const BUBBLE_MS = 8000

interface TurtlePetProps {
  userId: number
  nickname: string
  // 다른 화면이 지도를 덮고 있으면 잠시 안 보인다 (말풍선 타이머는 계속 간다).
  // 자리는 그대로 지킨다 — 덮은 화면이 걷히면 걸어 들어오지 않고 그 자리에 그대로 있다
  hidden: boolean
  // 어느 캐릭터로 설지 (맛집 화면은 거북이, 카페 화면은 토끼) — 안 주면 거북이
  character?: PetCharacter
  // 밖에서 건네는 한마디 (카페 화면에 처음 들어왔을 때의 안내) — 값이 생기면 그 말풍선을 띄운다
  hint?: PetLine | null
  onAction: (action: PetAction) => void
}

// 지도 왼쪽 아래에 사는 거북이(카페 화면에서는 토끼). 앱을 열면 상황에 맞는 한마디를 건네고(lib/pet), 말풍선은 곧 사라진다.
// 작게 남아 있다가, 누르면 한마디 더 한다. 캐릭터가 바뀌어도 하던 말과 자세는 그대로 잇는다
export default function TurtlePet({ userId, nickname, hidden, character = 'turtle', hint = null, onAction }: TurtlePetProps) {
  const [line, setLine] = useState<PetLine | null>(null)
  // 걸어 들어올 때는 서 있는 자세로 — 자리를 잡으면 인사하는 자세로, 오늘 이미 인사했으면 엎드린다
  const [mood, setMood] = useState<PetMood>('wave')
  const chatIndex = useRef(0)
  // 인사는 사람마다 앱을 켠 동안 한 번 — 닉네임이 바뀌어 다시 그려져도 또 인사하지 않는다
  const latestNickname = useRef(nickname)
  useEffect(() => {
    latestNickname.current = nickname
  }, [nickname])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const greeting = pickGreeting(userId, latestNickname.current)
      rememberVisit(userId, greeting !== null)
      // 그사이 다른 말(밤의 카페 안내)을 하고 있으면 그 말을 끊지 않는다
      if (greeting) setLine((now) => now ?? greeting)
      setMood(greeting ? greeting.mood : 'rest')
    }, GREET_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [userId])

  useEffect(() => {
    if (!hint) return
    setLine(hint)
    setMood(hint.mood)
  }, [hint])

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
    const lines = chatLines(nickname)
    const next = lines[chatIndex.current % lines.length]
    chatIndex.current += 1
    setLine(next)
    setMood(next.mood)
  }

  const art = ART[character][mood]
  return (
    <div className={`pet${hidden ? ' pet--away' : ''}`} aria-hidden={hidden || undefined}>
      <button type="button" className="pet__turtle" onClick={talk} aria-label={line ? `${NAME[character]} 말풍선 닫기` : `${NAME[character]}에게 말 걸기`}>
        {/* key: 자세나 캐릭터가 바뀌면 그림을 새로 그려 "뿅" 하고 바뀐다 */}
        <img key={`${character}-${mood}`} className={`pet__img pet__img--${mood}`} src={art.src} alt="" width={art.w} height={art.h} />
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
