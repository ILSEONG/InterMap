// 테스트용 가짜 네이버 지도 — 핀을 실제 DOM으로 그려서 진짜 탭·끌기로 눌러 볼 수 있다 (웹 메르카토르, 256px 타일)
(function () {
  const T = 256
  const world = (z) => T * Math.pow(2, z)
  const toPx = (lat, lng, z) => {
    const s = world(z), sin = Math.sin((lat * Math.PI) / 180)
    return { x: ((lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s }
  }
  const toLL = (x, y, z) => {
    const s = world(z), n = Math.PI - (2 * Math.PI * y) / s
    return new LatLng((180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), (x / s) * 360 - 180)
  }
  class LatLng { constructor(lat, lng) { this._lat = lat; this._lng = lng } lat() { return this._lat } lng() { return this._lng } }
  class Point { constructor(x, y) { this.x = x; this.y = y } }
  class Size { constructor(w, h) { this.width = w; this.height = h } }
  class LatLngBounds {
    constructor(sw, ne) { this._sw = sw; this._ne = ne }
    getSW() { return this._sw } getNE() { return this._ne }
    getMin() { return this._sw } getMax() { return this._ne }
    hasLatLng(p) { return p.lat() >= this._sw.lat() && p.lat() <= this._ne.lat() && p.lng() >= this._sw.lng() && p.lng() <= this._ne.lng() }
  }
  const Event = {
    addListener(target, name, fn) { ((target.__l ||= {})[name] ||= []).push(fn); return { target, name, fn } },
    removeListener(h) { if (!h) return; const a = (h.target.__l || {})[h.name] || []; const i = a.indexOf(h.fn); if (i >= 0) a.splice(i, 1) },
    trigger(target, name, ...args) { for (const fn of [...(((target.__l || {})[name]) || [])]) fn(...args) },
  }
  class KV { constructor() { this.__kv = {} } get(k) { return this.__kv[k] } set(k, v) { this.__kv[k] = v } }
  class Map extends KV {
    constructor(el, opts) {
      super()
      this.el = typeof el === 'string' ? document.getElementById(el) : el
      this.center = opts.center; this.zoom = opts.zoom; this.opts = { ...opts }
      this.markers = new Set()
      this.el.style.overflow = 'hidden'
      // 진짜 GL 지도처럼 그림 한 장(canvas)을 깔아 둔다 — 밤의 카페 필터·바탕 규칙이 걸리는 곳
      this.canvasWrap = document.createElement('div'); this.canvasWrap.style.cssText = 'position:absolute;inset:0'
      const c = document.createElement('canvas'); c.style.cssText = 'width:100%;height:100%;display:block'
      const g = c.getContext('2d'); g.fillStyle = '#f2efe9'; g.fillRect(0, 0, c.width, c.height)
      this.canvasWrap.appendChild(c); this.el.appendChild(this.canvasWrap)
      this.pane = document.createElement('div'); this.pane.className = 'fake-pane'; this.pane.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0'
      this.el.appendChild(this.pane)
      let down = null
      this.el.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.fake-marker,.fake-info')) return
        down = { x: e.clientX, y: e.clientY, moved: false, c: toPx(this.center.lat(), this.center.lng(), this.zoom) }
      })
      window.addEventListener('pointermove', (e) => {
        if (!down) return
        const dx = e.clientX - down.x, dy = e.clientY - down.y
        if (Math.abs(dx) + Math.abs(dy) > 6) down.moved = true
        if (down.moved) { this.center = toLL(down.c.x - dx, down.c.y - dy, this.zoom); this.layout(); window.__panned = (window.__panned || 0) + 1 }
      })
      window.addEventListener('pointerup', () => {
        if (!down) return
        const d = down; down = null
        if (d.moved) Event.trigger(this, 'idle')
        else Event.trigger(this, 'click', {})
      })
      window.__map = this; window.__markers = this.markers
      setTimeout(() => Event.trigger(this, 'idle'), 30)
    }
    size() { const r = this.el.getBoundingClientRect(); return { w: r.width || 390, h: r.height || 844 } }
    origin() { const c = toPx(this.center.lat(), this.center.lng(), this.zoom), s = this.size(); return { x: c.x - s.w / 2, y: c.y - s.h / 2 } }
    layout() { for (const m of this.markers) m.place(); if (this.info) this.info.place() }
    getZoom() { return this.zoom }
    setZoom(z) { if (z === this.zoom) return; this.zoom = z; this.layout(); Event.trigger(this, 'zoom_changed', z); setTimeout(() => Event.trigger(this, 'idle'), 10) }
    getCenter() { return this.center }
    setCenter(c) { this.center = c; this.layout(); setTimeout(() => Event.trigger(this, 'idle'), 10) }
    panTo(c) { this.setCenter(c) }
    morph(c, z) { this.center = c; if (z != null && z !== this.zoom) { this.zoom = z; Event.trigger(this, 'zoom_changed', z) } this.layout(); setTimeout(() => Event.trigger(this, 'idle'), 10) }
    getBounds() { const o = this.origin(), s = this.size(); const sw = toLL(o.x, o.y + s.h, this.zoom), ne = toLL(o.x + s.w, o.y, this.zoom); return new LatLngBounds(sw, ne) }
    setOptions(k, v) { if (typeof k === 'string') this.opts[k] = v; else Object.assign(this.opts, k) }
    getProjection() { return { fromCoordToOffset: (ll) => { const p = toPx(ll.lat(), ll.lng(), this.zoom); return new Point(p.x, p.y) }, fromOffsetToCoord: (p) => toLL(p.x, p.y, this.zoom) } }
    getSize() { const s = this.size(); return new Size(s.w, s.h) }
    getElement() { return this.el }
    destroy() { this.el.innerHTML = '' }
    autoResize() {} refresh() {}
  }
  class Marker extends KV {
    constructor(o) {
      super()
      this.position = o.position; this.icon = o.icon; this.z = o.zIndex || 0
      this.el = document.createElement('div'); this.el.className = 'fake-marker'; this.el.style.cssText = 'position:absolute;width:0;height:0'
      this.el.addEventListener('click', (e) => { e.stopPropagation(); Event.trigger(this, 'click', {}) })
      this.render(); this.setMap(o.map || null)
    }
    render() { const i = this.icon || {}; this.el.innerHTML = i.content || ''; this.el.style.zIndex = String(this.z + 1) }
    place() { if (!this.map) return; const p = toPx(this.position.lat(), this.position.lng(), this.map.zoom), o = this.map.origin(), a = (this.icon && this.icon.anchor) || { x: 0, y: 0 }; this.el.style.left = p.x - o.x - a.x + 'px'; this.el.style.top = p.y - o.y - a.y + 'px' }
    setMap(m) { if (this.map) { this.map.markers.delete(this); this.el.remove() } this.map = m; if (m) { m.markers.add(this); m.pane.appendChild(this.el); this.place() } }
    getMap() { return this.map }
    setPosition(p) { this.position = p; this.place() } getPosition() { return this.position }
    setIcon(i) { this.icon = i; this.render(); this.place() } getIcon() { return this.icon }
    setZIndex(z) { this.z = z; this.el.style.zIndex = String(z + 1) }
    getElement() { return this.el }
  }
  class InfoWindow {
    constructor(o) { this.o = o || {}; this.el = document.createElement('div'); this.el.className = 'fake-info'; this.el.style.cssText = 'position:absolute;z-index:999;transform:translate(-50%,-100%)'; this.content = this.o.content || '' }
    setContent(c) { this.content = c; if (typeof c === 'string') this.el.innerHTML = c; else { this.el.innerHTML = ''; this.el.appendChild(c) } }
    place() { if (!this.map || !this.anchor) return; this.el.style.left = this.anchor.el.style.left; this.el.style.top = this.anchor.el.style.top }
    open(map, anchor) { this.map = map; this.anchor = anchor; map.info = this; map.pane.appendChild(this.el); this.place(); window.__infoOpen = true }
    close() { if (this.map) { this.map.info = null; this.el.remove(); this.map = null } window.__infoOpen = false; window.__infoClosed = (window.__infoClosed || 0) + 1 }
    getMap() { return this.map }
  }
  window.naver = { maps: { Map, Marker, InfoWindow, LatLng, LatLngBounds, Point, Size, Event, jsContentLoaded: true, Position: { TOP_RIGHT: 1 } } }
  // 테스트 도우미
  const label = (m) => ((m.icon && m.icon.content) || '').match(/aria-label="([^"]*)"/)?.[1] || ''
  window.__pins = () => [...window.__markers].map(label).filter(Boolean)
  window.__pin = (name) => [...window.__markers].find((m) => label(m).startsWith(name))
  window.__tap = (name) => { const m = window.__pin(name); if (!m) return false; Event.trigger(m, 'click', {}); return true }
  window.__zoomTo = (z) => window.__map.setZoom(z)
  window.__pinBox = (name) => { const m = window.__pin(name); const b = m && m.el.querySelector('button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } }
})()
