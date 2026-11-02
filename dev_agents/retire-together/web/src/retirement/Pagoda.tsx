import { useId, type CSSProperties } from 'react'
import './pagoda-color.css'

type Floor = { y: number; w: number; h: number }
type LayerState = { label: string }
const floors: Floor[] = [{ y: 365, w: 160, h: 66 }, { y: 283, w: 124, h: 62 }, { y: 210, w: 96, h: 56 }, { y: 145, w: 73, h: 48 }]
const point = (x: number, y: number) => `${x},${y}`
const diamond = (w: number, y: number, d = w * .30) => `${point(250, y - d)} ${point(250 + w, y)} ${point(250, y + d)} ${point(250 - w, y)}`

// Stone geometry identifies a pension layer; its size and tint do not encode a balance.
function Stonework({ floor: { y, w, h }, n }: { floor: Floor; n: number }) {
  const d = w * .3, bw = w * .48, bd = bw * .3
  return <>
          {/* Stone body with the corner pillars carved into the two visible faces. */}
          <path className="tower-stone-front" d={`M${250 - bw} ${y + 8} 250 ${y + 8 + bd}v${h - 8}l${-bw} ${-bd}Z`}/>
          <path className="tower-stone-side" d={`M250 ${y + 8 + bd}l${bw} ${-bd}v${h - 8}L250 ${y + h + bd}Z`}/>
          <path d={`M${250 - bw + 9} ${y + 12}v${h - 18}m${bw - 18} ${-h + 23}v${h - 18}m18 ${-h + 15}v${h - 18}m${bw - 18} ${-h - 2}v${h - 18}`} stroke="var(--grey-600)" strokeOpacity=".3" fill="none"/>
          {/* Stepped brackets below the roofstone. */}
          {[2, 1, 0].map(step => {
            const sw = w * (.66 + step * .055), sy = y + 14 - step * 4, sd = sw * .3
            return <g key={step}><polygon points={diamond(sw, sy)} className="tower-stone-top"/><path d={`M${250 - sw} ${sy} 250 ${sy + sd} ${250 + sw} ${sy}v4L250 ${sy + sd + 4} ${250 - sw} ${sy + 4}Z`} className="tower-stone-side"/></g>
          })}
          {/* Low, gently lifted eaves: the recognisable silhouette of a Korean stone pagoda. */}
          <path className="tower-roof-top" d={`M250 ${y - 37}Q${250 + w * .58} ${y - 18} ${250 + w} ${y - 5}L250 ${y + d} ${250 - w} ${y - 5}Q${250 - w * .58} ${y - 18} 250 ${y - 37}Z`}/>
          <path className="tower-roof-slope" d={`M250 ${y - 37}v${37 + d}L${250 - w} ${y - 5}Q${250 - w * .58} ${y - 18} 250 ${y - 37}Z`}/>
          <path className="tower-stone-front" d={`M${250 - w} ${y - 5}Q${250 - w * .88} ${y + 6} 250 ${y + d}v9Q${250 - w * .88} ${y + 15} ${250 - w} ${y + 4}Z`}/>
          <path className="tower-stone-side" d={`M${250 + w} ${y - 5}Q${250 + w * .88} ${y + 6} 250 ${y + d}v9Q${250 + w * .88} ${y + 15} ${250 + w} ${y + 4}Z`}/>
          <path d={`M${250 - w} ${y - 5}Q${250 - w * .88} ${y + 6} 250 ${y + d}Q${250 + w * .88} ${y + 6} ${250 + w} ${y - 5}`} stroke="var(--background)" strokeOpacity=".8" fill="none"/>
          {n === 4 && <g className="tower-finial" aria-hidden="true">
            <polygon points={diamond(21, y - 42)} className="tower-stone-top"/><path d={`m229 ${y - 42} 21 6 21-6v7l-21 6-21-6Z`} className="tower-stone-side"/>
            <path d={`M250 ${y - 55}q-18 8-14 12 14 7 28 0 4-4-14-12Z`} className="tower-stone-front"/>
            {[0, 1, 2].map(k => <ellipse key={k} cx="250" cy={y - 62 - k * 9} rx={17 - k * 3} ry="4" className="tower-stone-side"/>)}
            <path d={`M250 ${y - 96}v46`} stroke="var(--grey-500)" strokeWidth="3"/>
            <path d={`M250 ${y - 104}q-12 13 0 17 12-4 0-17Z`} className="tower-stone-front"/>
          </g>}
  </>
}

// Four financial layers inspired by Seokgatap, not a reconstruction of the monument.
export function Pagoda({ selected, states, onSelect }: {
  selected: number; states: LayerState[]
  onSelect: (layer: number) => void
}) {
  const id = useId().replaceAll(':', '')
  return <svg className="tower-pagoda" viewBox="0 0 500 555" preserveAspectRatio="xMidYMin meet" aria-label="석가탑의 형태를 네 연금층으로 재해석한 우리집 연금탑" aria-describedby={`${id}-color-description`}>
    <desc id={`${id}-color-description`}>네 가지 색은 국민연금, 퇴직연금, 개인연금, 추가연금의 종류를 구분합니다. 층의 크기와 색은 금액이나 준비율을 나타내지 않습니다. 각 층을 누르면 상세 내용을 볼 수 있습니다.</desc>
    <defs>
      <radialGradient id={`${id}-ground`}><stop stopColor="var(--grey-900)" stopOpacity=".16"/><stop offset="1" stopColor="var(--grey-900)" stopOpacity="0"/></radialGradient>
      <linearGradient id={`${id}-stone`} x1="0" x2="1" y2=".8"><stop stopColor="var(--grey-100)"/><stop offset="1" stopColor="var(--grey-300)"/></linearGradient>
      <filter id={`${id}-shadow`} x="-30%" y="-40%" width="160%" height="200%"><feDropShadow dx="0" dy="7" stdDeviation="5" floodColor="var(--grey-900)" floodOpacity=".12"/></filter>
    </defs>
    <g aria-hidden="true">
      <ellipse cx="250" cy="491" rx="224" ry="55" fill={`url(#${id}-ground)`}/>
      <path d="m17 464 233-70 233 70-233 70Z" fill="none" stroke="var(--grey-200)"/>
      <polygon points={diamond(210, 456)} fill="var(--grey-100)"/>
      <path d="m40 456 210 63v12L40 468Z" fill="var(--grey-300)"/><path d="m460 456-210 63v12l210-63Z" fill="var(--grey-400)"/>
      <polygon points={diamond(186, 437)} fill={`url(#${id}-stone)`}/>
      <path d="m64 437 186 56v16L64 453Z" fill="var(--grey-300)"/><path d="m436 437-186 56v16l186-56Z" fill="var(--grey-400)"/>
      <path d="m93 425 157 47v12L93 437Z" fill="var(--grey-200)"/><path d="m407 425-157 47v12l157-47Z" fill="var(--grey-300)"/>
      <polygon points={diamond(157, 425)} fill="var(--grey-100)"/>
      {/* Masonry joints on the broad foundation; a decorative base, never a fifth layer. */}
      <path d="m122 456 0 15m65 5v15m130-15v15m63-35v15" fill="none" stroke="var(--grey-400)" strokeOpacity=".45"/>
    </g>
    {floors.map((floor, i) => {
      const { y, w, h } = floor
      const n = i + 1, d = w * .3, bw = w * .48
      return <g key={n} className="tower-tier" style={{ '--tower-accent': `var(--tower-layer-${n})` } as CSSProperties}
        role="button" tabIndex={0} aria-label={`${n}층 ${states[i].label}`} aria-pressed={selected === n}
        onClick={() => onSelect(n)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n) } }}>
        <g className="tower-tier-stone" filter={`url(#${id}-shadow)`}>
          <Stonework floor={floor} n={n}/>
          <path className="tower-tier-accent" d={`M${250 - w} ${y + 7}Q${250 - w * .88} ${y + 18} 250 ${y + d + 12}Q${250 + w * .88} ${y + 18} ${250 + w} ${y + 7}`} fill="none"/>
          <text x={250 - bw * .63} y={y + h - 7} transform={`rotate(17 ${250 - bw * .63} ${y + h - 7})`} className="tower-carved-number">0{n}</text>
        </g>
      </g>
    })}
  </svg>
}
