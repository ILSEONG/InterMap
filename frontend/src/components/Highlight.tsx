// 검색어와 겹치는 부분만 포인트 색으로 칠한다 (대소문자 무시, 첫 일치 하나)
export default function Highlight({ text, query }: { text: string; query?: string }) {
  const q = query?.trim()
  if (!q) return <>{text}</>
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="highlight">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}
