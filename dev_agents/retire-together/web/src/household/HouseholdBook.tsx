// 가계부 (HB-01 → HB-02, 2026-11-20 사용자 시안 확정) — 위에는 고른 달의 돈의 흐름, 아래는 1년 표.
// 표 칸을 눌러 바로 고치고, '매달 고정' 칸은 새 달에 미리 채워지고, 카드·은행 캡처는 분류해서 더한다.
// 계산·분류는 서버(tools/household_book.py). 화면은 받은 숫자를 그리기만 한다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ImageUp, Pin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '../local-data'
import { apiFetch } from '../auth/session'
import { manwon, pct, MASK, MINUS } from '../lib/format'
import './household.css'

type Who = 'me' | 'partner' | 'joint'
type Summary = { income: number; income_by_who: Record<Who, number>; spend: number; spend_groups: Record<string, number>; saving: Record<string, number>; cash: number; kept: number; kept_rate: number | null }
export type Flow = { sources: { id: Who; label: string; amount: number }[]; uses: { id: string; label: string; amount: number; kind: 'spend' | 'saving'; share: number | null }[]; shortfall: number }
type Row = { key: string; label: string; kind: 'group' | 'item' | 'group-item' | 'total'; fixed?: boolean; values: Record<string, number>; average: number | null; auto?: number[]; locked?: number[] }
type Group = { label: string; items: { id: string; label: string }[] }
type Book = {
  categories: Record<string, Group>; big_label: string
  next_open: string | null
  table: { months: number[]; preview: number | null; versions: Record<string, number>; rows: Row[] }
  fixed: { month: string | null; version: number; keys: string[]; amounts: Record<string, number>; suggest: string[] }
  selected: { month: number; recorded: boolean; preview: boolean; version: number; summary: Summary; flow: Flow; change: Record<'income' | 'spend' | 'kept', number> | null; spend_vs_average: number | null }
}
type Tx = { date: string; merchant: string; amount: number; category: string | null; how: 'learned' | 'rule' | null; in_month: boolean; duplicate: boolean }

const USE_COLOR: Record<string, string> = { fixed: 'var(--hb-fixed)', life: 'var(--hb-life)', big: 'var(--hb-big)', principal: 'var(--hb-debt)', pension: 'var(--hb-pension)', cash: 'var(--hb-cash)' }
const today = new Date()
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`
/** 표 칸: 만원 단위. 1만원 아래는 소수 한 자리 */
const cell = (v: number | undefined, hidden: boolean) => v === undefined ? '' : hidden ? MASK : v === 0 ? '–'
  : `${v < 0 ? MINUS : ''}${Math.abs(v) < 100_000 ? (Math.abs(v) / 10_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : Math.round(Math.abs(v) / 10_000).toLocaleString('ko-KR')}`

export function HouseholdBook({ hidden }: { hidden: boolean }) {
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState<number | null>(null)
  const [book, setBook] = useState<Book | null>(null)
  const [error, setError] = useState('')
  const [panel, setPanel] = useState<'fixed' | 'capture' | null>(null)
  const load = useCallback(() => {
    const c = new AbortController()
    api<Book>(`/household-book?year=${year}${month ? `&month=${month}` : ''}`, 'GET', undefined, c.signal)
      .then(b => { setBook(b); setError(''); if (month === null) setMonth(b.selected.month) })
      .catch(e => { if (!c.signal.aborted) setError(e.message) })
    return () => c.abort()
  }, [year, month])
  useEffect(load, [load])
  const m = book?.selected.month ?? month ?? today.getMonth() + 1
  const h = { hidden }
  const lastMonth = year < today.getFullYear() ? 12 : year === today.getFullYear() ? today.getMonth() + 1 : 0

  return <div className="hb">
    <div className="hb-toolbar">
      <h1>가계부</h1>
      <div className="hb-step">
        <Button variant="outline" size="icon-sm" aria-label="이전 해" onClick={() => { setYear(year - 1); setMonth(12); setPanel(null) }}><ChevronLeft/></Button>
        <span>{year}년</span>
        <Button variant="outline" size="icon-sm" aria-label="다음 해" disabled={year >= today.getFullYear()} onClick={() => { setYear(year + 1); setMonth(null); setPanel(null) }}><ChevronRight/></Button>
      </div>
      <div className="hb-actions">
        <Button variant="outline" size="sm" aria-pressed={panel === 'fixed'} onClick={() => setPanel(panel === 'fixed' ? null : 'fixed')}><Pin className="size-3.5"/>매달 고정 항목</Button>
        {lastMonth > 0 && <Button size="sm" aria-pressed={panel === 'capture'} onClick={() => setPanel(panel === 'capture' ? null : 'capture')}><ImageUp className="size-3.5"/>{m}월 캡처 올리기</Button>}
      </div>
    </div>

    {error && <p className="hb-error" role="alert">{error}</p>}
    {!book && !error && <p className="hb-muted">불러오는 중…</p>}
    {book && <>
      {panel === 'fixed' && <FixedPanel book={book} h={h} onClose={() => setPanel(null)} onSaved={load}/>}
      {panel === 'capture' && <CapturePanel book={book} month={ym(year, m)} label={`${m}월`} categories={book.categories} bigLabel={book.big_label} onClose={() => setPanel(null)} onSaved={() => { setPanel(null); load() }}/>}
      <Totals book={book} h={h}/>
      <section className="hb-panel">
        <div className="hb-panel-head"><h2>{m}월 돈의 흐름</h2>{book.selected.preview && <span>매달 고정 항목으로 미리 채운 달이에요</span>}</div>
        {book.selected.summary.income > 0
          ? <><div className="hb-scroll hb-wide"><Sankey flow={book.selected.flow} income={book.selected.summary.income} h={h}/></div><UseList flow={book.selected.flow} h={h}/></>
          : <p className="hb-muted hb-pad">아래 표에 {m}월 수입을 적으면 흐름이 보여요.</p>}
        <p className="hb-sentence">
          {book.selected.flow.shortfall > 0 ? <>들어온 돈보다 <b>{manwon(book.selected.flow.shortfall, h)}</b> 더 나가서 모아 둔 돈에서 꺼냈어요.</>
            : book.selected.spend_vs_average !== null && book.table.months.length > 1 ? <>쓴 돈이 올해 월평균보다 <b>{manwon(Math.abs(book.selected.spend_vs_average), h)}</b> {book.selected.spend_vs_average > 0 ? '많아요' : book.selected.spend_vs_average < 0 ? '적어요' : '같아요'}.</> : null}
        </p>
      </section>
      <YearTable book={book} year={year} month={m} lastMonth={lastMonth} hidden={hidden} onPick={setMonth} onSaved={load} onError={setError}/>
      <p className="hb-foot">칸을 눌러 원 단위로 고쳐요. 회색 숫자는 '매달 고정'으로 미리 채운 값이에요. 합계·평균·흐름은 앱이 계산해요.</p>
    </>}
  </div>
}

function Totals({ book, h }: { book: Book; h: { hidden: boolean } }) {
  const s = book.selected.summary, c = book.selected.change, m = book.selected.month
  const diff = (n: number) => `지난달보다 ${n > 0 ? '+' : n < 0 ? MINUS : ''}${manwon(Math.abs(n), h)}`
  return <dl className="hb-totals">
    <div><dt>{m}월 수입</dt><dd>{manwon(s.income, h)}</dd>{c && <small>{diff(c.income)}</small>}</div>
    <div><dt>쓴 돈</dt><dd>{manwon(s.spend, h)}</dd>{c && <small>{diff(c.spend)}</small>}</div>
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

function YearTable({ book, year, month, lastMonth, hidden, onPick, onSaved, onError }: { book: Book; year: number; month: number; lastMonth: number; hidden: boolean; onPick: (m: number) => void; onSaved: () => void; onError: (e: string) => void }) {
  // 최근 6달 + 그보다 앞서 적은 달. 1월부터 다 보이면 빈 칸이 너무 많다
  const end = Math.max(lastMonth, ...book.table.months, 0), start = Math.min(Math.max(1, end - 5), ...book.table.months)
  const cols = Array.from({ length: Math.max(end - start + 1, 0) }, (_, i) => start + i)
  const [edit, setEdit] = useState<{ key: string; m: number } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth }, [year])
  async function save(key: string, m: number, raw: string) {
    setEdit(null)
    const value = Number(raw.replace(/[^\d]/g, '') || 0)
    const row = book.table.rows.find(r => r.key === key)
    if (row && row.values[m] === value && !row.auto?.includes(m)) return
    try { await api(`/household-book/${ym(year, m)}/cell`, 'PUT', { key, value, version: book.table.versions[m] ?? 0 }); onSaved() } catch (e) { onError((e as Error).message) }
  }
  return <section className="hb-panel">
    <div className="hb-panel-head"><h2>{year}년 가계부</h2><span>단위 만원 · 달 이름을 누르면 위 흐름이 그 달로 바뀌어요</span></div>
    <div className="hb-scroll hb-sheet-wrap" ref={scroller}><table className="hb-sheet">
      <thead><tr><th scope="col">항목</th>
        {cols.map(c => <th key={c} scope="col" className={c === month ? 'hb-now' : ''}><button onClick={() => onPick(c)} aria-pressed={c === month}>{c}월</button></th>)}
        <th scope="col">월평균</th></tr></thead>
      <tbody>{book.table.rows.map(r => <tr key={r.key} className={`hb-${r.kind}`}>
        <th scope="row">{r.label}{r.fixed && <span className="hb-fix" title="매달 같은 금액으로 미리 채워요">매달</span>}</th>
        {cols.map(c => {
          const v = r.values[c], now = c === month ? ' hb-now' : ''
          const canEdit = (r.kind === 'item' || r.kind === 'group-item') && c <= lastMonth && !r.locked?.includes(c)
          if (!canEdit) return <td key={c} className={`${now}${v !== undefined && v < 0 ? ' hb-short' : ''}`} title={r.locked?.includes(c) ? '여러 줄이 합쳐진 칸이에요' : undefined}>{cell(v, hidden)}</td>
          if (edit?.key === r.key && edit.m === c) return <td key={c} className={`hb-editing${now}`}>
            <input autoFocus inputMode="numeric" aria-label={`${c}월 ${r.label}`} defaultValue={v ? v.toLocaleString('ko-KR') : ''}
              onBlur={e => save(r.key, c, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEdit(null) }}/></td>
          return <td key={c} className={`hb-cell${now}${r.auto?.includes(c) ? ' hb-auto' : ''}`}>
            <button aria-label={`${c}월 ${r.label} 고치기`} onClick={() => setEdit({ key: r.key, m: c })}>{cell(v, hidden)}</button></td>
        })}
        <td className="hb-avg">{cell(r.average ?? undefined, hidden)}</td>
      </tr>)}</tbody>
    </table></div>
  </section>
}

const KEY_LABEL = (book: Book) => Object.fromEntries([
  ['income:me', '나 수입'], ['income:partner', '배우자 수입'], ['income:joint', '기타 수입 (배당·이자)'],
  ...Object.values(book.categories).flatMap(g => g.items.map(it => [`spend:${it.id}`, it.label])),
  ['saving:pension', '연금 납입'], ['saving:principal', '대출 원금'],
]) as Record<string, string>

function FixedPanel({ book, h, onClose, onSaved }: { book: Book; h: { hidden: boolean }; onClose: () => void; onSaved: () => void }) {
  const labels = KEY_LABEL(book), f = book.fixed
  const [keys, setKeys] = useState<string[]>(f.keys)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true); setErr('')
    try { await api('/household-book/fixed', 'POST', { keys, version: f.version }); onSaved(); onClose() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  if (!f.month) return <section className="hb-panel hb-side"><p className="hb-pad">먼저 아래 표에 한 달을 적어 주세요. 그 금액으로 매달 고정 항목을 고를 수 있어요.</p></section>
  return <section className="hb-panel hb-side" aria-label="매달 고정 항목">
    <div className="hb-panel-head"><h2>매달 고정 항목</h2><span>체크한 칸은 새 달이 열리면 {Number(f.month.slice(5))}월 금액으로 미리 채워요</span></div>
    {f.suggest.length > 0 && <p className="hb-suggest">최근 3달 금액이 같았어요: {f.suggest.map(k => labels[k]).join(', ')}
      <Button variant="outline" size="sm" onClick={() => setKeys([...new Set([...keys, ...f.suggest])])}>모두 고정으로</Button></p>}
    <div className="hb-fixed-list">{Object.entries(labels).map(([k, l]) => <label key={k} htmlFor={`hb-fix-${k}`}>
      <input id={`hb-fix-${k}`} type="checkbox" checked={keys.includes(k)} onChange={e => setKeys(e.target.checked ? [...keys, k] : keys.filter(x => x !== k))}/>
      <span>{l}</span><b>{f.amounts[k] ? manwon(f.amounts[k], h) : '–'}</b></label>)}</div>
    {err && <p className="hb-error hb-pad" role="alert">{err}</p>}
    <div className="hb-side-actions"><Button variant="outline" onClick={onClose}>닫기</Button><Button onClick={save} disabled={busy} aria-busy={busy}>{busy ? '저장 중…' : '저장'}</Button></div>
  </section>
}

function CapturePanel({ book, month, label, categories, bigLabel, onClose, onSaved }: { book: Book; month: string; label: string; categories: Record<string, Group>; bigLabel: string; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Tx[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const options: [string, string][] = [...Object.values(categories).flatMap(g => g.items.map(it => [it.id, it.label] as [string, string])), ['big', bigLabel], ['skip', '가계부에 안 넣기']]
  async function read(files: FileList | null) {
    if (!files?.length) return
    const form = new FormData(); form.append('month', month); [...files].forEach(f => form.append('images', f))
    setBusy(true); setErr(''); setRows(null)
    try {
      const r = await apiFetch('/api/household-book/capture', { method: 'POST', body: form })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(typeof body.detail === 'string' ? body.detail : '캡처를 읽지 못했어요. 다시 시도해 주세요.')
      setRows(body.rows)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const use = (rows ?? []).filter(r => r.in_month && !r.duplicate)
  const ask = use.filter(r => !r.category).length
  async function apply() {
    setBusy(true); setErr('')
    try {
      await api(`/household-book/${month}/capture`, 'POST', { rows: use.map(({ date, merchant, amount, category }) => ({ date, merchant, amount, category })), version: book.table.versions[Number(month.slice(5))] ?? 0 })
      onSaved()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const other = (rows ?? []).length - use.length
  return <section className="hb-panel hb-side" aria-label={`${label} 캡처`}>
    <div className="hb-panel-head"><h2>{label} 캡처 올리기</h2><span>카드·은행 앱 이용내역 화면. 분류는 전에 고른 것과 가맹점 이름으로 먼저 채워요</span></div>
    <div className="hb-pad hb-upload">
      <label className="hb-file" htmlFor="hb-capture-files"><ImageUp className="size-4"/>{busy && !rows ? '읽는 중…' : '캡처 고르기 (여러 장)'}</label>
      <input id="hb-capture-files" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden disabled={busy} onChange={e => read(e.target.files)}/>
      {rows && <span><b>{use.length}건</b> 읽었어요 · {ask ? <b className="hb-ask-count">{ask}건만 골라 주세요</b> : '모두 분류됐어요'}{other > 0 && ` · 다른 달·이미 더한 내역 ${other}건은 뺐어요`}</span>}
    </div>
    {rows && use.length > 0 && <div className="hb-scroll"><table className="hb-table">
      <thead><tr><th>가맹점</th><th>날짜</th><th>금액</th><th className="hb-left">분류</th></tr></thead>
      <tbody>{use.map(r => { const i = rows.indexOf(r); return <tr key={i} className={r.category ? '' : 'hb-ask'}>
        <td>{r.merchant}</td><td>{r.date.slice(5).replace('-', '.')}</td><td>{r.amount.toLocaleString('ko-KR')}</td>
        <td className="hb-left"><select aria-label={`${r.merchant} 분류`} value={r.category ?? ''} onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, category: e.target.value || null, how: null } : x))}>
          <option value="">골라 주세요</option>{options.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
          {r.how === 'learned' && <small> 전에 고른 분류</small>}</td>
      </tr> })}</tbody></table></div>}
    {err && <p className="hb-error hb-pad" role="alert">{err}</p>}
    <div className="hb-side-actions"><Button variant="outline" onClick={onClose}>닫기</Button>
      {rows && use.length > 0 && <Button onClick={apply} disabled={busy || ask > 0} aria-busy={busy}>{ask ? `${ask}건을 골라야 더할 수 있어요` : `${label} 칸에 더하기`}</Button>}</div>
  </section>
}
