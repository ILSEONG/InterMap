import type { Story } from '../data/model'
import Avatar from './Avatar'
import './StoryStrip.css'

interface StoryStripProps {
  stories: Story[]
  onOpen: (story: Story) => void
  // 달이 바뀐 첫 주에 맨 앞에 붙는 "10월 결산" 동그라미. 한 번 열면 App이 내린다
  recap?: { label: string; onOpen: () => void } | null
  // 친구가 적을 때 끝에 붙는 "+ 친구 찾기" — 누르면 사람 검색
  onFindFriends?: () => void
}

// 최근 24시간 안에 후기를 남긴 사람들. 누르면 그 사람 후기를 StoryViewer로 본다
export default function StoryStrip({ stories, onOpen, recap, onFindFriends }: StoryStripProps) {
  if (stories.length === 0 && !recap && !onFindFriends) return null

  return (
    <nav className="story-strip" aria-label="24시간 내 올라온 이웃 후기">
      <ul className="story-strip__list">
        {recap && (
          <li>
            <button type="button" className="story-chip story-chip--recap" onClick={recap.onOpen}>
              <span className="story-chip__ring">
                <span className="story-chip__avatar story-chip__recap" aria-hidden="true">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 20V11M10 20V5M15 20v-6M20 20V8" />
                  </svg>
                </span>
              </span>
              <span className="story-chip__name">{recap.label}</span>
            </button>
          </li>
        )}
        {stories.map((story) => (
          <li key={story.id}>
            <button type="button" className="story-chip" onClick={() => onOpen(story)}>
              <span className="story-chip__ring">
                <Avatar
                  className={`story-chip__avatar tone-${Math.abs(story.id) % 4}`}
                  src={story.avatar}
                  name={story.name}
                />
              </span>
              <span className="story-chip__name">{story.name}</span>
            </button>
          </li>
        ))}
        {onFindFriends && (
          <li>
            <button type="button" className="story-chip story-chip--find" onClick={onFindFriends}>
              <span className="story-chip__ring">
                <span className="story-chip__avatar story-chip__find" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M12 6v12M6 12h12" />
                  </svg>
                </span>
              </span>
              <span className="story-chip__name">친구 찾기</span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  )
}
