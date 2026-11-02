import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { ChevronLeft, ChevronRight, LockKeyhole, MousePointer2 } from 'lucide-react'
import type { Row } from '../workbook/retirement'
import { amount, LAYERS, PEOPLE, type Scope } from './presentation'
import './income-chart.css'

const man = (value: number) => (value / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })
const incomeLayers = LAYERS.filter(layer => layer.id < 4)
const color = (layer: number) => `var(--income-layer-${layer})`

export function IncomeChart({ rows, scope, year, onYearChange, onLayerSelect, hidden, showNeed }: {
  rows: Row[]; scope: Scope; year: number; onYearChange: (year: number) => void;
  onLayerSelect: (layer: number) => void; hidden: boolean; showNeed: boolean
}) {
  const uid = useId().replaceAll(':', '')
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(760)
  const [hoverYear, setHoverYear] = useState<number | null>(null)
  const [focusedLayer, setFocusedLayer] = useState<number | null>(null)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)))
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { setHoverYear(null); setFocusedLayer(null) }, [scope, hidden, width])
  useEffect(() => {
    if (hoverYear == null) return
    const dismiss = (event: KeyboardEvent) => { if (event.key === 'Escape') setHoverYear(null) }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [hoverYear])
  const selected = rows.find(row => row.year === year) ?? rows[0]
  const hovered = rows.find(row => row.year === hoverYear)
  const cursor = hovered ?? selected
  const first = rows[0].year, last = rows[rows.length - 1].year
  const selectedTotal = amount(selected, scope) ?? 0
  const ageText = (row: Row) => PEOPLE.filter(([who]) => (scope === 'together' || who === scope) && row.ages[who] != null)
    .map(([who, name]) => `${name} ${row.ages[who]}세`).join(' · ')
  const heights = rows.map(row => [0, ...[1, 2, 3].map(layer => amount(row, scope, layer) ?? 0)])
  const stacked = heights.map(values => values.map((_, index) => values.slice(0, index + 1).reduce((sum, v) => sum + v, 0)))
  const targetRow = showNeed ? rows.find(row => row.retired && row.need_real != null && row.need_real > 0) : undefined
  const target = targetRow?.need_real ?? 0
  const selectedTarget = showNeed && selected.retired ? selected.need_real : null
  const gap = selectedTarget != null && selectedTarget > 0 ? selectedTotal - selectedTarget : null
  const maxValue = Math.max(10000, target, ...stacked.map(values => values[3]))
  const tickSize = 10 ** Math.floor(Math.log10(maxValue / 3))
  const tickStep = Math.ceil(maxValue / 3 / tickSize) * tickSize
  const topValue = tickStep * 3
  const height = width < 500 ? 260 : 292
  const left = width < 500 ? 42 : 52, right = width - 14, top = 32, bottom = height - 46
  const x = (value: number) => left + (value - first) / (last - first + 1) * (right - left)
  const y = (value: number) => bottom - value / topValue * (bottom - top)
  // Keep the server's annual steps. Smoothing would invent amounts between years.
  const lineFor = (layer: number) => {
    let d = `M ${x(first)} ${y(stacked[0][layer])}`
    for (let i = 1; i < rows.length; i++) d += ` H ${x(rows[i].year)} V ${y(stacked[i][layer])}`
    return `${d} H ${x(last + 1)}`
  }
  const areaFor = (layer: number) => {
    let d = `${lineFor(layer)} V ${y(stacked[stacked.length - 1][layer - 1])} H ${x(last)}`
    for (let i = rows.length - 2; i >= 0; i--) d += ` V ${y(stacked[i][layer - 1])} H ${x(rows[i].year)}`
    return `${d} Z`
  }
  const yearStep = (right - left) / (last - first + 1) * 5 >= 70 ? 5 : 10
  const tickYears = [first]
  for (let tick = Math.ceil((first + 1) / yearStep) * yearStep; tick < last; tick += yearStep) {
    if (x(tick) - x(tickYears[tickYears.length - 1]) >= 64 && x(last) - x(tick) >= 64) tickYears.push(tick)
  }
  if (last !== first) tickYears.push(last)
  const cursorX = x(cursor.year + .5)
  const cursorTotal = amount(cursor, scope) ?? 0
  const cursorValues = stacked[rows.findIndex(row => row.year === cursor.year)]
  const nationalStart = rows.find(row => (amount(row, scope, 1) ?? 0) > 0)?.year
  const pointerYear = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const point = (event.clientX - rect.left) * width / rect.width
    return Math.max(first, Math.min(last, Math.floor(first + (point - left) / (right - left) * (last - first + 1))))
  }
  const selectYear = (next: number) => { setHoverYear(null); onYearChange(next) }
  const sliderPct = last === first ? 0 : (year - first) / (last - first) * 100
  return <div className="tower-income-chart" ref={container}>
    <div className="tower-income-heading">
      <div className="tower-income-total"><span className="tower-income-eyebrow">{scope === 'together' ? '우리 함께' : scope === 'me' ? '나' : '배우자'} 받는 월 연금 <span>세전 · 오늘의 돈</span></span>
        <strong data-testid="income-chart-total" data-won={hidden ? undefined : selectedTotal}>{hidden ? '••••••' : <>{man(selectedTotal)}<small>만 원 / 월</small></>}</strong>
        {gap != null && !hidden && <span className="tower-income-gap" data-covered={gap >= 0}><i/>{gap < 0 ? `목표 생활비까지 월 ${man(-gap)}만 원 더 필요해요` : gap === 0 ? '목표 생활비를 채웠어요' : `목표 생활비보다 월 ${man(gap)}만 원 여유 있어요`}</span>}
      </div>
      <div className="tower-income-date"><span>선택한 시점</span><strong>{selected.year}<small>년</small></strong><span className="tower-income-date-ages">{ageText(selected).split(' · ').map(age => <span key={age}>{age}</span>)}</span></div>
    </div>
    {hidden ? <div className="tower-income-hidden"><LockKeyhole size={22}/><span>금액을 표시하면 연금 그래프를 볼 수 있어요.</span></div> : <div className="tower-income-plot">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${uid}-title ${uid}-desc`}
        onPointerDown={e => { selectYear(pointerYear(e)); if (e.pointerType === 'mouse') e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerMove={e => { if (e.buttons === 1) selectYear(pointerYear(e)); else if (e.pointerType === 'mouse') setHoverYear(pointerYear(e)) }}
        onPointerLeave={() => setHoverYear(null)} onPointerCancel={() => setHoverYear(null)} className="tower-income-svg">
        <title id={`${uid}-title`}>연도별 월 연금 누적 영역 그래프</title>
        <desc id={`${uid}-desc`}>국민연금, 퇴직연금, 개인연금의 월액을 쌓은 그래프입니다. {selected.year}년 월 합계 {selectedTotal.toLocaleString('ko-KR')}원. 세전, 오늘의 돈 기준. 아래 연도 조절기로 각 연도를 확인할 수 있습니다.</desc>
        <defs>
          {incomeLayers.map(layer => <linearGradient key={layer.id} id={`${uid}-fill-${layer.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color(layer.id)} stopOpacity={.8}/><stop offset="100%" stopColor={color(layer.id)} stopOpacity={.3}/>
          </linearGradient>)}
          <linearGradient id={`${uid}-selection`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="var(--cls-long-bond)" stopOpacity={.12}/><stop offset="100%" stopColor="var(--cls-long-bond)" stopOpacity={.02}/></linearGradient>
          <clipPath id={`${uid}-reveal`}><rect x={left} y={top - 3} width={right - left} height={bottom - top + 4} className="tower-income-reveal"/></clipPath>
        </defs>
        <text x={left} y={14} className="tower-income-axis">만 원 / 월</text>
        {[0, 1, 2, 3].map(n => <g key={n}><line x1={left} x2={right} y1={y(n * tickStep)} y2={y(n * tickStep)} className="tower-income-grid" data-baseline={n === 0}/>
          <text x={left - 10} y={y(n * tickStep) + 4} textAnchor="end" className="tower-income-axis">{man(n * tickStep)}</text></g>)}
        <g clipPath={`url(#${uid}-reveal)`}>
          {incomeLayers.map(layer => <g key={layer.id} className="tower-income-layer" data-muted={focusedLayer != null && focusedLayer !== layer.id}>
            <path d={areaFor(layer.id)} fill={`url(#${uid}-fill-${layer.id})`} className="tower-income-area" data-layer={layer.id}/>
            {heights.some(values => values[layer.id] > 0) && <path d={lineFor(layer.id)} stroke={color(layer.id)} className="tower-income-edge"/>}
          </g>)}
        </g>
        {nationalStart != null && nationalStart > first && x(nationalStart) - left >= 115 && width >= 500 && <g className="tower-income-start">
          <line x1={x(nationalStart)} x2={x(nationalStart)} y1={top} y2={bottom}/>
          <text x={x(nationalStart)} y={14} textAnchor="middle">{nationalStart} 국민연금 시작</text>
        </g>}
        {targetRow && <g className="tower-income-target" data-testid="income-chart-target" data-won={target}>
          <line x1={x(targetRow.year)} x2={right} y1={y(target)} y2={y(target)}/>
          <text x={right - 5} y={y(target) - 9} textAnchor="end">목표 생활비 {man(target)}만</text>
        </g>}
        <rect x={Math.max(left, cursorX - 13)} y={top} width={Math.min(26, right - Math.max(left, cursorX - 13))} height={bottom - top} fill={`url(#${uid}-selection)`}/>
        <line x1={cursorX} x2={cursorX} y1={top} y2={bottom} className="tower-income-cursor"/>
        {incomeLayers.filter(layer => (amount(cursor, scope, layer.id) ?? 0) > 0).map(layer => <circle key={layer.id} cx={cursorX} cy={y(cursorValues[layer.id])} r={3.5} fill={color(layer.id)} className="tower-income-dot"/>)}
        <circle cx={cursorX} cy={y(cursorTotal)} r={8} className="tower-income-halo"/><circle cx={cursorX} cy={y(cursorTotal)} r={4} className="tower-income-total-dot"/>
        {tickYears.map(tick => {
          const row = rows.find(row => row.year === tick)!
          const person = scope === 'partner' ? 'partner' : 'me'
          return <g key={tick}><text x={x(tick + .5)} y={bottom + 21} textAnchor={tick === first ? 'start' : tick === last ? 'end' : 'middle'} className="tower-income-axis tower-income-year">{tick}</text>
            <text x={x(tick + .5)} y={bottom + 38} textAnchor={tick === first ? 'start' : tick === last ? 'end' : 'middle'} className="tower-income-axis">{scope === 'together' ? '나 ' : ''}{row.ages[person]}세</text></g>
        })}
      </svg>
      {hovered && width >= 500 && <div className="tower-income-tooltip" role="tooltip" style={{ left: Math.max(8, Math.min(width - 218, cursorX + (cursorX > width * .6 ? -226 : 18))), top: 28 }}>
        <div><strong>{hovered.year}년</strong><span>{ageText(hovered)}</span></div>
        {incomeLayers.map(layer => <p key={layer.id}><span><i style={{ background: color(layer.id) }}/>{layer.name}</span><b>{man(amount(hovered, scope, layer.id) ?? 0)}만 원</b></p>)}
        <footer><span>월 합계</span><strong>{man(amount(hovered, scope) ?? 0)}만 원</strong></footer><small>클릭하면 이 시점으로 선택해요</small>
      </div>}
    </div>}
    <div className="tower-income-navigation">
      <button type="button" aria-label="이전 연도" disabled={year === first} onClick={() => selectYear(year - 1)}><ChevronLeft size={16}/></button>
      <div className="tower-income-slider"><label htmlFor={`${uid}-year`}><span>{first}년</span><span className="tower-income-drag-hint">연도를 움직여 살펴보세요</span><span>{last}년</span></label>
        <input id={`${uid}-year`} type="range" aria-label="살펴보는 연도" min={first} max={last} step={1} value={year} disabled={first === last} style={{ '--income-progress': `${sliderPct}%` } as CSSProperties}
          aria-valuetext={`${year}년, ${ageText(selected)}${hidden ? '' : `, 월 ${man(selectedTotal)}만 원`}`} onChange={e => selectYear(Number(e.target.value))}/>
      </div>
      <button type="button" aria-label="다음 연도" disabled={year === last} onClick={() => selectYear(year + 1)}><ChevronRight size={16}/></button>
    </div>
    <div className="tower-income-legend">{incomeLayers.map(layer => {
      const value = amount(selected, scope, layer.id) ?? 0
      const start = rows.find(row => (amount(row, scope, layer.id) ?? 0) > 0)?.year
      return <button key={layer.id} type="button" aria-label={`${layer.name} 상세 보기`} onClick={() => onLayerSelect(layer.id)}
        onPointerEnter={() => setFocusedLayer(layer.id)} onPointerLeave={() => setFocusedLayer(null)} onFocus={() => setFocusedLayer(layer.id)} onBlur={() => setFocusedLayer(null)}
        className="tower-income-legend-item" style={{ '--income-color': color(layer.id) } as CSSProperties}>
        <span className="tower-income-legend-title"><i/>{layer.name}<ChevronRight size={13}/></span>
        <strong data-testid={`income-chart-layer-${layer.id}`} data-won={hidden ? undefined : value}>{hidden ? '••••••' : <>{man(value)}<small>만 원</small></>}</strong>
        <span className="tower-income-legend-status">{start == null ? '준비 정보 없음' : selected.year < start ? `${start}년부터 수령` : value > 0 ? '수령 중' : '수령 기간 종료'}</span>
      </button>
    })}</div>
    <div className="tower-income-footer"><p>국민연금은 종신 · 그래프 끝은 계산 범위 · 4층 추가연금은 기본 합계에 넣지 않음</p><span><MousePointer2 size={12}/>색을 짚으면 해당 연금이 강조돼요</span></div>
  </div>
}
