import { avatarUrl } from '../lib/api'

interface AvatarProps {
  // 서버가 준 프로필 사진 경로. 없으면 이름 첫 글자
  src?: string | null
  name: string
  className: string
}

// 동그란 프로필. 사진이 있으면 사진, 없으면 이름 첫 글자. 크기·테두리는 className 쪽 CSS가 정한다.
export default function Avatar({ src, name, className }: AvatarProps) {
  return (
    <span className={className} aria-hidden="true">
      {src ? <img className="avatar-img" src={avatarUrl(src)} alt="" /> : name.slice(0, 1)}
    </span>
  )
}
