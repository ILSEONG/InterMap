import type { FriendGroup, GroupId } from '../data/model'
import './GroupFilterSheet.css'

interface GroupFilterSheetProps {
  open: boolean
  groups: FriendGroup[]
  activeGroupIds: Set<GroupId>
  colors: Record<GroupId, string>
  onToggle: (id: GroupId) => void
  onColorChange: (id: GroupId, color: string) => void
  onClose: () => void
}

export default function GroupFilterSheet({
  open,
  groups,
  activeGroupIds,
  colors,
  onToggle,
  onColorChange,
  onClose,
}: GroupFilterSheetProps) {
  return (
    <div className={`filter-sheet-overlay${open ? ' filter-sheet-overlay--open' : ''}`} onClick={onClose}>
      <div className="filter-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="맵필터" aria-hidden={!open}>
        <div className="filter-sheet__handle" />
        <h2 className="filter-sheet__title">맵필터</h2>
        <p className="filter-sheet__hint">겹치는 지도에서는 우선순위가 높은 그룹 색이 먼저 보여요.</p>
        <ul className="filter-sheet__list">
          {[...groups]
            .sort((a, b) => a.priority - b.priority)
            .map((group, index) => {
              const active = activeGroupIds.has(group.id)
              return (
                <li key={group.id} className="filter-sheet__row">
                  <button
                    type="button"
                    className={`filter-sheet__toggle${active ? ' filter-sheet__toggle--active' : ''}`}
                    style={{ ['--group-color' as string]: group.color }}
                    onClick={() => onToggle(group.id)}
                    aria-pressed={active}
                  >
                    <span className="filter-sheet__priority">{index + 1}순위</span>
                    <span className="filter-sheet__dot" />
                    <span className="filter-sheet__label">{group.label}</span>
                    <span className="filter-sheet__check">{active ? '표시중' : '숨김'}</span>
                  </button>
                  <label className="filter-sheet__color-wrap">
                    <input
                      type="color"
                      className="filter-sheet__color"
                      value={colors[group.id]}
                      onChange={(e) => onColorChange(group.id, e.target.value)}
                      aria-label={`${group.label} 마커 색 바꾸기`}
                    />
                    <span className="filter-sheet__color-label">색 변경</span>
                  </label>
                </li>
              )
            })}
        </ul>
        <button type="button" className="filter-sheet__done" onClick={onClose}>
          지도에 적용하기
        </button>
      </div>
    </div>
  )
}
