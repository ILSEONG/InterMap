export type GroupId = 'close' | 'work' | 'college'

export interface FriendGroup {
  id: GroupId
  label: string
  color: string
  priority: number // lower = higher sort priority when dots overlap
}

export interface Friend {
  id: string
  name: string
  groupId: GroupId
  initials: string
}

export interface Review {
  id: string
  friendId: string
  rating: number
  text: string
  postedHoursAgo: number
}

export interface Comment {
  id: string
  friendId: string
  text: string
  parentId?: string // 있으면 해당 댓글의 대댓글
}

export interface Restaurant {
  id: string
  name: string
  category: string
  address: string
  lat: number
  lng: number
  groupIds: GroupId[]
  reviews: Review[]
  comments: Comment[]
  closed?: boolean
}

export const groups: FriendGroup[] = [
  { id: 'close', label: '친한친구', color: '#FF5D73', priority: 0 },
  { id: 'work', label: '회사사람', color: '#2FBFA6', priority: 1 },
  { id: 'college', label: '대학동기', color: '#8B6BFF', priority: 2 },
]

export const friends: Friend[] = [
  { id: 'f1', name: '민지', groupId: 'close', initials: '민지' },
  { id: 'f2', name: '서준', groupId: 'close', initials: '서준' },
  { id: 'f3', name: '하윤', groupId: 'work', initials: '하윤' },
  { id: 'f4', name: '도현', groupId: 'work', initials: '도현' },
  { id: 'f5', name: '지우', groupId: 'college', initials: '지우' },
  { id: 'f6', name: '예린', groupId: 'college', initials: '예린' },
]

export const restaurants: Restaurant[] = [
  {
    id: 'r1',
    name: '몽돌식당',
    category: '한식 · 백반',
    address: '서울 마포구 연남동 223-14',
    lat: 37.5625,
    lng: 126.9256,
    groupIds: ['close', 'college'],
    reviews: [
      { id: 'rv1', friendId: 'f1', rating: 5, text: '고등어정식 진짜 밥도둑이야. 반찬도 계속 리필해줌.', postedHoursAgo: 3 },
      { id: 'rv2', friendId: 'f5', rating: 4, text: '점심시간엔 웨이팅 있음 주의. 맛은 인정.', postedHoursAgo: 20 },
    ],
    comments: [{ id: 'c1', friendId: 'f2', text: '나도 담주에 가보려고!' }],
  },
  {
    id: 'r2',
    name: '연남 화덕피자',
    category: '양식 · 피자',
    address: '서울 마포구 연남동 240-1',
    lat: 37.5645,
    lng: 126.9235,
    groupIds: ['work'],
    reviews: [
      { id: 'rv3', friendId: 'f3', rating: 5, text: '도우 존맛. 화요일에 반값 세트 있음.', postedHoursAgo: 6 },
    ],
    comments: [],
  },
  {
    id: 'r3',
    name: '망원 우육면가',
    category: '중식 · 면요리',
    address: '서울 마포구 망원동 407-9',
    lat: 37.5558,
    lng: 126.9020,
    groupIds: ['close', 'work'],
    reviews: [
      { id: 'rv4', friendId: 'f2', rating: 5, text: '국물이 미쳤다 진짜.', postedHoursAgo: 1 },
      { id: 'rv5', friendId: 'f4', rating: 4, text: '양 많아서 가성비 좋음.', postedHoursAgo: 40 },
    ],
    comments: [{ id: 'c2', friendId: 'f1', text: '나 낼 여기 갈래' }],
  },
  {
    id: 'r4',
    name: '합정 티라미수바',
    category: '카페 · 디저트',
    address: '서울 마포구 합정동 357-2',
    lat: 37.5495,
    lng: 126.9145,
    groupIds: ['college'],
    reviews: [
      { id: 'rv6', friendId: 'f6', rating: 5, text: '여기 티라미수 인생 디저트 등극.', postedHoursAgo: 15 },
    ],
    comments: [],
  },
  {
    id: 'r5',
    name: '상수 곱창골목',
    category: '한식 · 곱창',
    address: '서울 마포구 상수동 12-8',
    lat: 37.5470,
    lng: 126.9228,
    groupIds: ['close'],
    reviews: [
      { id: 'rv7', friendId: 'f1', rating: 4, text: '금요일 저녁엔 무조건 예약하고 가야함.', postedHoursAgo: 50 },
    ],
    comments: [],
  },
]

// 내가 남긴 후기·댓글의 작성자. 초대 목록에 섞이지 않도록 friends 배열과 분리해 둔다.
export const me: Friend = { id: 'me', name: '나', groupId: 'close', initials: '나' }

export function friendById(id: string): Friend | undefined {
  return id === me.id ? me : friends.find((f) => f.id === id)
}

export function groupById(id: GroupId): FriendGroup {
  return groups.find((g) => g.id === id)!
}
