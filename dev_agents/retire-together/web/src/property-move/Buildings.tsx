// Code-native isometric architecture, using the pension concept's palette.
export function Buildings({ target = false, compact = false }: { target?: boolean; compact?: boolean }) {
  return <svg className={compact ? 'property-move-building compact' : 'property-move-building'} viewBox="0 0 360 310" aria-hidden="true">
    <ellipse cx="181" cy="260" rx="134" ry="32" fill="var(--grey-100)"/>
    <path d="M32 231 178 168 328 229 180 294Z" fill="var(--grey-200)"/>
    <path d="M32 224 178 161 328 222 180 287Z" fill="var(--grey-50)" stroke="var(--grey-300)"/>
    <path d="m49 238 130 53 134-57M65 244l129-56" fill="none" stroke="var(--grey-200)"/>
    {[{ x: 86, y: 84, h: 133, w: 57 }, { x: 172, y: target ? 36 : 64, h: target ? 187 : 159, w: 67 }].map(({ x, y, h, w }, i) => <g key={i}>
      <path d={`M${x} ${y + 15}v${h}l${w} 24V${y + 39}Z`} fill={target ? 'var(--cls-mid-bond)' : 'var(--grey-300)'}/>
      <path d={`M${x + w} ${y + 39}v${h}l36-16V${y + 23}Z`} fill={target ? 'var(--cls-long-bond)' : 'var(--grey-500)'}/>
      <path d={`m${x - 3} ${y + 14} 39-17 ${w + 6} 24-39 18Z`} fill={target ? 'var(--cls-mid-bond)' : 'var(--grey-100)'} stroke="var(--card)"/>
      {Array.from({ length: i === 1 ? 7 : 5 }, (_, row) => <g key={row}>
        {[0, 1, 2].map(col => <path key={col} d={`m${x + 9 + col * 16} ${y + 36 + row * 21 + col * 6} 8 3v10l-8-3Z`} fill="var(--card)" opacity={row === 3 && col === 1 ? .4 : .85}/>)}
        {[0, 1].map(col => <path key={col} d={`m${x + w + 7 + col * 13} ${y + 47 + row * 21 - col * 6} 7-3v10l-7 3Z`} fill="var(--card)" opacity=".65"/>)}
      </g>)}
      <path d={`m${x + 22} ${y + h - 4} 14 6v27l-14-6Z`} fill="var(--grey-800)"/>
    </g>)}
    {[{ x: 57, y: 209 }, { x: 291, y: 224 }, { x: 275, y: 244 }].map(({ x, y }) => <g key={x}><path d={`M${x} ${y}v20`} stroke="var(--grey-500)" strokeWidth="3"/><ellipse cx={x} cy={y - 5} rx="12" ry="19" fill="var(--cls-mid-bond)"/><path d={`M${x} ${y - 15}v26`} stroke="var(--cls-long-bond)"/></g>)}
    <path d="m130 269 15 6 12-5-15-6Z" fill="var(--cls-gold)"/>
  </svg>
}
