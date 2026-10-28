import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/utils'

// 읽기용 엑셀 표 — 요약·리밸런싱 시트. 편집용 표(sheet.tsx)와 같은 격자·선택·수식 입력줄 모양을 쓴다.
// 숫자는 서버가 계산한 값을 그대로 보여 준다. 고칠 수 있는 칸(edit)은 이번 달 납입 같은 입력값뿐.

export type Cell = {
  v?: string | number | null
  fmt?: 'won' | 'pct' | 'pp' | 'signed' | 'text'
  tone?: 'up' | 'down' | 'muted' | 'auto'
  bold?: boolean
  head?: boolean
  section?: boolean
  span?: number
  bar?: { pct: number; color: string }
  edit?: { value: string; onCommit: (v: string) => void; placeholder?: string; label: string }
}

const won = (n: number) => n.toLocaleString('ko-KR')
export function show(c: Cell): string {
  if (c.v === null || c.v === undefined || c.v === '') return ''
  if (typeof c.v === 'string') return c.v
  const n = c.v
  switch (c.fmt) {
    case 'won': return won(n)
    case 'signed': return `${n > 0 ? '+' : ''}${won(n)}`
    case 'pct': return `${n.toFixed(2)}%`
    case 'pp': return `${n > 0 ? '+' : ''}${n.toFixed(1)}%p`
    default: return String(n)
  }
}
const letters = (i: number) => String.fromCharCode(65 + i)

export function ReadGrid({ label, widths, rows }: { label: string; widths: number[]; rows: Cell[][] }) {
  const [sel, setSel] = useState({ r: 0, c: 0 })
  const [draft, setDraft] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const cur = rows[sel.r]?.[sel.c]
  useEffect(() => { if (sel.r >= rows.length) setSel({ r: Math.max(0, rows.length - 1), c: 0 }) }, [rows.length, sel.r])

  function move(dr: number, dc: number) {
    setDraft(null)
    setSel(s => { const r = Math.max(0, Math.min(rows.length - 1, s.r + dr)); return { r, c: Math.max(0, Math.min((rows[r]?.length ?? 1) - 1, s.c + dc)) } })
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    const k = e.key
    if (k === 'ArrowDown' || k === 'Enter') { e.preventDefault(); move(1, 0) }
    else if (k === 'ArrowUp') { e.preventDefault(); move(-1, 0) }
    else if (k === 'ArrowRight' || k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1) }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(0, -1) }
    else if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'c' && cur) navigator.clipboard?.writeText(show(cur)).catch(() => {})
  }
  // 열 위치: span을 따라 칸의 시작 열을 계산
  const colStart = (row: Cell[], ci: number) => row.slice(0, ci).reduce((n, c) => n + (c.span ?? 1), 0)

  return <div className="xl-wrap xl-embedded flex min-h-0 flex-1 flex-col">
    <div className="xl-bar">
      <span className="xl-addr">{letters(cur ? colStart(rows[sel.r], sel.c) : 0)}{sel.r + 1}</span>
      <span className="xl-fx">fx</span>
      <input className="xl-formula" aria-label="선택한 칸 값" readOnly value={cur ? show(cur) : ''}/>
    </div>
    <div className="xl-scroll flex-1">
      <div className="xl-grid" ref={gridRef} tabIndex={0} role="grid" aria-label={label} onKeyDown={onKey}
        style={{ gridTemplateColumns: `40px ${widths.map(w => `${w}px`).join(' ')}` }}>
        <div className="xl-corner"/>
        {widths.map((_, i) => <div key={i} className={cn('xl-colh', cur && colStart(rows[sel.r], sel.c) === i && 'on')}>{letters(i)}</div>)}
        {rows.map((row, ri) => {
          const used = row.reduce((n, c) => n + (c.span ?? 1), 0)
          const cells = used < widths.length ? [...row, { span: widths.length - used } as Cell] : row
          return [
            <div key={`h${ri}`} role="rowheader" className={cn('xl-rowh', sel.r === ri && 'on')}>{ri + 1}</div>,
            ...cells.map((c, ci) => {
              const on = sel.r === ri && sel.c === ci
              const text = show(c)
              const tone = c.tone === 'auto' && typeof c.v === 'number' ? (c.v > 0 ? 'up' : c.v < 0 ? 'down' : '') : c.tone
              const numeric = typeof c.v === 'number' || !!c.edit
              return <div key={`${ri}-${ci}`} role="gridcell" aria-selected={on}
                style={c.span ? { gridColumn: `span ${c.span}` } : undefined}
                className={cn('xl-cell', numeric && 'r', on && 'on', c.head && 'xl-hcell', c.section && 'xl-section', c.bold && 'font-semibold',
                  tone === 'up' && 'up', tone === 'down' && 'down', tone === 'muted' && 'text-grey-600', c.edit && 'xl-input')}
                onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'INPUT') { e.preventDefault(); setSel({ r: ri, c: ci }); gridRef.current?.focus() } }}>
                {c.bar && <span className="xl-databar" style={{ width: `${Math.max(0, Math.min(100, c.bar.pct))}%`, background: c.bar.color }}/>}
                {c.edit
                  ? <input aria-label={c.edit.label} className="xl-edit text-right" inputMode="numeric" placeholder={c.edit.placeholder}
                      value={on && draft !== null ? draft : c.edit.value ? Number(c.edit.value).toLocaleString('ko-KR') : ''}
                      onFocus={() => { setSel({ r: ri, c: ci }); setDraft(c.edit!.value) }}
                      onChange={e => setDraft(e.target.value.replace(/[^\d]/g, ''))}
                      onBlur={() => { if (draft !== null) c.edit!.onCommit(draft); setDraft(null) }}
                      onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); move(1, 0); gridRef.current?.focus() } if (e.key === 'Escape') { setDraft(null); gridRef.current?.focus() } }}/>
                  : <span className="relative">{text}</span>}
              </div>
            }),
          ]
        })}
      </div>
    </div>
  </div>
}
