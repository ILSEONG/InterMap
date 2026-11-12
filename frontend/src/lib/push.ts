import { Capacitor } from '@capacitor/core'
import { registerPushToken, unregisterPushToken } from './api'

// 푸시 알림 (안드로이드 앱 전용, Firebase Cloud Messaging).
// google-services.json을 넣어 빌드한 앱에서만 켠다 — 그 파일 없이 등록을 부르면 앱이 죽는다 (Firebase가 초기화되지 않음).
// 빌드할 때 VITE_PUSH_ENABLED=true 로 알려 준다 (.github/workflows/android-*.yml)
const ENABLED = import.meta.env.VITE_PUSH_ENABLED === 'true'
const TOKEN_KEY = 'intermap.pushToken'
// 서버 PushService.CHANNEL, AndroidManifest의 default_notification_channel_id와 같은 이름
const CHANNEL = 'intermap'

export const pushAvailable = () => ENABLED && Capacitor.getPlatform() === 'android'

interface PushHandlers {
  // 알림을 눌러 앱에 들어왔다
  onOpen: () => void
  // 앱을 보고 있는 중에 알림이 왔다 (이때는 알림 막대에 뜨지 않는다 — 앱 안 종 버튼 숫자를 새로 받는다)
  onReceive: () => void
}

// 로그인한 채 앱이 켜질 때마다 부른다: 권한을 묻고(처음 한 번) 기기 토큰을 서버에 등록한다.
// 돌려주는 함수는 리스너를 걷는다.
export async function startPush(handlers: PushHandlers): Promise<() => void> {
  if (!pushAvailable()) return () => {}
  const { PushNotifications } = await import('@capacitor/push-notifications')
  const listeners = await Promise.all([
    PushNotifications.addListener('registration', ({ value }) => {
      try {
        localStorage.setItem(TOKEN_KEY, value)
      } catch {
        // 저장 못 해도 등록은 한다 (로그아웃 때 해제를 못 할 뿐 — 다음 로그인이 토큰을 옮겨 간다)
      }
      void registerPushToken(value).catch(() => {})
    }),
    PushNotifications.addListener('registrationError', (e) => console.warn('푸시 등록 실패', e)),
    PushNotifications.addListener('pushNotificationReceived', () => handlers.onReceive()),
    PushNotifications.addListener('pushNotificationActionPerformed', () => handlers.onOpen()),
  ])
  const stop = () => listeners.forEach((l) => void l.remove())
  try {
    await PushNotifications.createChannel({
      id: CHANNEL,
      name: '알림',
      description: '댓글, 답글, 팔로우 알림',
      importance: 4,
      visibility: 1,
    })
    let permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions()
    }
    if (permission.receive === 'granted') await PushNotifications.register()
  } catch (e) {
    console.warn('푸시 설정 실패', e)
  }
  return stop
}

// 로그아웃 — 이 기기로 더는 알림이 오지 않게 서버에서 토큰을 뗀다. 세션을 지우기 전에 부른다
export function stopPush() {
  if (!pushAvailable()) return
  let token: string | null = null
  try {
    token = localStorage.getItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // 무시
  }
  if (token) void unregisterPushToken(token).catch(() => {})
}
