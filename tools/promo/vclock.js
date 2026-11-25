// 화면 속 시계를 손에 쥔다 — 영상을 한 프레임씩(1/30초) 넘기며 찍기 위해서다.
// 느린 기계에서 실시간으로 녹화하면 전환이 뚝뚝 끊기는데, 시계를 멈춰 두고 한 칸씩 넘기면 그리는 데 얼마가 걸리든 매 프레임이 온전히 찍힌다.
// 평소(녹화 밖)에는 진짜 시계를 따라 저절로 흐른다.
(() => {
  if (window.__vt) return
  const R = { now: performance.now.bind(performance), Date, st: window.setTimeout.bind(window), si: window.setInterval.bind(window) }
  const epoch = R.Date.now(), vt0 = R.now()
  let vt = vt0, seq = 1, manual = false, lastReal = vt0
  const timers = new Map(), rafs = new Map()
  let tracked = new Map() // Animation -> { t0, done }

  performance.now = () => vt
  class VDate extends R.Date {
    constructor(...a) { if (a.length === 0) super(epoch + (vt - vt0)); else super(...a) }
    static now() { return epoch + (vt - vt0) }
  }
  window.Date = VDate
  window.setTimeout = (fn, ms, ...args) => { const id = seq++; timers.set(id, { at: vt + Math.max(0, +ms || 0), fn, args, every: 0 }); return id }
  window.setInterval = (fn, ms, ...args) => { const id = seq++; const every = Math.max(1, +ms || 0); timers.set(id, { at: vt + every, fn, args, every }); return id }
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id) }
  window.requestAnimationFrame = (fn) => { const id = seq++; rafs.set(id, fn); return id }
  window.cancelAnimationFrame = (id) => { rafs.delete(id) }
  window.webkitRequestAnimationFrame = window.requestAnimationFrame
  window.webkitCancelAnimationFrame = window.cancelAnimationFrame

  function advance(dt) {
    const target = vt + dt
    for (let guard = 0; guard < 5000; guard++) {
      let next = null, nid = 0
      for (const [id, t] of timers) if (t.at <= target && (!next || t.at < next.at)) { next = t; nid = id }
      if (!next) break
      vt = Math.max(vt, next.at)
      if (next.every) next.at += next.every; else timers.delete(nid)
      if (typeof next.fn === 'function') { try { next.fn(...next.args) } catch (e) { console.error(e) } }
    }
    vt = target
    const cbs = [...rafs.values()]; rafs.clear()
    for (const cb of cbs) { try { cb(vt) } catch (e) { console.error(e) } }
  }
  const tick = () => new Promise((r) => R.st(r, 0))
  function adopt(a, t0) { tracked.set(a, { t0, done: false }); try { a.pause() } catch { /* 이미 끝난 것 */ } }

  R.si(() => { if (manual) return; const n = R.now(); advance(Math.min(100, n - lastReal)); lastReal = n }, 16)

  window.__vt = {
    manual(on) {
      manual = on; lastReal = R.now()
      if (on) { tracked = new Map(); for (const a of document.getAnimations()) adopt(a, vt - (Number(a.currentTime) || 0)) }
      else { for (const [a, s] of tracked) if (!s.done) { try { a.play() } catch { /* 사라진 것 */ } } tracked = new Map() }
    },
    // 한 프레임 넘긴다: 타이머·rAF를 돌리고, CSS 전환·애니메이션을 같은 시각으로 맞춘다
    async step(dt) {
      const before = vt
      advance(dt)
      await tick(); await tick()
      for (const a of document.getAnimations()) {
        let s = tracked.get(a)
        if (!s) { adopt(a, before); s = tracked.get(a) }
        if (s.done) continue
        const end = a.effect ? Number(a.effect.getComputedTiming().endTime) : Infinity
        const t = vt - s.t0
        if (t >= end) { s.done = true; try { a.finish() } catch { /* 끝이 없는 것 */ } } else { try { a.currentTime = t } catch { /* 사라진 것 */ } }
      }
      await tick()
    },
  }
})()
