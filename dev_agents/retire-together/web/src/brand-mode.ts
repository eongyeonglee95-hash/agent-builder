// 화면 위 '테마 바' — 주색·바탕·로고를 바꿔 가며 실제 화면에서 본다 (2026-11-06~07 사용자: "색상을 이렇게 바꿔가면서 화면에서 볼 수 있게", "로고는 다시 그려보자").
// 고른 주색 하나에서 틴트·어두운 면·버튼 글자색을 계산해 :root 토큰(--brand 계열, --page-bg)을 덮어쓴다. 상승 빨강·하락 파랑·자산군 색은 건드리지 않는다.
// 로고는 <symbol id="rt-mark">를 바꿔 끼운다 — Brand 컴포넌트는 <use href="#rt-mark">만 그린다. 저장은 localStorage 'rt-brand'.
import './brand-mode.css'

type Preset = { hex: string; name: string; ref?: boolean }
const PRESETS: Preset[] = [
  { hex: '#0f5c4a', name: '소나무' }, { hex: '#3f3ca8', name: '인디고' }, { hex: '#6e2a5b', name: '자두' },
  { hex: '#1d6ae5', name: 'Betterment', ref: true }, { hex: '#ff692d', name: 'Monarch', ref: true },
  { hex: '#437cef', name: 'Copilot', ref: true }, { hex: '#ccff00', name: 'Robinhood', ref: true },
]
// 로고 마크 후보 — 48×48, 단색(currentColor). 24px에서도 읽히는 굵기
export const MARKS: Record<string, { name: string; svg: string }> = {
  rings: { name: '두 고리', svg: '<circle cx="18" cy="24" r="11" stroke="currentColor" stroke-width="5" fill="none"/><circle cx="30" cy="24" r="11" stroke="currentColor" stroke-width="5" fill="none" opacity=".55"/>' },
  bridge: { name: '함께 건너는 다리', svg: '<path d="M5 34 Q24 6 43 34" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M5 34 H43" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M16 34 V22 M32 34 V22" stroke="currentColor" stroke-width="3.5" opacity=".55" stroke-linecap="round"/>' },
  sunrise: { name: '두 줄 위 해', svg: '<path d="M10 28 A14 14 0 0 1 38 28 Z" fill="currentColor"/><path d="M6 33 H42" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M12 40 H36" stroke="currentColor" stroke-width="4" stroke-linecap="round" opacity=".55"/>' },
  pagoda: { name: '석탑', svg: '<rect x="9" y="33" width="30" height="8" rx="2.5" fill="currentColor"/><rect x="13" y="22" width="22" height="7" rx="2.5" fill="currentColor" opacity=".75"/><rect x="17" y="12" width="14" height="6" rx="2.5" fill="currentColor" opacity=".5"/><path d="M24 4 V10" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".5"/>' },
  leaves: { name: '두 잎 새싹', svg: '<path d="M24 42 V24" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M24 26 C24 14 15 8 6 9 C6 19 13 26 24 26 Z" fill="currentColor"/><path d="M24 22 C24 11 32 6 42 7 C42 16 35 22 24 22 Z" fill="currentColor" opacity=".55"/>' },
  path: { name: '나란한 두 길', svg: '<path d="M10 42 C10 26 20 22 20 6" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M28 42 C28 26 38 22 38 6" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55"/>' },
}
const KEY = 'rt-brand'

const hex2rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255] }
const rgb2hex = (c: number[]) => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t)
const lum = ([r, g, b]: number[]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

function vars(hex: string, bg: string) {
  const c = hex2rgb(hex), white = [255, 255, 255], night = [11, 13, 16]
  return {
    '--brand': hex,
    '--brand-tint': rgb2hex(mix(c, white, 0.88)),
    '--brand-dark': rgb2hex(mix(c, night, 0.72)),
    '--brand-ink': lum(c) > 0.6 ? '#111318' : '#ffffff',   // 밝은 주색이면 버튼 글자를 어둡게
    '--page-bg': bg === 'white' ? '#ffffff' : bg === 'tint' ? rgb2hex(mix(c, white, 0.95)) : '#f7f6f2',
  }
}
type Saved = { hex: string; bg: string; mark: string; vars: Record<string, string> }
function load(): Saved {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s && s.hex && s.bg) return { mark: 'rings', ...s } } catch { /* 저장 없음 */ }
  return { hex: PRESETS[0].hex, bg: 'cream', mark: 'rings', vars: vars(PRESETS[0].hex, 'cream') }
}
let state = load()
// e2e 같은 자동화 브라우저에서는 버튼을 가리지 않게 접은 채로 시작
let open = (() => { try { const v = localStorage.getItem(KEY + '-open'); return v ? v === '1' : !navigator.webdriver } catch { return !navigator.webdriver } })()

// 로고 심볼 (문서에 한 번)
const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
sprite.setAttribute('aria-hidden', 'true'); sprite.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
sprite.innerHTML = '<symbol id="rt-mark" viewBox="0 0 48 48"></symbol>'
document.body.prepend(sprite)
function applyMark() {
  const m = MARKS[state.mark] ?? MARKS.rings
  sprite.querySelector('symbol')!.innerHTML = m.svg
  // 파비콘도 같은 마크로
  const fav = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="${state.vars['--brand-dark']}"/><g color="#fff" transform="translate(6 6) scale(.75)">${m.svg}</g></svg>`
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]'); if (link) link.href = 'data:image/svg+xml,' + encodeURIComponent(fav)
}
function apply(next: Partial<Saved>) {
  const hex = next.hex ?? state.hex, bg = next.bg ?? state.bg, mark = next.mark ?? state.mark
  state = { hex, bg, mark, vars: vars(hex, bg) }
  for (const [k, v] of Object.entries(state.vars)) document.documentElement.style.setProperty(k, v)
  applyMark()
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* 비공개 창 등 */ }
  render()
}

const host = document.createElement('div'); host.className = 'brand-mode'; document.body.appendChild(host)
const dot = (hex: string) => `<i style="background:${hex}"></i>`
function render() {
  host.dataset.open = String(open)
  // 주색만 고른다 (2026-11-07 사용자: "주색 이것만 선택되게끔"). 바탕은 미색, 로고는 두 고리로 고정 — 코드엔 남겨 두고 바에서는 뺀다
  host.innerHTML = open ? `<div class="bm-bar" role="toolbar" aria-label="주색 고르기"><em>주색</em>${PRESETS.map(p => `<button type="button" data-hex="${p.hex}" aria-pressed="${p.hex === state.hex}" title="${p.ref ? '레퍼런스 · ' : ''}${p.name}">${dot(p.hex)}<span>${p.name}</span></button>`).join('')}
      <label class="bm-pick" title="직접 고르기"><input type="color" value="${state.hex}" aria-label="주색 직접 고르기"><code>${state.hex}</code></label>
      <button type="button" class="bm-close" aria-label="주색 바 접기">접기</button></div>` : `<button type="button" class="bm-toggle" aria-label="색상 변경" aria-expanded="false">${dot(state.hex)}색상 변경</button>`
}
host.addEventListener('click', e => {
  const t = e.target as HTMLElement
  if (t.closest('.bm-toggle,.bm-close')) { open = !open; try { localStorage.setItem(KEY + '-open', open ? '1' : '0') } catch { /* */ } render(); return }
  const b = t.closest('button[data-hex],button[data-bg],button[data-mark]') as HTMLElement | null
  if (!b) return
  if (b.dataset.hex) apply({ hex: b.dataset.hex }); else if (b.dataset.bg) apply({ bg: b.dataset.bg }); else if (b.dataset.mark) apply({ mark: b.dataset.mark })
})
host.addEventListener('input', e => { const i = e.target as HTMLInputElement; if (i.type === 'color') apply({ hex: i.value }) })
apply({})
