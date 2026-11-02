import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, Check, ChevronRight, Eye, EyeOff, Info, X } from 'lucide-react'
import { classInfo, compactMoney, money, type Strategy } from './model'

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}><svg width="32" height="32" viewBox="0 0 40 40" fill="currentColor" aria-hidden="true"><circle cx="12" cy="10" r="5"/><circle cx="27" cy="10" r="5"/><path d="M2 32v-5a10 10 0 0 1 20 0v5H2Zm23 0v-5a13 13 0 0 0-4-9 10 10 0 0 1 16 9v5H25Z"/></svg><span>둘이서은퇴<small>RETIRE TOGETHER</small></span></div>
}
export function PanelHeading({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return <div className="panel-heading"><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{children}</div>
}
export function Ring({ value, color = '#42b3aa', children }: { value: number; color?: string; children?: ReactNode }) {
  return <div className="ring" style={{ background: `conic-gradient(${color} ${value}%, #edf0f4 0)` }}><div>{children ?? <strong>{Math.round(value)}<small>%</small></strong>}</div></div>
}
export function StatCard({ title, value, note, percentage, color, hidden, onHide, onClick }: { title: string; value: number; note: string; percentage?: number; color?: string; hidden: boolean; onHide?: () => void; onClick: () => void }) {
  return <section className={`stat-card ${percentage === undefined ? 'total-stat' : ''}`}>
    <div className="stat-top"><h2>{title}</h2>{onHide ? <button className="icon-button" aria-label={hidden ? '금액 표시' : '금액 숨기기'} onClick={onHide}>{hidden ? <EyeOff size={16}/> : <Eye size={16}/>}</button> : <ArrowUpRight size={16} className="muted"/>}</div>
    <button className="stat-body" onClick={onClick} aria-label={`${title} 상세 보기`}><strong className="stat-number">{hidden ? '••••••' : money(value)}</strong>{percentage !== undefined && <Ring value={percentage} color={color}/>}</button>
    <p className="stat-note">{note}</p>
  </section>
}
export function Donut({ items, total, hidden }: { items: { key: string; label: string; color: string; amount: number }[]; total: number; hidden: boolean }) {
  let offset = 0
  const gradient = items.map(item => { const from = offset; offset += item.amount / total * 100; return `${item.color} ${from}% ${offset}%` }).join(',')
  return <div className="donut-layout"><div className="donut" role="img" aria-label={hidden ? '자산 금액 숨김' : `총자산 ${money(total)}, ${items.map(i => `${i.label} ${Math.round(i.amount / total * 100)}%`).join(', ')}`} style={{ background: `conic-gradient(from -90deg, ${gradient})` }}><div><span>총자산</span><strong>{hidden ? '••••' : compactMoney(total)}</strong><small>대출 차감 전</small></div></div><ul className="donut-legend">{items.map(item => <li key={item.key}><span><i style={{ background: item.color }}/>{item.label}</span><b>{Math.round(item.amount / total * 100)}<small>%</small></b><span className="legend-amount">{hidden ? '•••' : compactMoney(item.amount)}</span></li>)}</ul></div>
}
export function StrategyBar({ strategy }: { strategy: Strategy }) {
  const items = Object.entries(strategy.targets)
  if (!items.length) return <div className="empty-strategy"><Info size={18}/><div><strong>비율을 확인하고 있어요</strong><p>출처 확인과 사용자 결정 후 배분을 표시합니다.</p></div></div>
  return <><div className="strategy-bar" role="img" aria-label={items.map(([key, value]) => `${strategy.labels[key] ?? classInfo[key]?.label ?? key} ${value}%`).join(', ')}>{items.map(([key, value]) => <span key={key} style={{ width: `${value}%`, background: classInfo[key]?.color }}><span>{value}<small>%</small></span></span>)}</div><div className="strategy-legend">{items.map(([key]) => <span key={key}><i style={{ background: classInfo[key]?.color }}/>{strategy.labels[key] ?? classInfo[key]?.label ?? key}</span>)}</div></>
}
const income = [{ year: 2026, base: 2800, risk: 2600 }, { year: 2030, base: 3200, risk: 2800 }, { year: 2035, base: 3500, risk: 2900 }, { year: 2040, base: 4000, risk: 3100 }, { year: 2045, base: 4300, risk: 3300 }, { year: 2048, base: 4200, risk: 3200 }, { year: 2050, base: 3100, risk: 2500 }, { year: 2055, base: 3200, risk: 2600 }, { year: 2060, base: 3300, risk: 2700 }]
export function IncomeChart({ large = false, hidden = false }: { large?: boolean; hidden?: boolean }) {
  const [risk, setRisk] = useState(true)
  const [point, setPoint] = useState(5)
  const id = useId().replace(/:/g, '')
  const x = (year: number) => 45 + (year - 2026) / 34 * 500
  const y = (value: number) => 155 - value / 5000 * 135
  const line = (key: 'base' | 'risk') => income.map((p, i) => `${i ? 'L' : 'M'}${x(p.year)},${y(p[key])}`).join(' ')
  return <div className={`income-chart ${large ? 'large-chart' : ''}`}>
    <div className="chart-caption"><span>연 소득 · 만원</span><div><span><i className="dot blue"/>기준 예시</span><button className={`legend-toggle ${risk ? 'on' : ''}`} aria-pressed={risk} onClick={() => setRisk(!risk)}><i className="dot mint"/>감소 예시</button></div></div>
    {hidden ? <div className="chart-hidden"><EyeOff size={24}/><p>금액이 숨겨져 있어요</p></div> : <svg viewBox="0 0 570 190" className="income-svg" role="img" aria-label="2026년부터 2060년까지 소득 곡선 예시. 실제 연금 계산 결과가 아닙니다.">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5985ec" stopOpacity=".18"/><stop offset="1" stopColor="#5985ec" stopOpacity=".015"/></linearGradient></defs>
      {[0, 2000, 4000].map(n => <g key={n}><line x1="45" x2="545" y1={y(n)} y2={y(n)} stroke="#e9edf3" strokeDasharray="3 4"/><text x="32" y={y(n) + 4} textAnchor="end">{n.toLocaleString()}</text></g>)}
      <path d={`${line('base')} L545,155 L45,155 Z`} fill={`url(#${id})`}/><path d={line('base')} fill="none" stroke="#5985ec" strokeWidth="2.5" strokeLinejoin="round"/>
      {risk && <path d={line('risk')} fill="none" stroke="#53b7a8" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round"/>}
      <line x1={x(income[point].year)} x2={x(income[point].year)} y1="18" y2="155" stroke="#b4c0d6" strokeDasharray="4 4"/>
      <circle cx={x(income[point].year)} cy={y(income[point].base)} r="4.5" fill="#5985ec" stroke="white" strokeWidth="2"/>
      {[2026, 2035, 2045, 2055, 2060].map(year => <text key={year} x={x(year)} y="179" textAnchor="middle">{year}</text>)}
      {income.map((p, i) => <rect key={p.year} x={x(p.year) - 14} y="15" width="28" height="143" fill="transparent" onMouseEnter={() => setPoint(i)}><title>{p.year}년 기준 예시 {p.base.toLocaleString()}만원, 감소 예시 {p.risk.toLocaleString()}만원</title></rect>)}
    </svg>}
    <div className="chart-bottom"><label>연도 <select aria-label="소득 예시 연도" value={point} onChange={e => setPoint(Number(e.target.value))}>{income.map((p, i) => <option key={p.year} value={i}>{p.year}년</option>)}</select></label><span>연 <strong>{hidden ? '••••' : income[point].base.toLocaleString()}만원</strong><small> · 고정 예시</small></span></div>
  </div>
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { dialog.close(); document.body.style.overflow = old } }, [])
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={onClose} onClick={event => { if (event.target === ref.current) { const r = ref.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose() } }}><div className="modal-header"><div><span className="eyebrow">RETIRE TOGETHER</span><h2 id={titleId}>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={21}/></button></div><div className="modal-body">{children}</div></dialog>
}
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="text-link" onClick={onClick}>{children}<ChevronRight size={15}/></button> }
export function CheckItem({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: () => void }) {
  return <button className={`check-item ${checked ? 'checked' : ''}`} role="checkbox" aria-checked={checked} onClick={onChange}><span className="check-box">{checked && <Check size={13}/>}</span><span><strong>{label}</strong><small>{detail}</small></span><span className="check-status">{checked ? '완료' : '확인하기'}</span></button>
}
