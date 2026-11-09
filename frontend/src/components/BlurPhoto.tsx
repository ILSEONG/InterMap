import { useState, type ImgHTMLAttributes } from 'react'
import './BlurPhoto.css'

// 사진이 받아지는 동안 흐린 미리보기(부모 칸의 배경)를 보여 주고, 다 받아지면 사진을 서서히 띄운다.
// 이미 받아 둔 사진(캐시)이면 처음부터 그대로 — 매번 깜빡이며 떠오르지 않게.
export default function BlurPhoto({ className, onLoad, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      {...props}
      ref={(img) => {
        if (img?.complete && img.naturalWidth > 0 && !loaded) setLoaded(true)
      }}
      className={`blur-photo${loaded ? ' blur-photo--loaded' : ''}${className ? ` ${className}` : ''}`}
      onLoad={(e) => {
        setLoaded(true)
        onLoad?.(e)
      }}
    />
  )
}
