import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CircleDot, EyeOff } from 'lucide-react'
import { money } from '../model'
import type { TrackEntry } from './types'

export const trackBasis = { asking: '호가', trade: '실거래', manual: '계획 매수가' }
export const trackSigned = (value: number) => value === 0 ? '0원' : `${value > 0 ? '+' : '−'}${money(Math.abs(value))}`
export const orderedTrack = (entries: TrackEntry[]) => [...entries]
  .filter(e => Number.isFinite(Date.parse(e.day)) && [e.gap, e.price, e.home_value].every(Number.isFinite))
  .sort((a, b) => a.day.localeCompare(b.day))

type Props = { entries: TrackEntry[]; basis: TrackEntry['price_basis']; name: string; hidden: boolean; onRecord: () => void }

// Dates are spaced by elapsed time; gaps are server snapshots, never a reconstructed price history.
export function TrackChart({ entries, basis, name, hidden, onRecord }: Props) {
  const [pickedDay, setPickedDay] = useState<string | null>(null)
  const pointRefs = useRef<(SVGGElement | null)[]>([])
  const plotRef = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState(720)
  const titleId = useId(), descriptionId = useId()
  const series = orderedTrack(entries).filter(e => e.price_basis === basis)
  const selectedIndex = Math.max(0, pickedDay && series.some(e => e.day === pickedDay) ? series.findIndex(e => e.day === pickedDay) : series.length - 1)
  const selected = series[selectedIndex], previous = series[selectedIndex - 1]
  const change = previous && selected ? selected.gap - previous.gap : null
  const date = (s: string) => s.replaceAll('-', '.')
  const show = (n: number | null) => hidden ? '••••' : n == null ? '계산 대기' : money(n)
  const hasRecords = series.length > 0
  useLayoutEffect(() => {
    const el = plotRef.current
    if (!el) return
    const measure = () => setChartWidth(Math.max(240, Math.min(720, Math.round(el.getBoundingClientRect().width))))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasRecords])

  function choose(index: number, focus = false) {
    const next = Math.max(0, Math.min(series.length - 1, index))
    setPickedDay(series[next].day)
    if (focus) pointRefs.current[next]?.focus()
  }

  if (!series.length) return <div className="property-hero-chart-empty">
    <CircleDot size={28} aria-hidden="true"/>
    <strong>첫 {trackBasis[basis]} 기록부터 흐름이 시작돼요.</strong>
    <p>확인한 가격과 그날의 우리 집 평가액을 남기면, 격차가 어떻게 바뀌는지 볼 수 있어요.</p>
    <button className="property-move-button" onClick={onRecord}>첫 기록 남기기 <ArrowRight size={14}/></button>
  </div>

  const times = series.map(e => Date.parse(e.day)), first = times[0], last = times.at(-1)!
  const values = series.map(e => e.gap), low = Math.min(...values), high = Math.max(...values)
  const padding = Math.max((high - low) * .2, Math.abs(high) * .04, 1_000_000)
  const min = low - padding, max = high + padding
  const left = 66, right = chartWidth - 20, center = (left + right) / 2
  const x = (time: number) => first === last ? center : left + (time - first) / (last - first) * (right - left)
  const y = (value: number) => 174 - (value - min) / (max - min) * 142
  const ticks = [max, (min + max) / 2, min]
  const axisMoney = (value: number) => {
    const abs = Math.abs(value)
    return `${value < 0 ? '−' : ''}${abs >= 100_000_000 ? `${Number((abs / 100_000_000).toFixed(2))}억` : `${Number((abs / 10_000).toFixed(0)).toLocaleString('ko-KR')}만`}`
  }

  return <div className="property-hero-chart">
    <div className="property-hero-chart-summary">
      <div><span>{date(selected.day)} 기록 · {trackBasis[basis]} 기준</span><strong>{hidden ? '••••' : trackSigned(selected.gap)}</strong></div>
      <p className={!hidden && change != null ? change > 0 ? 'is-wider' : change < 0 ? 'is-closer' : '' : ''}>
        {hidden ? '금액을 숨겼어요' : change == null ? '첫 기록 · 다음 기록부터 변화를 비교해요' : change === 0 ? '직전 같은 기준 기록과 같아요' : `${date(previous.day)}보다 ${money(Math.abs(change))} ${change > 0 ? '벌어졌어요' : '좁혀졌어요'}`}
      </p>
    </div>
    <div className="property-hero-plot" ref={plotRef}>{hidden ? <div className="property-hero-chart-hidden"><EyeOff size={24}/><p>금액을 표시하면 기록 그래프를 볼 수 있어요.</p></div> : <>
      <svg className="property-hero-chart-svg" viewBox={`0 0 ${chartWidth} 216`} width={chartWidth} height="216" role="group" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <title id={titleId}>{name} · {trackBasis[basis]} 기준 집값 격차 기록</title>
        <desc id={descriptionId}>가로축은 기록일, 세로축은 후보 가격에서 우리 집 평가액을 뺀 값입니다. 점을 누르거나 방향키로 기록을 선택하세요. 선은 기록 사이의 연결이며 중간 날짜의 가격이나 예측이 아닙니다.</desc>
        {ticks.map((value, index) => <g key={index} aria-hidden="true"><line x1={left} x2={right} y1={y(value)} y2={y(value)} className="property-hero-grid"/><text x={left - 10} y={y(value) + 4} textAnchor="end">{axisMoney(value)}</text></g>)}
        {min < 0 && max > 0 && <line x1={left} x2={right} y1={y(0)} y2={y(0)} className="property-hero-zero" aria-hidden="true"/>}
        {series.length > 1 && <polyline data-testid="property-history-line" points={series.map((e, i) => `${x(times[i])},${y(e.gap)}`).join(' ')} className="property-hero-history-line" aria-hidden="true"/>}
        <line x1={x(times[selectedIndex])} x2={x(times[selectedIndex])} y1="22" y2="184" className="property-hero-cursor" aria-hidden="true"/>
        {series.map((entry, i) => <g key={entry.day} ref={node => { pointRefs.current[i] = node }} role="button" tabIndex={i === selectedIndex ? 0 : -1}
          className={`property-hero-point${i === selectedIndex ? ' is-selected' : ''}`} aria-pressed={i === selectedIndex}
          aria-label={`${date(entry.day)} ${trackBasis[basis]} 기록, 집값 격차 ${trackSigned(entry.gap)}`}
          onClick={() => choose(i)} onKeyDown={e => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); choose(e.key === 'Home' ? 0 : e.key === 'End' ? series.length - 1 : i + (e.key === 'ArrowLeft' ? -1 : 1), true) }
            else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(i) }
          }}>
          <circle cx={x(times[i])} cy={y(entry.gap)} r="17" fill="transparent"/>
          {i === selectedIndex && <circle cx={x(times[i])} cy={y(entry.gap)} r="10" className="property-hero-point-ring"/>}
          <circle cx={x(times[i])} cy={y(entry.gap)} r={i === selectedIndex ? 5 : 4} className="property-hero-point-dot"/>
        </g>)}
        {first === last ? <text x={center} y="206" textAnchor="middle" aria-hidden="true">{date(series[0].day)}</text> : <>
          <text x={left} y="206" aria-hidden="true">{date(series[0].day)}</text><text x={right} y="206" textAnchor="end" aria-hidden="true">{date(series.at(-1)!.day)}</text>
        </>}
      </svg>
      <div className="property-hero-chart-caption"><span><i/>실제 남긴 기록 {series.length}건 · 점을 눌러 상세 보기</span><span>연결선은 변화 방향만 보여요</span></div>
    </>}</div>
    <div className="property-hero-record" aria-live="polite" aria-atomic="true">
      <div className="property-hero-record-top"><span>선택한 기록의 근거</span><div className="property-hero-record-controls">
        <button type="button" aria-label="이전 기록" disabled={selectedIndex === 0} onClick={() => choose(selectedIndex - 1)}><ArrowLeft size={14}/></button>
        <span>{selectedIndex + 1} / {series.length}</span><button type="button" aria-label="다음 기록" disabled={selectedIndex === series.length - 1} onClick={() => choose(selectedIndex + 1)}><ArrowRight size={14}/></button>
      </div></div>
      <dl><div><dt>후보 가격 · {trackBasis[basis]}</dt><dd>{show(selected.price)}</dd></div><div><dt>당시 우리 집 평가액</dt><dd>{show(selected.home_value)}</dd></div><div><dt>당시 더 필요했던 돈</dt><dd>{show(selected.needed)}</dd></div></dl>
      {previous && !hidden && <p className="property-hero-record-reason">직전 같은 기준 기록 대비 후보 가격 {trackSigned(selected.price - previous.price)} · 우리 집 {trackSigned(selected.home_value - previous.home_value)}</p>}
      <p className="property-hero-record-note">{selected.price_date ? `가격 기준일 ${date(selected.price_date)} · ` : ''}{hidden ? '기록 메모도 함께 숨겼어요.' : selected.note || '남긴 메모가 없어요.'}{!selected.costs_complete && ' · 비용 미입력분 제외'}</p>
    </div>
  </div>
}
