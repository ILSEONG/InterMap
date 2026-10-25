import type { Story } from '../data/model'
import Avatar from './Avatar'
import './StoryStrip.css'

interface StoryStripProps {
  stories: Story[]
  onOpen: (story: Story) => void
}

// 최근 24시간 안에 후기를 남긴 사람들. 누르면 그 사람 후기를 StoryViewer로 본다
export default function StoryStrip({ stories, onOpen }: StoryStripProps) {
  if (stories.length === 0) return null

  return (
    <nav className="story-strip glass" aria-label="24시간 내 올라온 이웃 후기">
      <ul className="story-strip__list">
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
      </ul>
    </nav>
  )
}
