import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.intermap.app',
  appName: '인터맵',
  webDir: 'dist',
  server: {
    // 네이버 지도 인증(NCP 콘솔)이 포트 없는 URL 등록을 버리기 때문에
    // 비표준 포트를 붙여 location.href에 포트가 그대로 남게 한다.
    // NCP 콘솔 Web 서비스 URL에 https://intermap.app:8443 등록 필요.
    hostname: 'intermap.app:8443',
  },
}

export default config
