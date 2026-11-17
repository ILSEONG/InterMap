import { useState } from 'react'
import turtle from '../assets/turtle-avatar.png'
import { avatarUrl } from '../lib/api'

interface AvatarProps {
  // 서버가 준 프로필 사진 경로. 없으면 거북이 (인터맵 기본 프로필)
  src?: string | null
  name: string
  className: string
}

// 동그란 프로필. 사진이 있으면 사진, 없으면 거북이. 크기·테두리는 className 쪽 CSS가 정한다.
// 거북이 뒤 바탕색은 className의 tone-N이 정해서, 사진 없는 사람끼리도 색으로 구분된다.
// name은 예전에 첫 글자를 보여 주던 값 — 지금은 쓰는 쪽이 누구 것인지 알아보기 좋게만 받는다
export default function Avatar({ src, className }: AvatarProps) {
  // 사진을 못 받으면(삭제됨·주소가 바뀜·서버 오류) 깨진 그림 대신 거북이. 주소가 바뀌면 다시 시도한다
  const [failed, setFailed] = useState<string | null>(null)
  const photo = src && failed !== src ? src : null
  return (
    <span className={className} aria-hidden="true">
      <img
        className={photo ? 'avatar-img' : 'avatar-img avatar-img--turtle'}
        src={photo ? avatarUrl(photo) : turtle}
        alt=""
        onError={photo ? () => setFailed(photo) : undefined}
      />
    </span>
  )
}
