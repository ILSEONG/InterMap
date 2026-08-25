# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack
User-specified: Spring Boot (backend/API) + React (frontend, Vite + TypeScript). Backend owns auth, 이웃/그룹 relationships, reviews/comments, meetup scheduling; frontend is a mobile-web SPA consuming it and rendering the Naver Map view.

## Users
Primary users are people choosing where to eat who want restaurant recommendations they can trust — from friends and acquaintances they've connected with in-app ("이웃"), not anonymous public reviewers or disconnected social feeds. Situation: standing at a map, deciding where to go now or planning ahead with friends.

## Product Purpose
인터맵(가제) overlays trusted-network restaurant reviews onto a map, starting with restaurants and designed to expand to other place categories later. It lets users see where their connected friends ("이웃") have reviewed, read those reviews and comments, and coordinate a meetup at a chosen place. Success means users pick where to eat based on people they know, not strangers.

## Positioning
The map surfaces restaurant reviews from a user's own connected friends ("이웃"), not the public at large (unlike Naver Map) and not an unconnected algorithmic feed (unlike Instagram). This is the one mechanism neither competitor can copy without becoming a different product: a social graph of confirmed "이웃" relationships driving what's visible on the map.

## Operating Context
- Base map: Naver Map (지도 데이터/타일 제공처로 확정, 별도 지도 SDK 대체 없음).
- Friend groups ("맵필터"): users organize connections into groups; each group has a distinct map dot color. When a place has reviews from multiple overlapping groups, the dot shown follows the user's own group sort/priority setting.
- Story bar: shows friends' restaurant reviews posted within the last 24 hours, Instagram-story-style, at the top of the map screen.
- Restaurant detail: tapping a restaurant shows its info, aggregate neighbor rating, menu, a horizontal slider of neighbors' reviews, and a comment section beneath each review.
- 약속잡기 (meetup): from a restaurant's detail view, a user can start a meetup flow, select friends, and lock in a plan tied to that place.

## Capabilities and Constraints
- Confirmed initial scope: restaurants only; expansion to other place categories is a stated future direction, not in scope now.
- Requires a "이웃" (friend/neighbor) connection model with mutual confirmation (implied by "서로 이웃을 맺은" — mutual, not one-directional follow) — exact connection mechanics (request/accept flow, discovery) not yet specified.
- Requires group-based friend organization with per-group color coding and user-defined sort/priority for overlapping dots — priority mechanics (manual reorder vs. other rule) not yet specified.
- Requires review authoring, per-review comments, ratings, and menu data tied to a place.
- Restaurant master data (name, address, open/closed status) is operator-managed, not user-editable: registration goes through Naver Local Search pick, dedupe is by name+road-address, and open/closed status syncs weekly from the LOCALDATA (지방행정 인허가, localdata.go.kr) public dataset. Menus/prices have no API source anywhere; they are operator-entered. Users write only reviews and comments.
- Requires a scheduling/meetup object tied to a place and a set of invited friends — RSVP/confirmation flow not yet specified.
- Depends on Naver Map platform/API terms and quota; no alternative map provider planned.

## Evidence on Hand
- 설계서.txt (설계서 원문, ASCII 레이아웃 와이어프레임 포함) at project root — the only source document; no user research, screenshots, brand assets, or existing code exist yet.

## Product Principles
1. Trust over reach: only connected "이웃" reviews surface on the map — never public/stranger content, even to fill sparse areas.
2. Map stays primary: the map is the persistent background/context; all detail (reviews, comments, meetup setup) layers on top of it rather than replacing it.
3. Groups, not one flat friend list: filtering and color-coding by friend group is core to how users read the map at a glance — don't collapse this to a single on/off toggle.
4. Restaurants first, structured to expand: data model and flows should assume future place categories beyond food, without building them now.
