import type { Friend, FriendGroup } from '../data/mock'
import './StoryStrip.css'

interface StoryFriend extends Friend {
  group: FriendGroup
}

interface StoryStripProps {
  stories: StoryFriend[]
}

export default function StoryStrip({ stories }: StoryStripProps) {
  if (stories.length === 0) return null

  return (
    <div className="story-strip" role="list" aria-label="24시간 내 올라온 친구들 후기">
      {stories.map((friend) => (
        <button type="button" key={friend.id} className="story-chip" role="listitem" style={{ ['--ring-color' as string]: friend.group.color }}>
          <span className="story-chip__ring">
            <span className="story-chip__avatar">{friend.initials.slice(0, 1)}</span>
          </span>
          <span className="story-chip__name">{friend.name}</span>
        </button>
      ))}
    </div>
  )
}
