import { createContext, useContext } from 'react'
import type { ReportTargetType } from './api'

// 신고할 대상 — 후기 카드·댓글처럼 시트 안 깊은 곳에서 고른다
export interface ReportTarget {
  type: ReportTargetType
  id: number
  authorId: number
  authorName: string
  // 신고 화면 위에 인용해 보여줄 내용 (한 줄로 잘린다)
  excerpt?: string
}

export interface Moderation {
  // 로그인 사용자 id. 없으면(로그아웃) 신고 버튼을 그리지 않는다
  myUserId?: number
  report: (target: ReportTarget) => void
}

// 프로필 열기(OpenProfileContext)처럼 App이 한 번에 내려준다
export const ModerationContext = createContext<Moderation | null>(null)

export function useModeration() {
  return useContext(ModerationContext)
}

// 이 글에 신고 버튼을 보여줄지 — 로그인했고 남의 글일 때만
export function canReport(m: Moderation | null, authorId: number): m is Moderation {
  return !!m && m.myUserId !== undefined && m.myUserId !== authorId
}
