// 가게 시트 기본 높이 — 고른 마커가 화면 정중앙 근처에 오므로 마커 바로 아래(화면 절반)까지만
export const sheetDefaultHeight = () => Math.round(window.innerHeight * 0.5 - 28)
// 기본 높이로 열린 시트의 윗변(화면 y) — 지도가 핀을 이 위쪽에 두려고 쓴다 (시트 아래 여백 6px)
export const restaurantSheetTop = () => window.innerHeight - 6 - sheetDefaultHeight()
