import { useId } from 'react'

// Four financial layers inspired by Seokgatap's eaves, corner pillars and finial.
// This is an original interface illustration, not a reconstruction of the monument.
export function Pagoda({ selected, states, onSelect, hidden }: {
  selected: number
  hidden: boolean
  states: { label: string; empty: boolean; inactive: boolean; funded: boolean; share: number | null }[]
  onSelect: (layer: number) => void
}) {
  const id = useId().replaceAll(':', '')
  const point = (x: number, y: number) => `${x},${y}`
  const diamond = (w: number, y: number, d = w * .30) => `${point(250, y - d)} ${point(250 + w, y)} ${point(250, y + d)} ${point(250 - w, y)}`
  const floors = [{ y: 365, w: 160, h: 66 }, { y: 283, w: 124, h: 62 }, { y: 210, w: 96, h: 56 }, { y: 145, w: 73, h: 48 }]
  return <svg className="tower-pagoda" viewBox="0 0 500 555" preserveAspectRatio="xMidYMin meet" aria-label="석가탑의 형태를 네 연금층으로 재해석한 우리집 연금탑">
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
    {floors.map(({ y, w, h }, i) => {
      const n = i + 1, d = w * .3, bw = w * .48, bd = bw * .3
      const state = states[i]
      const rail = `M${250 - w} ${y + 10}Q${250 - w * .88} ${y + 21} 250 ${y + d + 15}Q${250 + w * .88} ${y + 21} ${250 + w} ${y + 10}`
      const fill = hidden || state.share == null ? 0 : Math.min(100, Math.max(0, state.share))
      return <g key={n} className={`tower-tier${state.empty ? ' is-empty' : ''}${state.inactive ? ' is-inactive' : ''}${state.funded && !hidden ? ' is-funded' : ''}`}
        role="button" tabIndex={0} aria-label={`${n}층 ${state.label}`} aria-pressed={selected === n}
        onClick={() => onSelect(n)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(n) } }}>
        <g className="tower-tier-stone" filter={`url(#${id}-shadow)`}>
          {/* Stone body with the corner pillars carved into the two visible faces. */}
          <path className="tower-stone-front" d={`M${250 - bw} ${y + 8} 250 ${y + 8 + bd}v${h - 8}l${-bw} ${-bd}Z`}/>
          <path className="tower-stone-side" d={`M250 ${y + 8 + bd}l${bw} ${-bd}v${h - 8}L250 ${y + h + bd}Z`}/>
          <path d={`M${250 - bw + 9} ${y + 12}v${h - 18}m${bw - 18} ${-h + 23}v${h - 18}m18 ${-h + 15}v${h - 18}m${bw - 18} ${-h - 2}v${h - 18}`} stroke="var(--grey-600)" strokeOpacity=".3" fill="none"/>
          {state.funded && !hidden && <g className="tower-coin-stacks" aria-hidden="true">
            {/* Coins signal registered capital, not a numeric scale or a target. */}
            {[0, 1].map(stack => <g key={stack} transform={`translate(${250 + bw * (.28 + stack * .38)} ${y + h - bw * (.08 + stack * .1)})`}>
              {[0, 1, 2, 3].slice(0, stack === 0 ? 4 : 3).map(coin => <g key={coin} transform={`translate(0 ${-coin * 5})`}><path d="M-13-2v5c0 7 26 7 26 0v-5" fill="var(--cls-gold)" stroke="var(--background)" strokeWidth=".7"/><ellipse cy="-2" rx="13" ry="4" fill="color-mix(in srgb,var(--cls-gold) 40%,var(--background))" stroke="var(--cls-gold)" strokeWidth="1"/></g>)}
            </g>)}
          </g>}
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
          <path className="tower-tier-accent" style={{ stroke: `var(--tower-layer-${n})` }} d={`M${250 - w} ${y + 7}Q${250 - w * .88} ${y + 18} 250 ${y + d + 12}Q${250 + w * .88} ${y + 18} ${250 + w} ${y + 7}`} fill="none"/>
          <path className="tower-pagoda-gauge-track" d={rail} pathLength="100" fill="none" aria-hidden="true"/>
          {fill > 0 && <path className="tower-pagoda-gauge-fill" d={rail} pathLength="100" stroke={`var(--tower-fill-${n})`} strokeDasharray={`${fill} 100`} fill="none" aria-hidden="true"/>}
          <text x={250 - bw * .63} y={y + h - 7} transform={`rotate(17 ${250 - bw * .63} ${y + h - 7})`} className="tower-carved-number">0{n}</text>
          {n === 4 && <g className="tower-finial" aria-hidden="true">
            <polygon points={diamond(21, y - 42)} className="tower-stone-top"/><path d={`m229 ${y - 42} 21 6 21-6v7l-21 6-21-6Z`} className="tower-stone-side"/>
            <path d={`M250 ${y - 55}q-18 8-14 12 14 7 28 0 4-4-14-12Z`} className="tower-stone-front"/>
            {[0, 1, 2].map(k => <ellipse key={k} cx="250" cy={y - 62 - k * 9} rx={17 - k * 3} ry="4" className="tower-stone-side"/>)}
            <path d={`M250 ${y - 96}v46`} stroke="var(--grey-500)" strokeWidth="3"/>
            <path d={`M250 ${y - 104}q-12 13 0 17 12-4 0-17Z`} className="tower-stone-front"/>
          </g>}
        </g>
      </g>
    })}
  </svg>
}
