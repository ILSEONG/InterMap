import { decode } from 'blurhash'

// 서버가 사진마다 만들어 둔 흐린 미리보기 코드(BlurHash)를 작은 그림 주소(data URL)로 푼다.
// 32×32로만 풀어 CSS로 늘린다 — 어차피 흐린 그림이라 작아도 똑같고, 같은 코드는 한 번만 푼다.
const SIZE = 32
const cache = new Map<string, string>()

export function blurUrl(hash: string | null | undefined): string | undefined {
  if (!hash) return undefined
  const known = cache.get(hash)
  if (known) return known
  try {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    const image = ctx.createImageData(SIZE, SIZE)
    image.data.set(decode(hash, SIZE, SIZE))
    ctx.putImageData(image, 0, 0)
    const url = canvas.toDataURL()
    cache.set(hash, url)
    return url
  } catch {
    // 코드가 망가졌으면 미리보기 없이 (회색 칸)
    return undefined
  }
}
