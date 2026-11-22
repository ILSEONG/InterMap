import { Fragment } from 'react'
import { highlightSpans } from '../lib/search'

// 검색어와 겹치는 부분만 포인트 색으로 칠한다 (대소문자 무시).
// 검색어가 통째로 있으면 그곳 하나, 여러 낱말이면 낱말마다 처음 나오는 곳.
export default function Highlight({ text, query }: { text: string; query?: string }) {
  const spans = query ? highlightSpans(text, query) : []
  if (spans.length === 0) return <>{text}</>
  let from = 0
  return (
    <>
      {spans.map(([start, end]) => {
        const before = text.slice(from, start)
        from = end
        return (
          <Fragment key={start}>
            {before}
            <mark className="highlight">{text.slice(start, end)}</mark>
          </Fragment>
        )
      })}
      {text.slice(from)}
    </>
  )
}
