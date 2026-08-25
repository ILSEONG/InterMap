import { useState } from 'react'
import type { Restaurant, Friend, FriendGroup } from '../data/mock'
import { groupById } from '../data/mock'
import './MeetupSheet.css'

interface MeetupSheetProps {
  restaurant: Restaurant | null
  friends: Friend[]
  onClose: () => void
}

export default function MeetupSheet({ restaurant, friends, onClose }: MeetupSheetProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const open = restaurant !== null

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleClose() {
    setSelected(new Set())
    setConfirmed(false)
    onClose()
  }

  return (
    <div className={`meetup-overlay${open ? ' meetup-overlay--open' : ''}`} onClick={handleClose}>
      <div className="meetup-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="약속잡기">
        <div className="meetup-sheet__handle" />
        {restaurant && !confirmed && (
          <>
            <h2 className="meetup-sheet__title">🎉 {restaurant.name}에서 약속잡기</h2>
            <p className="meetup-sheet__hint">함께할 친구를 골라주세요</p>
            <ul className="meetup-sheet__friends">
              {friends.map((friend) => {
                const group: FriendGroup = groupById(friend.groupId)
                const active = selected.has(friend.id)
                return (
                  <li key={friend.id}>
                    <button
                      type="button"
                      className={`meetup-friend${active ? ' meetup-friend--active' : ''}`}
                      style={{ ['--group-color' as string]: group.color }}
                      onClick={() => toggle(friend.id)}
                      aria-pressed={active}
                    >
                      <span className="meetup-friend__avatar">{friend.initials.slice(0, 1)}</span>
                      <span>{friend.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <button
              type="button"
              className="meetup-sheet__confirm"
              disabled={selected.size === 0}
              onClick={() => setConfirmed(true)}
            >
              {selected.size > 0 ? `친구 ${selected.size}명과 약속 확정` : '친구를 먼저 선택하세요'}
            </button>
          </>
        )}
        {restaurant && confirmed && (
          <div className="meetup-sheet__done">
            <p className="meetup-sheet__done-emoji">🎊</p>
            <p className="meetup-sheet__done-text">
              {restaurant.name}에서 {selected.size}명과의 약속이 만들어졌어요!
            </p>
            <button type="button" className="meetup-sheet__confirm" onClick={handleClose}>
              닫기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
