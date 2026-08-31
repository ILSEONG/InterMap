// 업로드 전에 사진을 긴 변 max px JPEG로 줄인다. 폰 원본(3~8MB)을 그대로 올리지 않기 위해.
// 브라우저가 EXIF 회전을 적용해 그려주므로 서버에서 회전을 따로 처리하지 않는다.
export async function shrinkImage(file: Blob, max = 1280, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('사진 변환 실패'))), 'image/jpeg', quality),
  )
}
