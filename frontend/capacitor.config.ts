import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // 안드로이드 패키지 이름. iOS 번들 ID는 com.ilseong.intermap 으로 다르다 (com.intermap.app은 Apple에서 이미 남이 쓰고 있었다)
  // — iOS 쪽은 Xcode 프로젝트(ios/App/App.xcodeproj)에 따로 적혀 있고 cap sync가 건드리지 않는다
  appId: 'com.intermap.app',
  appName: '인터맵',
  webDir: 'dist',
  server: {
    // 네이버 지도 인증(NCP 콘솔)이 포트 없는 URL 등록을 버리기 때문에
    // 비표준 포트를 붙여 location.href에 포트가 그대로 남게 한다.
    // NCP 콘솔 Web 서비스 URL에 https://intermap.app:8443 등록 필요.
    hostname: 'intermap.app:8443',
    // iOS 웹뷰는 앱 안 파일을 https://로 내줄 수 없어 따로 스킴을 쓴다 (기본값 capacitor://).
    // 네이버 지도 SDK는 location.protocol이 "https"로 시작하지 않으면 지도 서버를 http://로 부르는데,
    // iOS는 평문 http를 막아서(ATS) 지도가 뜨지 않는다. 그래서 "https"로 시작하는 스킴 이름을 쓴다.
    // 네이버 인증은 스킴은 안 보고 호스트:포트(intermap.app:8443)만 본다. 화면 주소는 httpsapp://intermap.app:8443
    // — 서버 @CrossOrigin 목록에도 이 주소가 들어 있어야 한다.
    iosScheme: 'httpsapp',
  },
}

export default config
