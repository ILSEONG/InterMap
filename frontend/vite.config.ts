import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 앱(APK) 빌드에선 폰트 파일이 기기 안에 있어 곧바로 읽힌다. 기본 글꼴로 먼저 그렸다 웹폰트로 바꾸면(swap)
// 글자 폭이 바뀌며 칩·목록이 몇 px씩 흔들린다 — 특히 한글은 글자 묶음 파일이 여러 개라 새 글자가 나올 때마다.
// 그래서 앱 빌드만 FONT_DISPLAY=block으로 웹폰트를 기다리게 한다 (웹은 느린 망을 생각해 swap 그대로).
const fontDisplay = process.env.FONT_DISPLAY

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: fontDisplay
        ? [
            {
              postcssPlugin: 'font-display',
              Declaration: {
                'font-display': (decl) => {
                  decl.value = fontDisplay
                },
              },
            },
          ]
        : [],
    },
  },
})
