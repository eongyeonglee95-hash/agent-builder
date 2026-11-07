// 화면 '테마' 버튼 — 테마 3개 중 하나를 골라 :root 토큰(--brand 계열, --page-bg, --accent-hi)을 덮어쓴다 (2026-11-07 사용자: 시안 A·D·C를 "다크모드처럼 손쉽게" 바꾸기, 기본은 D).
// 다크는 html[data-theme=dark]로 켜고 shell-theme.css가 사이드바·상단·홈만 어둡게 한다(다른 페이지는 밝게 유지 — 사용자 결정). 상승 빨강·하락 파랑·자산군 색은 건드리지 않는다.
// 로고는 <symbol id="rt-mark">를 바꿔 끼운다 — Brand 컴포넌트는 <use href="#rt-mark">만 그린다. 저장은 localStorage 'rt-brand'.
import './brand-mode.css'
import togetherMark from './assets/retire-together-mark.svg?raw'

// 이름은 우리 말로, 참고 사이트는 title에만 (실제 회사 이름을 화면 라벨로 쓰지 않는다)
const THEMES = {
  light: { name: '라이트', ref: 'Ramp 결', dark: false, swatch: '#0a0a0a', vars: { '--brand': '#0a0a0a', '--brand-tint': '#f1f6d9', '--brand-dark': '#0b0b0c', '--brand-ink': '#ffffff', '--page-bg': '#fafaf8', '--accent-hi': '#d4f04c', '--accent-hi-ink': '#0a0a0a' } },
  green: { name: '그린', ref: 'Mercury 결', dark: false, swatch: '#0f5c4a', vars: { '--brand': '#0f5c4a', '--brand-tint': '#e3f0ea', '--brand-dark': '#0e1a17', '--brand-ink': '#ffffff', '--page-bg': '#f6f6f3', '--accent-hi': '#7fd1b4', '--accent-hi-ink': '#0e1a17' } },
  dark: { name: '다크', ref: 'Robinhood 결', dark: true, swatch: '#10221a', vars: { '--brand': '#0b8a5c', '--brand-tint': '#e2f6ec', '--brand-dark': '#0f1318', '--brand-ink': '#ffffff', '--page-bg': '#f6f7f9', '--accent-hi': '#5ee0a8', '--accent-hi-ink': '#06130d' } },
} as const
type ThemeId = keyof typeof THEMES
// 로고 마크 후보 — 48×48, 단색(currentColor). 24px에서도 읽히는 굵기
export const MARKS: Record<string, { name: string; svg: string }> = {
  together: { name: '나란한 내일', svg: togetherMark.replace(/<\/?svg\b[^>]*>/g, '') },
  rings: { name: '두 고리', svg: '<circle cx="18" cy="24" r="11" stroke="currentColor" stroke-width="5" fill="none"/><circle cx="30" cy="24" r="11" stroke="currentColor" stroke-width="5" fill="none" opacity=".55"/>' },
  bridge: { name: '함께 건너는 다리', svg: '<path d="M5 34 Q24 6 43 34" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M5 34 H43" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M16 34 V22 M32 34 V22" stroke="currentColor" stroke-width="3.5" opacity=".55" stroke-linecap="round"/>' },
  sunrise: { name: '두 줄 위 해', svg: '<path d="M10 28 A14 14 0 0 1 38 28 Z" fill="currentColor"/><path d="M6 33 H42" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M12 40 H36" stroke="currentColor" stroke-width="4" stroke-linecap="round" opacity=".55"/>' },
  pagoda: { name: '석탑', svg: '<rect x="9" y="33" width="30" height="8" rx="2.5" fill="currentColor"/><rect x="13" y="22" width="22" height="7" rx="2.5" fill="currentColor" opacity=".75"/><rect x="17" y="12" width="14" height="6" rx="2.5" fill="currentColor" opacity=".5"/><path d="M24 4 V10" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".5"/>' },
  leaves: { name: '두 잎 새싹', svg: '<path d="M24 42 V24" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M24 26 C24 14 15 8 6 9 C6 19 13 26 24 26 Z" fill="currentColor"/><path d="M24 22 C24 11 32 6 42 7 C42 16 35 22 24 22 Z" fill="currentColor" opacity=".55"/>' },
  path: { name: '나란한 두 길', svg: '<path d="M10 42 C10 26 20 22 20 6" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M28 42 C28 26 38 22 38 6" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round" opacity=".55"/>' },
}
const KEY = 'rt-brand'

// index.html의 첫 그리기 스크립트가 vars·dark를 그대로 읽는다
type Saved = { theme: ThemeId; mark: string; markVersion: number; dark: boolean; vars: Record<string, string> }
function saved(theme: ThemeId, mark: string): Saved { return { theme, mark, markVersion: 2, dark: THEMES[theme].dark, vars: { ...THEMES[theme].vars } } }
function load(): Saved {
  // 예전 주색 저장(hex)은 테마가 없으므로 기본 테마로 시작하되 로고 선택은 이어받는다
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) return saved(s.theme in THEMES ? s.theme : 'light', s.markVersion === 2 && MARKS[s.mark] ? s.mark : 'together') } catch { /* 저장 없음 */ }
  return saved('light', 'together')
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
  const m = MARKS[state.mark] ?? MARKS.together
  sprite.querySelector('symbol')!.innerHTML = m.svg
  // 파비콘도 같은 마크로
  const fav = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="13" fill="${state.vars['--brand-dark']}"/><g color="#fff" transform="translate(6 6) scale(.75)">${m.svg}</g></svg>`
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]'); if (link) link.href = 'data:image/svg+xml,' + encodeURIComponent(fav)
}
function apply(theme: ThemeId) {
  state = saved(theme, state.mark)
  for (const [k, v] of Object.entries(state.vars)) document.documentElement.style.setProperty(k, v)
  document.documentElement.dataset.theme = state.dark ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', state.vars['--brand-dark'])
  applyMark()
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* 비공개 창 등 */ }
  render()
}

const host = document.createElement('div'); host.className = 'brand-mode'; document.body.appendChild(host)
const dot = (hex: string) => `<i style="background:${hex}"></i>`
function render() {
  host.dataset.open = String(open)
  const current = THEMES[state.theme]
  host.innerHTML = open ? `<div class="bm-bar" role="toolbar" aria-label="화면 테마 고르기"><em>테마</em>${(Object.keys(THEMES) as ThemeId[]).map(id => `<button type="button" data-theme="${id}" aria-pressed="${id === state.theme}" title="${THEMES[id].ref}">${dot(THEMES[id].swatch)}<span>${THEMES[id].name}</span></button>`).join('')}
      <button type="button" class="bm-close" aria-label="테마 바 접기">접기</button></div>` : `<button type="button" class="bm-toggle" aria-label="테마 변경" aria-expanded="false">${dot(current.swatch)}테마 · ${current.name}</button>`
}
host.addEventListener('click', e => {
  const t = e.target as HTMLElement
  if (t.closest('.bm-toggle,.bm-close')) { open = !open; try { localStorage.setItem(KEY + '-open', open ? '1' : '0') } catch { /* */ } render(); return }
  const b = t.closest('button[data-theme]') as HTMLElement | null
  if (b?.dataset.theme && b.dataset.theme in THEMES) apply(b.dataset.theme as ThemeId)
})
apply(state.theme)
