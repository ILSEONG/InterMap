import type { Story } from '../data/model'
import './StoryStrip.css'

interface StoryStripProps {
  stories: Story[]
  onOpen: (story: Story) => void
}

// 최근 24시간 안에 후기를 남긴 사람들. 누르면 그 사람 후기를 StoryViewer로 본다
export default function StoryStrip({ stories, onOpen }: StoryStripProps) {
  if (stories.length === 0) return null

  return (
    <div className="story-strip" role="list" aria-label="24시간 내 올라온 이웃 후기">
      {stories.map((story) => (
        <button type="button" key={story.id} className="story-chip" role="listitem" onClick={() => onOpen(story)}>
          <span className="story-chip__ring">
            <span className="story-chip__avatar">{story.name.slice(0, 1)}</span>
          </span>
          <span className="story-chip__name">{story.name}</span>
        </button>
      ))}
    </div>
  )
}
