# InterMap 모바일 앱 빌드·배포 가이드

기존 React 웹앱을 Capacitor로 감싸 iOS/Android 앱으로 패키징한다.
코드 구조는 그대로이고, `frontend/android/`, `frontend/ios/`가 네이티브 프로젝트다.

## 전체 흐름

1. 백엔드를 Fly.io에 배포 (폰에서 접근 가능한 HTTPS 주소 확보)
2. 네이버 클라우드 콘솔에 앱 WebView URL 등록
3. `frontend/.env.local`에 배포된 백엔드 URL 지정 후 앱 빌드
4. Android: APK 빌드 → 폰 설치 → 스토어 출시
5. iOS: Mac 확보 후 `frontend/ios/` 열어서 빌드

---

## 1. 백엔드 배포 (Fly.io)

필요한 것: Fly.io 계정(무료), `flyctl` CLI 설치 (https://fly.io/docs/flyctl/install/)

```bash
cd backend
fly auth login
fly launch --no-deploy        # fly.toml 이미 있으므로 기존 설정 사용 선택
fly volumes create intermap_data --region nrt --size 1
fly secrets set NAVER_SEARCH_CLIENT_ID=xxx NAVER_SEARCH_CLIENT_SECRET=xxx LOCALDATA_AUTH_KEY=xxx
fly deploy
```

- 배포 후 주소: `https://intermap-backend.fly.dev` (앱 이름에 따라 다름)
- H2 파일 DB는 `/data` 볼륨에 저장되어 재배포해도 유지된다.
- **인스턴스는 반드시 1대만** 유지할 것 (H2 파일 잠금 충돌). `fly.toml`에 반영돼 있음.
- 확인: `https://<앱주소>/api/restaurants` 접속 시 JSON 응답.

## 2. 네이버 클라우드 콘솔 등록

NCP 콘솔 > Maps > Application > 서비스 환경 등록(Web 서비스 URL)에 아래 추가:

- `https://localhost` — Android/iOS 앱 WebView origin
- (기존 개발용 `http://localhost:5173` 유지)

미등록 시 앱 안에서 지도가 인증 오류로 안 뜬다.

## 3. 앱 빌드 (Android)

`frontend/.env.local`:

```
VITE_NAVER_MAP_CLIENT_ID=<기존 값>
VITE_API_BASE_URL=https://intermap-backend.fly.dev
```

빌드:

```bash
cd frontend
npm run build          # dist 생성 (.env.local 값이 이 시점에 박힌다)
npx cap sync           # dist를 android/ios 프로젝트로 복사
cd android
gradlew assembleDebug  # APK: android/app/build/outputs/apk/debug/app-debug.apk
```

폰 설치: USB 연결 후 `gradlew installDebug` 또는 APK 파일 직접 전송.

주의: 웹 코드를 수정하면 항상 `npm run build && npx cap sync` 후 다시 APK 빌드.

### 스토어 출시용 (release)

1. 서명 키 생성: `keytool -genkey -v -keystore intermap.keystore -alias intermap -keyalg RSA -keysize 2048 -validity 10000`
2. `android/app/build.gradle`에 signingConfig 추가 (Capacitor 문서: https://capacitorjs.com/docs/android/deploying-to-google-play)
3. `gradlew bundleRelease` → `app-release.aab`를 Play Console에 업로드

## 4. iOS (Mac 확보 후)

`frontend/ios/`가 이미 생성돼 있다. Mac에서:

```bash
cd frontend
npm run build && npx cap sync
npx cap open ios       # Xcode 열림 → 서명 설정 후 빌드
```

Apple Developer 계정($99/년) 필요. 네이버 콘솔 URL 등록은 2번과 동일하게 적용됨.

## 로컬 개발 시 폰 테스트 (배포 전)

배포 없이 폰에서 테스트하려면 WebView가 https라 http 백엔드 호출이 차단(mixed content)된다.
가장 간단한 방법은 백엔드를 먼저 배포하고 그 URL로 빌드하는 것.
그래도 로컬 백엔드로 테스트하려면 `capacitor.config.ts`에 개발용 서버 설정을 임시로 추가:

```ts
server: { url: 'http://<PC IP>:5173', cleartext: true }  // 커밋 금지, 테스트 후 제거
```

이후 `npx cap sync android` 하고 PC에서 `npm run dev -- --host` 실행.
