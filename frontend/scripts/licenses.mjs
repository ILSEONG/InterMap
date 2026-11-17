// 앱에 들어가는 오픈소스의 라이선스 고지 화면(public/licenses.html)을 만든다.
// MIT·Apache·OFL 등은 배포물에 저작권·라이선스 문구를 함께 넣는 것이 조건이다 — 앱의 마이페이지에서 이 화면을 연다.
// `npm run build`가 매번 다시 만들므로 라이브러리가 바뀌어도 따로 손댈 것이 없다 (손으로 돌릴 때: npm run licenses).
// package.json의 dependencies에서 시작해 실제로 설치된 패키지를 따라가며 라이선스 원문 파일을 읽는다.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'licenses.html')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

// Node가 찾는 방식 그대로: 쓰는 쪽 폴더에서 위로 올라가며 node_modules/<이름>
function locate(name, from) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    if (dirname(dir) === dir) return null
  }
}

function licenseText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(f))
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null
}

function licenseName(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license?.type) return pkg.license.type
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type).join(' / ')
  return '표기 없음'
}

function collect() {
  const seen = new Map()
  const queue = Object.keys(readJson(join(root, 'package.json')).dependencies ?? {}).map((name) => [name, root])
  while (queue.length) {
    const [name, from] = queue.shift()
    const dir = locate(name, from)
    if (!dir) continue // 이 기기엔 설치되지 않는 선택 의존성
    const pkg = readJson(join(dir, 'package.json'))
    const key = `${pkg.name}@${pkg.version}`
    if (seen.has(key)) continue
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url
    seen.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: licenseName(pkg),
      text: licenseText(dir),
      home: pkg.homepage || (repo ? repo.replace(/^git\+/, '').replace(/\.git$/, '') : null),
    })
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) queue.push([dep, dir])
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// npm 패키지가 아니어서 위 목록에 안 잡히는 것 — 앱(안드로이드·iOS) 빌드에 함께 들어간다
const NATIVE = [
  ['AndroidX (AppCompat, CoordinatorLayout, Core, Core SplashScreen, Activity, Fragment, WebKit)', 'Apache-2.0', 'Copyright The Android Open Source Project', 'https://developer.android.com/jetpack/androidx'],
  ['Firebase Cloud Messaging SDK for Android (푸시 알림)', 'Apache-2.0', 'Copyright Google LLC', 'https://github.com/firebase/firebase-android-sdk'],
  ['Apache Cordova (Capacitor에 포함)', 'Apache-2.0', 'Copyright The Apache Software Foundation', 'https://cordova.apache.org'],
]

function page(packages) {
  const terms = readFileSync(join(root, 'public', 'terms.html'), 'utf8')
  const style = terms.slice(terms.indexOf('<style>'), terms.indexOf('</style>') + '</style>'.length)
  const ofl = packages.find((p) => p.license === 'OFL-1.1' && p.text)?.text
  const apache = packages.find((p) => p.license === 'Apache-2.0' && p.text)?.text
  const item = (p) => {
    // 원문 파일이 없는 패키지(Pretendard)는 같은 라이선스의 원문을 붙인다
    const text = p.text ?? (p.license === 'OFL-1.1' && ofl ? `${p.notice ?? ''}\n\n${ofl.slice(ofl.indexOf('This Font Software is licensed'))}`.trim() : null)
    return `      <details>
        <summary><strong>${esc(p.name)}</strong> ${esc(p.version)} · ${esc(p.license)}</summary>
        ${p.home ? `<p><a href="${esc(p.home)}" target="_blank" rel="noopener">${esc(p.home)}</a></p>` : ''}
        ${text ? `<pre>${esc(text)}</pre>` : `<p>라이선스: ${esc(p.license)}</p>`}
      </details>`
  }
  // Pretendard 패키지에는 라이선스 원문 파일이 없다 — 글꼴 파일 안에 든 저작권 표시(name 표)를 그대로 옮긴다
  for (const p of packages) if (p.name === 'pretendard') p.notice = 'Copyright © 2023 Kil Hyung-jin'
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="description" content="인터맵 앱에 포함된 오픈소스 소프트웨어와 글꼴의 라이선스 고지">
<title>오픈소스 라이선스 · 인터맵</title>
${style}
<style>
details{border-top:1px solid var(--line);padding:10px 0}
details:first-of-type{border-top:0}
summary{cursor:pointer;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12.5px;line-height:1.55;color:var(--ink-2);background:var(--th-bg);border-radius:14px;padding:12px 14px;margin:10px 0 4px}
</style>
</head>
<body>
<a class="skip" href="#main">본문 바로가기</a>
<header class="top">
  <div class="wrap top-in">
    <span class="brand">인터맵</span>
    <nav aria-label="정책 문서">
      <ul>
        <li><a href="privacy.html">개인정보처리방침</a></li>
        <li><a href="terms.html">이용약관</a></li>
        <li><a href="account-deletion.html">계정 삭제</a></li>
      </ul>
    </nav>
  </div>
</header>

<main id="main" class="wrap">
  <h1 id="top">오픈소스 라이선스</h1>
  <p class="lead">인터맵은 아래 오픈소스 소프트웨어와 글꼴을 사용합니다. 만들어 주신 분들께 감사드립니다. 이름을 누르면 저작권 표시와 라이선스 원문이 펼쳐집니다.</p>

  <article class="card">
    <section aria-labelledby="web">
      <h2 id="web">앱과 웹에 포함된 라이브러리·글꼴 (${packages.length}개)</h2>
${packages.map(item).join('\n')}
    </section>
  </article>

  <article class="card">
    <section aria-labelledby="native">
      <h2 id="native">안드로이드·iOS 앱에 함께 들어가는 라이브러리</h2>
      <ul>
${NATIVE.map(([name, license, notice, url]) => `        <li><strong>${esc(name)}</strong> · ${esc(license)} · ${esc(notice)} · <a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></li>`).join('\n')}
      </ul>
      ${apache ? `<details>
        <summary><strong>Apache License 2.0</strong> 원문</summary>
        <pre>${esc(apache)}</pre>
      </details>` : ''}
    </section>
  </article>
</main>

<footer class="wrap">
  <p>인터맵 · 운영 일성게임즈 (대표 최일성)</p>
  <p>문의 <a href="mailto:intermap0@gmail.com">intermap0@gmail.com</a></p>
</footer>
</body>
</html>
`
}

try {
  const packages = collect()
  if (packages.length === 0) throw new Error('설치된 패키지를 찾지 못했어요 (npm ci 먼저)')
  const html = page(packages)
  if (!existsSync(out) || readFileSync(out, 'utf8') !== html) writeFileSync(out, html)
  console.log(`오픈소스 라이선스 화면: ${packages.length}개 패키지 → public/licenses.html`)
} catch (e) {
  // 고지 화면을 못 만들었다고 앱 빌드까지 멈추지는 않는다 — 저장소에 들어 있는 지난 화면을 그대로 쓴다
  console.warn(`오픈소스 라이선스 화면을 새로 만들지 못했어요: ${e.message}`)
}
