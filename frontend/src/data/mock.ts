export type GroupId = 'close' | 'work' | 'college' | 'none'

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

// 실제 hex 값은 App의 groupColors state가 --gc-* CSS 변수로 내려준다.
// 여기서 var()로 참조해두면 색을 바꿔도 마커·시트·칩이 전부 한 번에 따라온다.
export const groups: FriendGroup[] = [
  { id: 'close', label: '친한친구', color: 'var(--gc-close)', priority: 0 },
  { id: 'work', label: '회사사람', color: 'var(--gc-work)', priority: 1 },
  { id: 'college', label: '대학동기', color: 'var(--gc-college)', priority: 2 },
  { id: 'none', label: '그룹없음', color: 'var(--gc-none)', priority: 3 },
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
  // ── 민지(f1)가 다녀온 실제 가게들. 위 r1·r5와 합쳐 후기 20개 ──
  {
    id: 'r6',
    name: '우래옥',
    category: '한식 · 평양냉면',
    address: '서울 중구 창경궁로 62-29',
    lat: 37.5686,
    lng: 126.9981,
    groupIds: ['close'],
    reviews: [{ id: 'rv8', friendId: 'f1', rating: 5, text: '불고기 먹고 냉면으로 마무리. 육수가 다르다.', postedHoursAgo: 5 }],
    comments: [],
  },
  {
    id: 'r7',
    name: '필동면옥',
    category: '한식 · 평양냉면',
    address: '서울 중구 서애로 26',
    lat: 37.5602,
    lng: 126.9954,
    groupIds: ['close'],
    reviews: [{ id: 'rv9', friendId: 'f1', rating: 4, text: '슴슴한데 계속 들어감. 제육 꼭 시켜.', postedHoursAgo: 72 }],
    comments: [],
  },
  {
    id: 'r8',
    name: '하동관',
    category: '한식 · 곰탕',
    address: '서울 중구 명동9길 12',
    lat: 37.5637,
    lng: 126.9847,
    groupIds: ['close'],
    reviews: [{ id: 'rv10', friendId: 'f1', rating: 5, text: '점심 4시 전 마감이라 서둘러야 함. 특 시키면 내포 듬뿍.', postedHoursAgo: 30 }],
    comments: [],
  },
  {
    id: 'r9',
    name: '순희네빈대떡',
    category: '한식 · 빈대떡',
    address: '서울 종로구 창경궁로 88',
    lat: 37.5701,
    lng: 126.9996,
    groupIds: ['close'],
    reviews: [{ id: 'rv11', friendId: 'f1', rating: 4, text: '광장시장 오면 여기부터. 막걸리랑 찰떡.', postedHoursAgo: 120 }],
    comments: [],
  },
  {
    id: 'r10',
    name: '진옥화할매원조닭한마리',
    category: '한식 · 닭한마리',
    address: '서울 종로구 종로40가길 18',
    lat: 37.5706,
    lng: 127.0075,
    groupIds: ['close'],
    reviews: [{ id: 'rv12', friendId: 'f1', rating: 4, text: '칼국수 사리 필수. 웨이팅 30분 각오.', postedHoursAgo: 200 }],
    comments: [],
  },
  {
    id: 'r11',
    name: '부자피자',
    category: '양식 · 피자',
    address: '서울 용산구 이태원로27가길 38',
    lat: 37.5347,
    lng: 126.9945,
    groupIds: ['close'],
    reviews: [{ id: 'rv13', friendId: 'f1', rating: 3, text: '한 조각은 진짜 큼. 맛은 평범, 분위기로 먹는 곳.', postedHoursAgo: 340 }],
    comments: [],
  },
  {
    id: 'r12',
    name: '소문난성수감자탕',
    category: '한식 · 감자탕',
    address: '서울 성동구 연무장길 45',
    lat: 37.5437,
    lng: 127.0555,
    groupIds: ['close'],
    reviews: [{ id: 'rv14', friendId: 'f1', rating: 5, text: '해장 1순위. 뼈에 살 많고 국물 진함.', postedHoursAgo: 12 }],
    comments: [],
  },
  {
    id: 'r13',
    name: '새벽집',
    category: '한식 · 육회',
    address: '서울 강남구 도산대로101길 6',
    lat: 37.5254,
    lng: 127.0433,
    groupIds: ['close'],
    reviews: [{ id: 'rv15', friendId: 'f1', rating: 4, text: '육회비빔밥 새벽에 먹으면 두 배로 맛있음.', postedHoursAgo: 90 }],
    comments: [],
  },
  {
    id: 'r14',
    name: '진주집',
    category: '한식 · 콩국수',
    address: '서울 영등포구 국제금융로6길 33',
    lat: 37.5219,
    lng: 126.9282,
    groupIds: ['close'],
    reviews: [{ id: 'rv16', friendId: 'f1', rating: 5, text: '콩국수 국물 걸쭉함이 미쳤음. 여름 필수.', postedHoursAgo: 48 }],
    comments: [],
  },
  {
    id: 'r15',
    name: '토속촌삼계탕',
    category: '한식 · 삼계탕',
    address: '서울 종로구 자하문로5길 5',
    lat: 37.5771,
    lng: 126.9718,
    groupIds: ['close'],
    reviews: [{ id: 'rv17', friendId: 'f1', rating: 4, text: '들깨 국물 고소. 관광객 많아서 점심은 피하기.', postedHoursAgo: 260 }],
    comments: [],
  },
  {
    id: 'r16',
    name: '성심당 본점',
    category: '베이커리 · 빵',
    address: '대전 중구 대종로480번길 15',
    lat: 36.3276,
    lng: 127.4273,
    groupIds: ['close'],
    reviews: [{ id: 'rv18', friendId: 'f1', rating: 5, text: '튀김소보로 갓 나온 거 먹으면 대전 올 이유 충분.', postedHoursAgo: 400 }],
    comments: [],
  },
  {
    id: 'r17',
    name: '한국집',
    category: '한식 · 비빔밥',
    address: '전북 전주시 완산구 어진길 119',
    lat: 35.8149,
    lng: 127.15,
    groupIds: ['close'],
    reviews: [{ id: 'rv19', friendId: 'f1', rating: 4, text: '육회비빔밥 정갈함. 가격은 좀 있음.', postedHoursAgo: 520 }],
    comments: [],
  },
  {
    id: 'r18',
    name: '해운대원조할매국밥',
    category: '한식 · 돼지국밥',
    address: '부산 해운대구 구남로21번길 27',
    lat: 35.1627,
    lng: 129.159,
    groupIds: ['close'],
    reviews: [{ id: 'rv20', friendId: 'f1', rating: 4, text: '잡내 없고 깔끔. 부산 오면 아침으로 딱.', postedHoursAgo: 610 }],
    comments: [],
  },
  {
    id: 'r19',
    name: '테라로사 커피공장',
    category: '카페 · 커피',
    address: '강원 강릉시 구정면 현천길 7',
    lat: 37.7168,
    lng: 128.8634,
    groupIds: ['close'],
    reviews: [{ id: 'rv21', friendId: 'f1', rating: 4, text: '공간이 넓어서 오래 있기 좋음. 빵도 괜찮.', postedHoursAgo: 700 }],
    comments: [],
  },
  {
    id: 'r20',
    name: '봉포머구리집',
    category: '한식 · 물회',
    address: '강원 속초시 영랑해안길 223',
    lat: 38.2264,
    lng: 128.5878,
    groupIds: ['close'],
    reviews: [{ id: 'rv22', friendId: 'f1', rating: 5, text: '모둠물회 양 어마어마. 바다 보면서 먹는 맛.', postedHoursAgo: 720 }],
    comments: [],
  },
  {
    id: 'r21',
    name: '올래국수',
    category: '한식 · 고기국수',
    address: '제주 제주시 귀아랑길 24',
    lat: 33.4977,
    lng: 126.5289,
    groupIds: ['close'],
    reviews: [{ id: 'rv23', friendId: 'f1', rating: 4, text: '고기 두툼, 국물 진해서 든든. 줄 길어도 회전 빠름.', postedHoursAgo: 900 }],
    comments: [],
  },
  {
    id: 'r22',
    name: '진미통닭',
    category: '한식 · 통닭',
    address: '경기 수원시 팔달구 정조로800번길 16',
    lat: 37.2814,
    lng: 127.017,
    groupIds: ['close'],
    reviews: [{ id: 'rv24', friendId: 'f1', rating: 3, text: '옛날 통닭 그 맛. 닭똥집 서비스가 포인트.', postedHoursAgo: 1000 }],
    comments: [],
  },
  {
    id: 'r23',
    name: '공화춘',
    category: '중식 · 짜장면',
    address: '인천 중구 차이나타운로 43',
    lat: 37.4741,
    lng: 126.6177,
    groupIds: ['close'],
    reviews: [{ id: 'rv25', friendId: 'f1', rating: 3, text: '짜장면 원조라는데 맛은 무난. 관광 코스로 한 번.', postedHoursAgo: 1100 }],
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
