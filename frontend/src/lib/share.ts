import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { Directory, Filesystem } from '@capacitor/filesystem'

// 공유 결과 — 공유 시트로 보냄 / 링크를 복사함 / 파일로 저장함 / 사용자가 닫음
export type ShareResult = 'shared' | 'copied' | 'saved' | 'cancelled'

// 공유 시트를 닫으면 플러그인·브라우저 모두 오류로 끝난다 — 실패가 아니라 취소로 본다
function isCancel(e: unknown): boolean {
  const message = String((e as Error)?.message ?? e).toLowerCase()
  return (e as Error)?.name === 'AbortError' || message.includes('cancel')
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 권한 없는 WebView·오래된 브라우저 — 숨긴 입력칸으로 복사
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

// 링크 공유 (카톡 등). 앱은 안드로이드 공유 시트, 웹은 Web Share → 안 되면 클립보드 복사
export async function shareLink(title: string, text: string, url: string): Promise<ShareResult> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title, text, url, dialogTitle: title })
      return 'shared'
    }
    if (navigator.share) {
      await navigator.share({ title, text, url })
      return 'shared'
    }
  } catch (e) {
    if (isCancel(e)) return 'cancelled'
    // 공유가 막힌 환경이면 복사로 넘어간다
  }
  return (await copyText(`${text}\n${url}`)) ? 'copied' : 'cancelled'
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// 이미지 공유 (인스타 스토리 등) — 여러 장을 한 번에. 앱은 캐시 폴더에 쓴 뒤 공유 시트,
// 웹은 파일 공유가 되면 공유 시트, 아니면 한 장씩 내려받기
export async function shareImages(images: { blob: Blob; name: string }[], title: string): Promise<ShareResult> {
  try {
    if (Capacitor.isNativePlatform()) {
      const uris: string[] = []
      for (const img of images) {
        const { uri } = await Filesystem.writeFile({ path: img.name, data: await blobToBase64(img.blob), directory: Directory.Cache })
        uris.push(uri)
      }
      await Share.share({ title, files: uris, dialogTitle: title })
      return 'shared'
    }
    const files = images.map((img) => new File([img.blob], img.name, { type: img.blob.type }))
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files, title })
      return 'shared'
    }
  } catch (e) {
    if (isCancel(e)) return 'cancelled'
    throw e
  }
  for (const img of images) {
    const url = URL.createObjectURL(img.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = img.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return 'saved'
}
