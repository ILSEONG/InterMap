import { useEffect, useMemo, useState } from 'react'
import Header from './components/Header'
import StoryStrip from './components/StoryStrip'
import MapCanvas from './components/MapCanvas'
import GroupFilterSheet from './components/GroupFilterSheet'
import RestaurantSheet from './components/RestaurantSheet'
import MeetupSheet from './components/MeetupSheet'
import PlaceSearchSheet from './components/PlaceSearchSheet'
import { groups, friends, restaurants as initialRestaurants, groupById } from './data/mock'
import type { GroupId, Restaurant } from './data/mock'
import { fetchRestaurants, registerRestaurant } from './lib/api'
import type { PlaceSearchResult, RestaurantRecord } from './lib/api'
import './App.css'

/*
  THESIS: the map is a lively neighborhood scene where a friend's pick pops up
  like a doodle character you tap, not a data dashboard of pins.
  OWN-WORLD: chunky ink-outlined shapes, candy-bright per-group color, soft
  floating shadows, Jua display type over Pretendard body text.
  STORY: open app -> see illustrated map with friends' story chips and
  colored pins -> tap a pin -> read neighbor reviews/menu -> start a meetup.
  FIRST VIEWPORT: full-bleed illustrated map, floating pill header (필터 +
  multicolor 인터맵 wordmark), story strip riding just below it.
  FORM: Google Doodle interactive-scene, user-pinned via reference URL.
  FINISH: unreviewed and undocumented is unfinished; this build ends with
  the finish review, the verdict, DESIGN.md, and every shipping raster
  carrying its provenance.
*/

function toRestaurant(record: RestaurantRecord): Restaurant {
  return {
    id: `db-${record.id}`,
    name: record.name,
    category: record.category || '음식점',
    address: record.roadAddress || record.address,
    lat: record.lat,
    lng: record.lng,
    groupIds: [],
    menu: [],
    reviews: [],
    comments: [],
    closed: record.status === 'CLOSED',
  }
}

export default function App() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>(initialRestaurants)

  useEffect(() => {
    fetchRestaurants()
      .then((records) => {
        setRestaurants((prev) => {
          const merged = [...prev]
          for (const record of records) {
            const existing = merged.find(
              (r) => r.name === record.name && (r.address === record.roadAddress || r.address === record.address),
            )
            if (existing) {
              existing.closed = record.status === 'CLOSED'
            } else {
              merged.push(toRestaurant(record))
            }
          }
          return merged
        })
      })
      .catch(() => {
        // 백엔드 미기동 시 목데이터만으로 동작
      })
  }, [])
  const [activeGroupIds, setActiveGroupIds] = useState<Set<GroupId>>(new Set(groups.map((g) => g.id)))
  const [filterOpen, setFilterOpen] = useState(false)
  const [placeSearchOpen, setPlaceSearchOpen] = useState(false)
  const [selectedRestaurant, setSelectedRestaurant] = useState<Restaurant | null>(null)
  const [meetupRestaurant, setMeetupRestaurant] = useState<Restaurant | null>(null)

  const visibleRestaurants = useMemo(
    () => restaurants.filter((r) => r.groupIds.length === 0 || r.groupIds.some((g) => activeGroupIds.has(g))),
    [restaurants, activeGroupIds],
  )

  const todayStories = useMemo(() => {
    const activeFriendIds = new Set(
      restaurants.flatMap((r) => r.reviews.filter((rev) => rev.postedHoursAgo <= 24).map((rev) => rev.friendId)),
    )
    return friends
      .filter((f) => activeFriendIds.has(f.id) && activeGroupIds.has(f.groupId))
      .map((f) => ({ ...f, group: groupById(f.groupId) }))
  }, [restaurants, activeGroupIds])

  async function handlePlacePicked(place: PlaceSearchResult) {
    let newRestaurant: Restaurant
    try {
      newRestaurant = toRestaurant(await registerRestaurant(place))
    } catch {
      // 백엔드 미기동 시 로컬 상태로만 추가
      newRestaurant = {
        id: `place-${Date.now()}`,
        name: place.name,
        category: place.category || '음식점',
        address: place.roadAddress || place.address,
        lat: place.lat,
        lng: place.lng,
        groupIds: [],
        menu: [],
        reviews: [],
        comments: [],
      }
    }
    setRestaurants((prev) =>
      prev.some((r) => r.id === newRestaurant.id) ? prev : [...prev, newRestaurant],
    )
    setPlaceSearchOpen(false)
    setSelectedRestaurant(newRestaurant)
  }

  function toggleGroup(id: GroupId) {
    setActiveGroupIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="app">
      <MapCanvas restaurants={visibleRestaurants} groups={groups} onPick={setSelectedRestaurant} selectedId={selectedRestaurant?.id} />

      <div className="app__chrome">
        <Header onOpenFilter={() => setFilterOpen(true)} activeGroupCount={activeGroupIds.size} />
        <StoryStrip stories={todayStories} />
      </div>

      <button type="button" className="app__add-place" onClick={() => setPlaceSearchOpen(true)} aria-label="음식점 등록">
        +
      </button>

      <PlaceSearchSheet open={placeSearchOpen} onClose={() => setPlaceSearchOpen(false)} onPick={handlePlacePicked} />

      <GroupFilterSheet
        open={filterOpen}
        groups={groups}
        activeGroupIds={activeGroupIds}
        onToggle={toggleGroup}
        onClose={() => setFilterOpen(false)}
      />

      <RestaurantSheet
        restaurant={selectedRestaurant}
        groups={groups}
        onClose={() => setSelectedRestaurant(null)}
        onStartMeetup={(restaurant) => setMeetupRestaurant(restaurant)}
      />

      <MeetupSheet restaurant={meetupRestaurant} friends={friends} onClose={() => setMeetupRestaurant(null)} />
    </div>
  )
}
