# InterMap 모바일 앱 전환 설계 (Capacitor)

날짜: 2026-08-26

## 목표

기존 React(Vite) 웹앱을 코드 재작성 없이 iOS/Android 앱으로 패키징하고,
스토어 출시가 가능하도록 백엔드를 외부에서 접근 가능한 PaaS에 배포한다.

- Android: 로컬에서 빌드/테스트까지 (Windows + Android SDK 보유)
- iOS: Capacitor 프로젝트 생성까지만 (빌드는 Mac 확보 후)
- 백엔드: Fly.io 등 저가 PaaS 배포 준비 (Dockerfile + fly.toml), 실제 배포는
  사용자 계정 인증이 필요하므로 준비물 + 실행 가이드 제공

## 프론트엔드 변경

- `@capacitor/core` / `@capacitor/cli` / `@capacitor/android` / `@capacitor/ios` 추가
- `capacitor.config.ts` 생성 — appId `com.intermap.app`, webDir `dist`
- `npx cap add android` / `npx cap add ios` 로 네이티브 프로젝트 생성
- API URL은 기존 `VITE_API_BASE_URL` 환경변수 그대로 사용.
  앱 빌드 시 `.env.production`에 배포된 백엔드 URL 지정
- 위치(geolocation) 미사용, safe-area CSS 이미 적용됨 → UI 코드 변경 없음

## 백엔드 변경

- `Dockerfile` 추가 (temurin 17, gradle bootJar 2-stage 빌드)
- H2 파일 경로를 `JDBC_URL` 환경변수로 오버라이드 가능하게 변경
  (PaaS 볼륨 `/data`에 저장, 재배포에도 데이터 유지)
- CORS: 기존 3개 컨트롤러 `@CrossOrigin`에 앱 WebView origin
  (`https://localhost`, `capacitor://localhost`) 추가
- `fly.toml` 작성 — 볼륨 마운트, 환경변수(secrets)로 네이버 API 키 주입

## 수동 작업 (가이드 문서 제공)

- 네이버 클라우드 콘솔에 Web 서비스 URL 등록 (`https://localhost` 등)
- Fly.io 계정 생성 + `fly launch`/`fly deploy` + secrets 등록
- 스토어 출시용 서명 키 생성 (출시 시점)

## 스킵 (요청 시 추가)

푸시 알림, 딥링크, 앱 아이콘/스플래시 커스텀, React Native 재작성
