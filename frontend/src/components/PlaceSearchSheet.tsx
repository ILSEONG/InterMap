import { useState } from 'react'
import { searchPlaces } from '../lib/api'
import type { PlaceSearchResult } from '../lib/api'
import './PlaceSearchSheet.css'

interface PlaceSearchSheetProps {
  open: boolean
  onClose: () => void
  onPick: (place: PlaceSearchResult) => void
}

export default function PlaceSearchSheet({ open, onClose, onPick }: PlaceSearchSheetProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PlaceSearchResult[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  async function runSearch() {
    if (!query.trim()) return
    setStatus('loading')
    try {
      const found = await searchPlaces(query.trim())
      setResults(found)
      setStatus('idle')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '검색 중 오류가 발생했어요')
      setStatus('error')
    }
  }

  return (
    <div className={`place-sheet-overlay${open ? ' place-sheet-overlay--open' : ''}`} onClick={onClose}>
      <div className="place-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="음식점 등록">
        <div className="place-sheet__handle" />
        <h2 className="place-sheet__title">🔍 음식점 등록</h2>
        <p className="place-sheet__hint">네이버 지역검색으로 실제 업체를 찾아 지도에 등록해요.</p>

        <div className="place-sheet__search">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            placeholder="예: 연남동 파스타"
            aria-label="음식점 검색어"
          />
          <button type="button" onClick={runSearch} disabled={!query.trim() || status === 'loading'}>
            {status === 'loading' ? '검색중…' : '검색'}
          </button>
        </div>

        {status === 'error' && <p className="place-sheet__error">{errorMessage}</p>}

        <ul className="place-sheet__results">
          {results.map((place) => (
            <li key={`${place.name}-${place.lat}-${place.lng}`}>
              <button type="button" className="place-result" onClick={() => onPick(place)}>
                <span className="place-result__name">{place.name}</span>
                <span className="place-result__category">{place.category}</span>
                <span className="place-result__address">{place.roadAddress || place.address}</span>
              </button>
            </li>
          ))}
          {status === 'idle' && results.length === 0 && query && (
            <li className="place-sheet__empty">검색 결과가 없어요.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
