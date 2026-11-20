// 가계부 (HB-01, 2026-11-20 사용자 시안 확정) — 달마다 합계로 적고, 돈이 어디로 갔는지 흐름으로 본다.
// 계산은 서버(tools/household_book.py). 화면은 받은 숫자를 그리기만 한다.
import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '../local-data'
import { manwon, won, pct } from '../lib/format'
import './household.css'

type Who = 'me' | 'partner' | 'joint'
type IncomeLine = { who: Who; kind: '월급' | '상여' | '기타'; label?: string; gross: number | null; net: number }
type Entry = { income: IncomeLine[]; spend: Record<string, number>; big: { name: string; amount: number }[]; saving: Record<string, number> }
type Summary = { income: number; income_by_who: Record<Who, number>; spend: number; spend_groups: Record<string, number>; saving: Record<string, number>; cash: number; kept: number; kept_rate: number | null }
export type Flow = { sources: { id: Who; label: string; amount: number }[]; uses: { id: string; label: string; amount: number; kind: 'spend' | 'saving'; share: number | null }[]; shortfall: number }
type CompareRow = { id: string; group: string; label: string; amount: number; average: number | null; diff: number | null; over: boolean }
type Group = { label: string; items: { id: string; label: string }[] }
type Book = {
  categories: Record<string, Group>; big_label: string; saving: { id: string; label: string }[]
  months: Record<string, Summary>
  next_open: string | null
  year: { recorded: number; total: Summary; average: Record<'income' | 'spend' | 'cash' | 'kept', number | null>; category_average: Record<string, number | null>; category_total: Record<string, number>; group_average: Record<string, number | null>; flow: Flow | null }
  selected: { month: number; recorded: boolean; entry: Entry; version: number; summary: Summary; flow: Flow; compare: CompareRow[]; previous: Summary | null; previous_entry: Entry | null; change: Record<'income' | 'spend' | 'kept', number> | null; spend_vs_average: number | null }
}
type Tab = 'flow' | 'spend' | 'income'

const WHO: Record<Who, string> = { me: '나', partner: '배우자', joint: '함께' }
const USE_COLOR: Record<string, string> = { fixed: 'var(--hb-fixed)', life: 'var(--hb-life)', big: 'var(--hb-big)', principal: 'var(--hb-debt)', pension: 'var(--hb-pension)', cash: 'var(--hb-cash)' }
const today = new Date()

export function HouseholdBook({ hidden }: { hidden: boolean }) {
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState<number | null>(null)
  const [view, setView] = useState<'month' | 'year'>('month')
  const [tab, setTab] = useState<Tab>('flow')
  const [book, setBook] = useState<Book | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [openAfterLoad, setOpenAfterLoad] = useState(false)
  const load = useCallback(() => {
    const c = new AbortController()
    api<Book>(`/household-book?year=${year}${month ? `&month=${month}` : ''}`, 'GET', undefined, c.signal)
      .then(b => { setBook(b); setError(''); if (month === null) setMonth(b.selected.month); if (openAfterLoad && !b.selected.recorded) setEditing(true); setOpenAfterLoad(false) })
      .catch(e => { if (!c.signal.aborted) setError(e.message) })
    return () => c.abort()
  }, [year, month]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load])

  const m = book?.selected.month ?? month ?? today.getMonth() + 1
  const atLatest = year === today.getFullYear() && m === today.getMonth() + 1
  const step = (d: number) => {
    setEditing(false)
    if (view === 'year') { setYear(year + d); setMonth(12); return }
    const n = m + d
    if (n < 1) { setYear(year - 1); setMonth(12) } else if (n > 12) { setYear(year + 1); setMonth(1) } else setMonth(n)
  }
  const nextDisabled = view === 'year' ? year >= today.getFullYear() : atLatest
  const h = { hidden }

  return <div className="hb">
    <div className="hb-toolbar">
      <h1>가계부</h1>
      <div className="hb-seg" role="group" aria-label="기간 단위">
        {(['month', 'year'] as const).map(v => <button key={v} aria-pressed={view === v} onClick={() => { setView(v); setEditing(false) }}>{v === 'month' ? '월별' : '연별'}</button>)}
      </div>
      <div className="hb-step">
        <Button variant="outline" size="icon-sm" aria-label={view === 'month' ? '이전 달' : '이전 해'} onClick={() => step(-1)}><ChevronLeft/></Button>
        <span>{view === 'month' ? `${year}년 ${m}월` : `${year}년`}</span>
        <Button variant="outline" size="icon-sm" aria-label={view === 'month' ? '다음 달' : '다음 해'} disabled={nextDisabled} onClick={() => step(1)}><ChevronRight/></Button>
      </div>
      {!editing && <div className="hb-actions">
        {view === 'month' && book?.selected.recorded && <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="size-3.5"/>{m}월 고치기</Button>}
        {book?.next_open && <Button size="sm" onClick={() => { const [ny, nm] = book.next_open!.split('-').map(Number); setView('month'); setOpenAfterLoad(true); setYear(ny); setMonth(nm) }}><Plus className="size-3.5"/>{Number(book.next_open.slice(5))}월 적기</Button>}
      </div>}
    </div>

    {error && <p className="hb-error" role="alert">{error}</p>}
    {!book && !error && <p className="hb-muted">불러오는 중…</p>}
    {book && (editing
      ? <MonthForm book={book} year={year} month={m} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); load() }}/>
      : view === 'month' && !book.selected.recorded
        ? <div className="hb-empty"><p>아직 {m}월 가계부를 적지 않았어요.</p><Button onClick={() => setEditing(true)}><Plus className="size-3.5"/>{m}월 가계부 적기</Button></div>
        : view === 'year' && book.year.recorded === 0
          ? <div className="hb-empty"><p>{year}년에 적은 달이 없어요.</p></div>
          : <>
            <Totals book={book} view={view} h={h}/>
            <div className="hb-tabs" role="tablist">
              {([['flow', '돈의 흐름'], ['spend', '지출'], ['income', '수입']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
            </div>
            {tab === 'flow' && <FlowTab book={book} view={view} year={year} h={h}/>}
            {tab === 'spend' && <SpendTab book={book} view={view} h={h}/>}
            {tab === 'income' && <IncomeTab book={book} view={view} h={h}/>}
          </>)}
    <p className="hb-foot">한 달에 한 번 카드 명세서·통장·급여명세서 합계를 옮겨 적어요. 합계·평균·흐름은 앱이 계산해요.</p>
  </div>
}

function Totals({ book, view, h }: { book: Book; view: 'month' | 'year'; h: { hidden: boolean } }) {
  const s = view === 'month' ? book.selected.summary : book.year.total
  const c = view === 'month' ? book.selected.change : null
  return <dl className="hb-totals">
    <div><dt>{view === 'month' ? '이번 달 수입' : `${book.year.recorded}개월 수입`}</dt><dd>{manwon(s.income, h)}</dd>{c && <small>지난달 {won(c.income, { ...h, signed: true })}</small>}</div>
    <div><dt>쓴 돈</dt><dd>{manwon(s.spend, h)}</dd>{c && <small>지난달 {won(c.spend, { ...h, signed: true })}</small>}</div>
    <div><dt>모으고 갚은 돈</dt><dd className={s.kept < 0 ? 'hb-short' : 'hb-kept'}>{manwon(s.kept, h)}</dd>{s.kept_rate !== null && <small>수입의 {pct(s.kept_rate, { signed: false, digits: 1 })}</small>}</div>
  </dl>
}

/* 돈의 흐름: 왼쪽 수입원 → 가운데 우리 집 수입 → 오른쪽 쓰임 */
export function Sankey({ flow, income, h }: { flow: Flow; income: number; h: { hidden: boolean } }) {
  const W = 760, top = 18, nw = 12, x0 = 130, x1 = 330, x2 = 530, gapL = 16, gapR = 12
  const H = Math.max(260, 60 + flow.uses.length * 42)
  const total = income || 1
  const scale = Math.max(total, flow.uses.reduce((a, u) => a + u.amount, 0))
  const k = (H - top * 2 - gapR * (flow.uses.length - 1)) / scale
  const midTop = top + (H - top * 2 - total * k) / 2
  const band = (xa: number, ya: number, yb: number, xb: number, yc: number, yd: number) => { const xm = (xa + xb) / 2; return `M${xa},${ya} C${xm},${ya} ${xm},${yc} ${xb},${yc} L${xb},${yd} C${xm},${yd} ${xm},${yb} ${xa},${yb} Z` }
  let y = top + (H - top * 2 - (total * k + gapL * (flow.sources.length - 1))) / 2, mi = midTop, ry = top, mo = midTop
  return <svg className="hb-sankey" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="수입이 쓴 돈과 모은 돈으로 나뉘는 흐름">
    {flow.sources.map(s => { const hh = s.amount * k, el = <g key={s.id}>
      <path d={band(x0 + nw, y, y + hh, x1, mi, mi + hh)} fill="var(--hb-income)" opacity=".22"/>
      <rect x={x0} y={y} width={nw} height={hh} fill="var(--hb-income)" rx="2"/>
      <text x={x0 - 10} y={y + hh / 2 - 2} textAnchor="end">{s.label}</text>
      <text x={x0 - 10} y={y + hh / 2 + 16} textAnchor="end" className="hb-strong">{manwon(s.amount, h)}</text>
    </g>; y += hh + gapL; mi += hh; return el })}
    <rect x={x1} y={midTop} width={nw} height={total * k} fill="var(--foreground)" rx="2"/>
    <text x={x1 + nw / 2} y={midTop - 6} textAnchor="middle" className="hb-sub">우리 집 수입 {manwon(income, h)}</text>
    {flow.uses.map(u => { const hh = u.amount * k, color = USE_COLOR[u.id] ?? 'var(--hb-life)', cy = ry + hh / 2 + 5
      const el = <g key={u.id}>
        <path d={band(x1 + nw, mo, mo + hh, x2, ry, ry + hh)} fill={color} opacity=".35"/>
        <rect x={x2} y={ry} width={nw} height={hh} fill={color} rx="2"/>
        <text x={x2 + 20} y={cy}>{u.label} <tspan className="hb-strong">{manwon(u.amount, h)}</tspan> <tspan className="hb-sub">{u.share !== null ? pct(u.share, { signed: false, digits: 0 }) : ''}</tspan></text>
      </g>; ry += hh + gapR; mo += hh; return el })}
  </svg>
}

/* 좁은 화면: 흐름 그림 대신 쓰임 목록 (막대 길이 = 수입 대비 비율) */
export function UseList({ flow, h }: { flow: Flow; h: { hidden: boolean } }) {
  return <ul className="hb-uses" aria-label="수입의 쓰임">
    {flow.uses.map(u => <li key={u.id}>
      <span className="hb-uses-label"><i style={{ background: USE_COLOR[u.id] }}/>{u.label}</span>
      <span className="hb-uses-amount">{manwon(u.amount, h)} <small>{u.share !== null ? pct(u.share, { signed: false, digits: 0 }) : ''}</small></span>
      <span className="hb-uses-bar" aria-hidden="true"><b style={{ width: `${Math.min(u.share ?? 0, 100)}%`, background: USE_COLOR[u.id] }}/></span>
    </li>)}
  </ul>
}

function FlowTab({ book, view, year, h }: { book: Book; view: 'month' | 'year'; year: number; h: { hidden: boolean } }) {
  const s = view === 'month' ? book.selected.summary : book.year.total
  const flow = view === 'month' ? book.selected.flow : book.year.flow!
  const vs = book.selected.spend_vs_average
  return <>
    <section className="hb-panel">
      <div className="hb-panel-head"><h2>돈이 어디로 갔나</h2><span>{view === 'month' ? `${book.selected.month}월` : `${year}년 · ${book.year.recorded}개월`}</span></div>
      {s.income > 0 ? <><div className="hb-scroll hb-wide"><Sankey flow={flow} income={s.income} h={h}/></div><UseList flow={flow} h={h}/></> : <p className="hb-muted hb-pad">수입을 적으면 흐름이 보여요.</p>}
      <p className="hb-sentence">
        {flow.shortfall > 0 ? <>들어온 돈보다 <b>{manwon(flow.shortfall, h)}</b> 더 나가서 모아 둔 돈에서 꺼냈어요.</>
          : view === 'month' && vs !== null && book.year.recorded > 1 ? <>쓴 돈이 올해 월평균보다 <b>{manwon(Math.abs(vs), h)}</b> {vs > 0 ? '많아요' : vs < 0 ? '적어요' : '같아요'}.</>
          : view === 'year' ? <>한 달에 평균 <b>{manwon(book.year.average.spend, h)}</b>을 썼어요.</> : null}
      </p>
    </section>
    {view === 'year' && <YearBars book={book} h={h}/>}
  </>
}

function YearBars({ book, h }: { book: Book; h: { hidden: boolean } }) {
  const W = 760, H = 220, P = { l: 72, r: 10, t: 12, b: 26 }, iw = W - P.l - P.r, ih = H - P.t - P.b
  const rows = Array.from({ length: 12 }, (_, i) => book.months[String(i + 1)] ?? null)
  const peak = Math.max(1, ...rows.map(r => r ? Math.max(r.income, r.spend + Object.values(r.saving).reduce((a, b) => a + b, 0)) : 0))
  const raw = peak / 4, mag = 10 ** Math.floor(Math.log10(raw))
  const unit = [1, 2, 5, 10].map(x => x * mag).find(x => x >= raw) ?? raw
  const max = Math.ceil(peak / unit) * unit
  const sy = (v: number) => P.t + ih - (v / max) * ih, bw = iw / 12
  const ticks = Array.from({ length: Math.round(max / unit) + 1 }, (_, i) => i * unit)
  const parts = (r: Summary) => [['fixed', r.spend_groups.fixed], ['life', r.spend_groups.life], ['big', r.spend_groups.big], ['principal', r.saving.principal ?? 0], ['pension', r.saving.pension ?? 0], ['cash', Math.max(r.cash, 0)]] as const
  const labels: Record<string, string> = { fixed: '고정비', life: '생활비', big: book.big_label, principal: '대출 원금', pension: '연금 납입', cash: '현금 주머니' }
  return <section className="hb-panel">
    <div className="hb-panel-head"><h2>달마다 어떻게 나뉘었나</h2><span>막대 높이 = 그달 수입</span></div>
    <div className="hb-scroll"><svg className="hb-bars" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="월별 수입의 쓰임">
      {ticks.map(t => <g key={t}><line x1={P.l} x2={W - P.r} y1={sy(t)} y2={sy(t)} stroke="var(--border)"/><text x={P.l - 6} y={sy(t) + 4} textAnchor="end" className="hb-sub">{hidden(h) ? '' : manwon(t)}</text></g>)}
      {rows.map((r, i) => { const cx = P.l + i * bw + bw / 2, w = bw * 0.56; let acc = 0
        return <g key={i}><text x={cx} y={H - 7} textAnchor="middle" className="hb-sub">{i + 1}월</text>
          {r && parts(r).map(([id, v]) => { if (!v) return null; const el = <rect key={id} x={cx - w / 2} y={sy(acc + v)} width={w} height={sy(acc) - sy(acc + v)} fill={USE_COLOR[id]}><title>{`${i + 1}월 ${labels[id]} ${manwon(v, h)}`}</title></rect>; acc += v; return el })}
        </g> })}
    </svg></div>
    <ul className="hb-legend">{Object.entries(labels).map(([id, l]) => <li key={id}><i style={{ background: USE_COLOR[id] }}/>{l}</li>)}</ul>
  </section>
}
const hidden = (h: { hidden: boolean }) => h.hidden

function SpendTab({ book, view, h }: { book: Book; view: 'month' | 'year'; h: { hidden: boolean } }) {
  const sel = book.selected, y = book.year
  const rows = view === 'month' ? sel.compare : sel.compare.map(r => ({ ...r, amount: y.category_total[r.id] ?? 0 }))
  const groupValue = (g: string) => view === 'month' ? sel.summary.spend_groups[g] : y.total.spend_groups[g]
  return <section className="hb-panel">
    <div className="hb-panel-head"><h2>어디에 썼나</h2><span>{view === 'month' ? '검은 눈금 = 올해 월평균 · 단위 원' : '단위 원'}</span></div>
    <div className="hb-scroll"><table className="hb-table">
      <thead><tr><th>항목</th><th>{view === 'month' ? `${sel.month}월` : '올해 합계'}</th><th>올해 월평균</th>{view === 'month' && <th>평균 대비</th>}</tr></thead>
      <tbody>
        {Object.entries(book.categories).map(([g, group]) => <GroupRows key={g} label={group.label} value={groupValue(g)} avg={y.group_average[g]} month={view === 'month'} h={h}>
          {rows.filter(r => r.group === g && (r.amount > 0 || (r.average ?? 0) > 0)).map(r => <tr key={r.id}>
            <td>{r.label}</td><td>{won(r.amount, { ...h, unit: false })}</td><td>{won(r.average, { ...h, unit: false })}</td>
            {view === 'month' && <td className={r.over ? 'hb-over' : ''}>{won(r.diff, { ...h, unit: false, signed: true })}<Meter value={r.amount} avg={r.average}/></td>}
          </tr>)}
        </GroupRows>)}
        <GroupRows label={book.big_label} value={groupValue('big')} avg={y.group_average.big} month={view === 'month'} h={h}>
          {(view === 'month' ? sel.entry.big.map(b => ({ ...b, m: 0 })) : []).map((b, i) => <tr key={i}><td>{b.name}</td><td>{won(b.amount, { ...h, unit: false })}</td><td/>{view === 'month' && <td/>}</tr>)}
        </GroupRows>
        <tr className="hb-total"><td>쓴 돈 합계</td><td>{won(view === 'month' ? sel.summary.spend : y.total.spend, { ...h, unit: false })}</td><td>{won(y.average.spend, { ...h, unit: false })}</td>{view === 'month' && <td/>}</tr>
      </tbody>
    </table></div>
  </section>
}

function GroupRows({ label, value, avg, month, h, children }: { label: string; value: number; avg: number | null; month: boolean; h: { hidden: boolean }; children: React.ReactNode }) {
  return <><tr className="hb-group"><td>{label}</td><td>{won(value, { ...h, unit: false })}</td><td>{won(avg, { ...h, unit: false })}</td>{month && <td/>}</tr>{children}</>
}

function Meter({ value, avg }: { value: number; avg: number | null }) {
  if (avg === null) return null
  const max = Math.max(value, avg) * 1.25 || 1
  return <span className="hb-meter" aria-hidden="true"><i style={{ width: `${(value / max) * 100}%` }}/><s style={{ left: `${(avg / max) * 100}%` }}/></span>
}

function IncomeTab({ book, view, h }: { book: Book; view: 'month' | 'year'; h: { hidden: boolean } }) {
  const by = view === 'month' ? book.selected.summary.income_by_who : book.year.total.income_by_who
  return <>
    <dl className="hb-totals">
      {(Object.keys(WHO) as Who[]).map(w => <div key={w}><dt>{w === 'joint' ? '기타 (배당·이자)' : `${WHO[w]} 실수령`}</dt><dd>{manwon(by[w], h)}</dd></div>)}
    </dl>
    <section className="hb-panel">
      <div className="hb-panel-head"><h2>{view === 'month' ? '받은 돈' : '달마다 받은 돈'}</h2><span>단위 원</span></div>
      <div className="hb-scroll">{view === 'month'
        ? <table className="hb-table"><thead><tr><th>누구</th><th className="hb-left">종류</th><th>지급액</th><th>실수령</th></tr></thead>
            <tbody>{book.selected.entry.income.map((l, i) => <tr key={i}><td>{WHO[l.who]}</td><td className="hb-left">{l.kind}{l.label ? ` · ${l.label}` : ''}</td><td>{won(l.gross, { ...h, unit: false })}</td><td className="hb-strong">{won(l.net, { ...h, unit: false })}</td></tr>)}</tbody></table>
        : <table className="hb-table"><thead><tr><th>월</th><th>나</th><th>배우자</th><th>기타</th><th>합계</th></tr></thead>
            <tbody>{Object.entries(book.months).map(([mo, s]) => <tr key={mo}><td>{mo}월</td><td>{won(s.income_by_who.me, { ...h, unit: false })}</td><td>{won(s.income_by_who.partner, { ...h, unit: false })}</td><td>{won(s.income_by_who.joint, { ...h, unit: false })}</td><td className="hb-strong">{won(s.income, { ...h, unit: false })}</td></tr>)}
              <tr className="hb-total"><td>합계</td><td>{won(by.me, { ...h, unit: false })}</td><td>{won(by.partner, { ...h, unit: false })}</td><td>{won(by.joint, { ...h, unit: false })}</td><td>{won(book.year.total.income, { ...h, unit: false })}</td></tr></tbody></table>}
      </div>
    </section>
  </>
}

/* 한 달 적기: 지난달 값을 미리 채워 바뀐 칸만 고치게 한다 (큰 지출은 비워 둔다) */
function MonthForm({ book, year, month, onCancel, onSaved }: { book: Book; year: number; month: number; onCancel: () => void; onSaved: () => void }) {
  const sel = book.selected
  const start: Entry = sel.recorded ? sel.entry : sel.previous_entry ? { ...sel.previous_entry, big: [] } : { income: [{ who: 'me', kind: '월급', gross: null, net: 0 }, { who: 'partner', kind: '월급', gross: null, net: 0 }], spend: {}, big: [], saving: {} }
  const [e, setE] = useState<Entry>(structuredClone(start))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const num = (v: string) => { const n = Number(v.replace(/[^\d]/g, '')); return Number.isFinite(n) ? n : 0 }
  const show = (n: number | null | undefined) => n ? n.toLocaleString('ko-KR') : ''
  const setIncome = (i: number, patch: Partial<IncomeLine>) => setE({ ...e, income: e.income.map((l, j) => j === i ? { ...l, ...patch } : l) })
  async function save() {
    setSaving(true); setErr('')
    const body = { ...e, spend: Object.fromEntries(Object.entries(e.spend).filter(([, v]) => v > 0)), big: e.big.filter(b => b.name.trim() && b.amount > 0), income: e.income.filter(l => l.net > 0), version: sel.version }
    try { await api(`/household-book/${year}-${String(month).padStart(2, '0')}`, 'PUT', body); onSaved() } catch (x) { setErr((x as Error).message) } finally { setSaving(false) }
  }
  const money = (id: string, label: string, value: number | null | undefined, set: (n: number) => void) =>
    <label className="hb-field" htmlFor={id}><span>{label}</span><input id={id} inputMode="numeric" value={show(value)} placeholder="0" onChange={ev => set(num(ev.target.value))}/></label>
  return <form className="hb-form" onSubmit={ev => { ev.preventDefault(); save() }}>
    <div className="hb-form-head"><h2>{year}년 {month}월 적기</h2>{!sel.recorded && sel.previous_entry && <span>지난달 값을 미리 채웠어요. 바뀐 칸만 고쳐 주세요.</span>}</div>
    <fieldset><legend>수입 <small>실수령 기준 · 원</small></legend>
      {e.income.map((l, i) => <div className="hb-income-row" key={i}>
        <select aria-label="누구" value={l.who} onChange={ev => setIncome(i, { who: ev.target.value as Who })}>{(Object.keys(WHO) as Who[]).map(w => <option key={w} value={w}>{WHO[w]}</option>)}</select>
        <select aria-label="종류" value={l.kind} onChange={ev => setIncome(i, { kind: ev.target.value as IncomeLine['kind'] })}>{['월급', '상여', '기타'].map(k => <option key={k}>{k}</option>)}</select>
        {money(`hb-gross-${i}`, '지급액', l.gross, n => setIncome(i, { gross: n || null }))}
        {money(`hb-net-${i}`, '실수령', l.net, n => setIncome(i, { net: n }))}
        <Button type="button" variant="ghost" size="icon-sm" aria-label="이 줄 지우기" onClick={() => setE({ ...e, income: e.income.filter((_, j) => j !== i) })}><X/></Button>
      </div>)}
      <Button type="button" variant="ghost" size="sm" onClick={() => setE({ ...e, income: [...e.income, { who: 'me', kind: '상여', gross: null, net: 0 }] })}><Plus className="size-3.5"/>수입 줄 더하기</Button>
    </fieldset>
    {Object.entries(book.categories).map(([g, group]) => <fieldset key={g}><legend>{group.label} <small>원</small></legend>
      <div className="hb-grid">{group.items.map(it => <div key={it.id}>{money(`hb-${it.id}`, it.label, e.spend[it.id], n => setE({ ...e, spend: { ...e.spend, [it.id]: n } }))}</div>)}</div>
    </fieldset>)}
    <fieldset><legend>{book.big_label} <small>여행·수리·명절처럼 이번 달에만 · 원</small></legend>
      {e.big.map((b, i) => <div className="hb-big-row" key={i}>
        <label className="hb-field" htmlFor={`hb-big-name-${i}`}><span>이름</span><input id={`hb-big-name-${i}`} value={b.name} maxLength={40} onChange={ev => setE({ ...e, big: e.big.map((x, j) => j === i ? { ...x, name: ev.target.value } : x) })}/></label>
        {money(`hb-big-${i}`, '금액', b.amount, n => setE({ ...e, big: e.big.map((x, j) => j === i ? { ...x, amount: n } : x) }))}
        <Button type="button" variant="ghost" size="icon-sm" aria-label="이 줄 지우기" onClick={() => setE({ ...e, big: e.big.filter((_, j) => j !== i) })}><X/></Button>
      </div>)}
      <Button type="button" variant="ghost" size="sm" onClick={() => setE({ ...e, big: [...e.big, { name: '', amount: 0 }] })}><Plus className="size-3.5"/>큰 지출 더하기</Button>
    </fieldset>
    <fieldset><legend>모으고 갚은 돈 <small>나머지는 현금 주머니로 계산해요 · 원</small></legend>
      <div className="hb-grid">{book.saving.map(s => <div key={s.id}>{money(`hb-${s.id}`, s.label, e.saving[s.id], n => setE({ ...e, saving: { ...e.saving, [s.id]: n } }))}</div>)}</div>
    </fieldset>
    {err && <p className="hb-error" role="alert">{err}</p>}
    <div className="hb-form-actions"><Button type="button" variant="outline" onClick={onCancel}>닫기</Button><Button type="submit" disabled={saving} aria-busy={saving}>{saving ? '저장 중…' : '저장'}</Button></div>
  </form>
}
