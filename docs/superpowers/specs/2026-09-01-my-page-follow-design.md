# 마이페이지 · 팔로우 · 나만의 이름 — 설계

## 목표

로그인한 사용자가 마이페이지에서 (1) 닉네임을 바꾸고 (2) 내가 팔로우한 사람과 나를 팔로우한 사람을 보고 (3) 그 사람들에게 나만 보이는 이름(별칭)을 붙일 수 있다.

## 결정 사항

- 팔로우는 **단방향**(인스타그램 방식). PRODUCT.md의 "서로 이웃" 상호 승인 모델은 이번 범위 밖 — 사용자가 팔로우/팔로워라는 용어로 요청했다.
- 별칭은 **나에게만** 보인다. 팔로잉·팔로워 목록뿐 아니라 후기 카드·스토리·사람 검색에서도 그 사람 이름 자리에 별칭이 나온다 (사람 검색은 별칭으로도 걸린다).
- 별칭은 팔로잉 또는 팔로워인 사람에게만 붙인다. 관계가 끊기면 목록에서 사라지므로 별칭도 안 보인다 (DB 행은 남는다).
- 팔로우할 사람은 마이페이지 안의 닉네임 검색으로 찾는다. 후기 카드에서 바로 팔로우하는 버튼은 넣지 않는다 (필요해지면 추가).
- 별칭 입력은 `window.prompt` — Capacitor WebView가 네이티브 다이얼로그로 띄운다. 인라인 편집 상태 없음.

## 백엔드 (`backend/.../social/`)

- `Follow(follower, followee, createdAt)` — (follower_id, followee_id) unique. 새 테이블이라 제약 안전.
- `UserAlias(owner, target, alias)` — (owner_id, target_id) unique. alias 1~20자.
- `SocialController` (모두 로그인 필요, 401 시 `{message}`)
  - `GET /api/me/social` → `{ following: Person[], followers: Person[] }`
    - `Person = { id, nickname, alias | null, following, followsMe }`
  - `POST /api/me/follows/{userId}` / `DELETE /api/me/follows/{userId}` → 갱신된 social. 자기 자신 400, 없는 사용자 404. 이미 팔로우면 그대로 200.
  - `PUT /api/me/aliases/{userId}` `{ alias }` → 갱신된 social. 빈 문자열이면 별칭 삭제. 팔로잉/팔로워가 아니면 400.
  - `GET /api/users?q=` → `[{ id, nickname }]` 닉네임 부분 일치 상위 20, 본인 제외. 로그인 필요 (사용자 목록 열람 방지).
- `AuthController`: `PUT /api/auth/nickname` `{ nickname }` → `AuthResponse`. 기존 `checkNicknameRule` 재사용 (1~20자, 중복 불가). 같은 닉네임이면 그대로 200.

## 프론트엔드

- `lib/api.ts`: `Person`, `SocialData`, `fetchSocial`, `followUser`, `unfollowUser`, `setAlias`, `searchUsers`, `changeNickname`.
- `components/MyPage.tsx` (+ `.css`): 전체 화면 시트. 섹션 순서 — 닉네임(입력+저장) / 팔로우 추가(닉네임 검색 → 팔로우 버튼) / 팔로잉 / 팔로워. 각 행: 표시 이름(별칭 우선, 별칭 있으면 원래 닉네임 작게), `이름 바꾸기`, 팔로잉 행은 `언팔로우`, 팔로워 행은 아직 안 팔로우했으면 `맞팔로우`.
- `Header`: 계정 메뉴에 `마이페이지` 항목.
- `App.tsx`: `social` 상태를 로그인 시 받아 두고 `aliases: Map<userId, alias>` 파생. 서버에서 받은 후기(`rawReviews`)에 별칭을 씌운 `reviews`를 memo로 만들어 기존 소비자(가게 시트·스토리·사람 검색)는 그대로 둔다. 닉네임 변경 시 세션(localStorage 포함) 갱신.

## 오류 처리

- 서버 오류 메시지는 기존 `post()` 규약대로 `Error.message`로 올라오고 마이페이지가 그 자리에 문구로 보여준다.
- 소셜 데이터 로드 실패 시 별칭 없이 동작 (후기·지도는 영향 없음).

## 검증

- 백엔드: 로컬 H2로 curl — 팔로우/언팔로우/별칭/닉네임 변경/사용자 검색, 자기 팔로우 400, 비로그인 401.
- 프론트: `tsc`, `oxlint`.
