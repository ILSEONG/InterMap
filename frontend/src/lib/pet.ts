import { kstDay } from './time'

// 지도 왼쪽 아래 거북이가 건네는 한마디. 상황에 따라 하나만 고른다 — 인사는 잠깐, 친구는 작게.
export type PetMood = 'wave' | 'happy' | 'rest'
export type PetAction = 'nearby' | 'favorites'

export interface PetLine {
  mood: PetMood
  title: string
  body: string
  // 본문 끝에 붙는 작은 그림 — 별(찜)
  icon?: 'star'
  action?: PetAction
  actionLabel?: string
}

// 문구는 시안에 있는 세 가지 그대로다. 바꾸려면 여기만 고친다
const WELCOME = (nickname: string): PetLine => ({
  mood: 'happy',
  title: `반가워요, ${nickname}님!`,
  body: '마음에 드는 곳에 별을 남겨보세요.',
  icon: 'star',
})
const LONG_TIME = (nickname: string): PetLine => ({
  mood: 'wave',
  title: `오랜만이에요, ${nickname}님!`,
  body: '오늘은 어떤 맛집을 만나볼까요?',
  action: 'nearby',
  actionLabel: '내 주변 둘러보기',
})
// 찜한 곳이 아직 없으면 "찜한 곳 보기"가 빈 화면으로 가므로, 별을 남겨 보라는 말로 바꾼다
const TODAY = (hasFavorites: boolean): PetLine =>
  hasFavorites
    ? { mood: 'rest', title: '오늘은 어디로 가볼까요?', body: '찜한 곳에서 골라봐도 좋아요.', action: 'favorites', actionLabel: '찜한 곳 보기' }
    : { mood: 'rest', title: '오늘은 어디로 가볼까요?', body: '마음에 드는 곳에 별을 남겨보세요.', icon: 'star' }

// 사람별로 마지막으로 들른 날과 인사한 날을 기기에 적어 둔다 (서버에는 안 보낸다)
interface PetMemory {
  lastVisitDay: string
  greetedDay: string
}

const KEY = 'intermap.pet'
// 이만큼 안 들렀으면 "오랜만이에요"
const LONG_ABSENCE_DAYS = 3

function readAll(): Record<string, PetMemory> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}

// 앱을 열었을 때 건넬 인사. 오늘 이미 인사했으면 null (거북이만 조용히 앉아 있는다)
export function pickGreeting(userId: number, nickname: string, hasFavorites: boolean, today = kstDay()): PetLine | null {
  const memory = readAll()[String(userId)]
  // 이 기기에서 처음 만났다 — 가입 직후이거나 새 기기
  if (!memory) return WELCOME(nickname)
  if (daysBetween(memory.lastVisitDay, today) >= LONG_ABSENCE_DAYS) return LONG_TIME(nickname)
  if (memory.greetedDay !== today) return TODAY(hasFavorites)
  return null
}

// 들렀다고 적는다. greeted면 오늘 인사도 한 것으로
export function rememberVisit(userId: number, greeted: boolean, today = kstDay()): void {
  try {
    const all = readAll()
    const before = all[String(userId)]
    all[String(userId)] = { lastVisitDay: today, greetedDay: greeted ? today : (before?.greetedDay ?? '') }
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // 못 적으면 다음에 한 번 더 인사할 뿐이다
  }
}

// 거북이를 눌렀을 때 돌아가며 하는 말 — 인사말과 같은 문구만 쓴다.
// "오랜만이에요"는 정말 오랜만일 때만 맞는 말이라 여기엔 넣지 않는다
export function chatLines(nickname: string, hasFavorites: boolean): PetLine[] {
  return [TODAY(hasFavorites), WELCOME(nickname)]
}
