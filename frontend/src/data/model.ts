// 앱 전역 도메인 타입. 가게는 서버 /api/restaurants, 후기는 /api/reviews에서 온다.
export type GroupId = 'close' | 'work' | 'college' | 'none'

export interface FriendGroup {
  id: GroupId
  label: string
  color: string
  priority: number // lower = higher sort priority when dots overlap
}

// 친구 기능이 붙기 전까지는 데이터 없이 타입만 쓴다 (약속잡기 초대 목록 등)
export interface Friend {
  id: string
  name: string
  groupId: GroupId
  initials: string
}

export interface ReviewAuthor {
  id: number
  name: string
  // 주인장(admin) 계정이 쓴 후기 — 이웃 후기와 따로 "주인장의 후기"로 보인다
  owner: boolean
  // 프로필 사진 API 경로. 없으면 null (api.avatarUrl로 실제 URL)
  avatar?: string | null
}

export interface Review {
  id: number
  // 가게 스냅샷. name|address 가 가게 키 (api.restaurantKey)
  // lat/lng는 서버가 가게 행을 찾았을 때만 채워준다 — 뷰포트에 안 실린 가게도 핀으로 찍기 위해
  restaurant: { name: string; category: string; address: string; lat?: number | null; lng?: number | null }
  author: ReviewAuthor
  rating: number
  text: string
  createdAt: string // ISO
  photoIds: number[] // api.photoUrl(id)로 이미지 URL
}

// 스토리 = 최근 24시간 안에 후기를 남긴 사람 한 명과 그 후기들
export interface Story {
  id: number
  name: string
  avatar?: string | null
  reviews: Review[]
}

// 후기에 달리는 댓글. 서버 /api/comments에서 온다 (api.ts CommentRecord를 App이 이 모양으로 줄인다)
export interface Comment {
  id: number
  authorName: string
  text: string
  parentId?: number | null // 있으면 해당 댓글의 대댓글
}

export interface Restaurant {
  id: string
  name: string
  category: string
  address: string
  lat: number
  lng: number
  groupIds: GroupId[]
  reviews: Review[] // 이웃 후기만 (주인장 후기 제외)
  closed?: boolean
}

// 실제 hex 값은 App의 groupColors state가 --gc-* CSS 변수로 내려준다.
// 여기서 var()로 참조해두면 색을 바꿔도 마커·시트·칩이 전부 한 번에 따라온다.
export const groups: FriendGroup[] = [
  { id: 'close', label: '친한친구', color: 'var(--gc-close)', priority: 0 },
  { id: 'work', label: '회사사람', color: 'var(--gc-work)', priority: 1 },
  { id: 'college', label: '대학동기', color: 'var(--gc-college)', priority: 2 },
  { id: 'none', label: '그룹없음', color: 'var(--gc-none)', priority: 3 },
]

export function groupById(id: GroupId): FriendGroup {
  return groups.find((g) => g.id === id)!
}
