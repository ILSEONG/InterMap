import { createContext } from 'react'

// 인터맵의 캐릭터 — 맛집 화면은 거북이, 카페 화면은 토끼.
// 지금 어느 화면인지에 따라 App이 정해 내려 주고, 지도의 캐릭터(TurtlePet)·기본 프로필 그림(Avatar)·로그인 창의 그림(AuthModal)이 같이 본다.
// 그래서 카페 화면에서는 스토리·후기·프로필의 기본 그림도 전부 토끼다 (직접 올린 프로필 사진은 그대로)
export type PetCharacter = 'turtle' | 'rabbit'

export const CharacterContext = createContext<PetCharacter>('turtle')
