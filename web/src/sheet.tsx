import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Download, Info } from 'lucide-react'
import { api } from './local-data'
import { NewAccount, type RegisterAccount } from './register'
import './sheet.css'

// 엑셀처럼 입력·수정 (Claude 담당). 사용자 "엑셀로 입력하는 느낌이든 진짜 엑셀이든 엄청 손쉽게" (2026-10-28, 참고 excelstock.kr).
// 칸을 눌러 바로 치고, 화살표·Enter·Tab으로 옮기고, 엑셀·구글 시트에서 복사한 표를 붙여 넣는다. 아래 시트 탭은 구글 시트와 같은 두 장.
// 계산은 하지 않는다 — 평가금액·손익 칸은 보여 주기만, 저장 때 서버가 다시 검증한다.

type Kind = 'text' | 'int' | 'select' | 'date' | 'calc'
type Col = { key: string; label: string; width: number; kind: Kind; options?: [string, string][]; align?: 'right'; disabled?: (r: Row) => boolean; calc?: (r: Row) => string }
type Row = Record<string, string> & { _key: string }
type Meta = { id?: string; version?: number; raw?: Record<string, unknown>; readonly?: boolean; deleted?: boolean; orig: string }
type Tab = 'holdings' | 'assets'

const CLASS_OPTS: [string, string][] = [['stock', '주식'], ['long_bond', '장기채'], ['mid_bond', '중기채'], ['gold', '금'], ['commodity', '원자재'], ['cash', '현금'], ['mixed', '혼합·미분류']]
const GROUP_OPTS: [string, string][] = [['us', '미국'], ['kr', '국내'], ['em', '신흥국·테마'], ['income', '배당·리츠']]
const OWNER_OPTS: [string, string][] = [['me', '나'], ['partner', '배우자'], ['joint', '공동']]
const POCKET_OPTS: [string, string][] = [['retirement', '노후'], ['cash', '현금'], ['property', '부동산'], ['debt', '대출']]
const NEW_ACCOUNT = '__new__'
const letters = (i: number) => String.fromCharCode(65 + i)
const toInt = (s: string) => { const n = Number(String(s ?? '').replace(/[,\s원주]/g, '')); return String(s ?? '').trim() !== '' && Number.isInteger(n) ? n : null }
const fmt = (s: string) => { const n = toInt(s); return n === null ? s : n.toLocaleString('ko-KR') }
const today = () => new Date().toLocaleDateString('en-CA')
let seq = 0
const blank = (cols: Col[]): Row => ({ _key: `n${++seq}`, ...Object.fromEntries(cols.filter(c => c.kind !== 'calc').map(c => [c.key, ''])) })
const isEmpty = (r: Row, cols: Col[]) => cols.every(c => c.kind === 'calc' || !String(r[c.key] ?? '').trim())
const KEYS: Record<'holdings' | 'assets', string[]> = { holdings: ['account_id', 'ticker_name', 'ticker', 'qty', 'price', 'buy_value', 'asset_class', 'stock_group'], assets: ['name', 'account', 'owner', 'share_percent', 'pocket', 'assetClass', 'amount', 'as_of'] }
const sigOf = (r: Row, keys: string[]) => JSON.stringify(keys.map(k => r[k] ?? ''))

export function AssetSheet({ owner, initialTab = 'holdings', onSaved, embedded = false }: { owner: 'together' | 'me' | 'partner'; initialTab?: Tab; onSaved: (message: string) => void; embedded?: boolean }) {
  // embedded: 워크북 안에 들어갈 때 — 시트 탭은 워크북이 갖고, 이 표는 initialTab 하나만 보여 준다
  const [tab, setTab] = useState<Tab>(initialTab)
  useEffect(() => { setTab(initialTab) }, [initialTab])
  const [accounts, setAccounts] = useState<RegisterAccount[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [meta, setMeta] = useState<Record<string, Meta>>({})
  const [sel, setSel] = useState({ r: 0, c: 0 })
  const [rowSel, setRowSel] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [creatingFor, setCreatingFor] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  // 고른 칸 위에 늘 있는 보이지 않는 입력칸 — 한글(IME)도 바로 그 칸에 쳐진다. 치기 시작하면 보이는 편집칸이 된다
  const typerRef = useRef<HTMLInputElement>(null)
  const [typed, setTyped] = useState(false)

  const accountOpts: [string, string][] = useMemo(() => [...accounts.map(a => [a.id, a.label] as [string, string]), [NEW_ACCOUNT, '+ 새 계좌…']], [accounts])
  const cols: Col[] = useMemo(() => tab === 'holdings' ? [
    { key: 'account_id', label: '계좌', width: 170, kind: 'select', options: accountOpts },
    { key: 'ticker_name', label: '종목명', width: 210, kind: 'text' },
    { key: 'ticker', label: '종목코드', width: 86, kind: 'text' },
    { key: 'qty', label: '보유수량', width: 90, kind: 'int', align: 'right' },
    { key: 'price', label: '현재가', width: 96, kind: 'int', align: 'right' },
    { key: 'buy_value', label: '매입금액', width: 120, kind: 'int', align: 'right' },
    { key: 'asset_class', label: '자산군', width: 96, kind: 'select', options: CLASS_OPTS },
    { key: 'stock_group', label: '주식 구분', width: 100, kind: 'select', options: GROUP_OPTS, disabled: r => r.asset_class !== 'stock' },
    { key: '_value', label: '평가금액', width: 120, kind: 'calc', align: 'right', calc: r => { const q = toInt(r.qty), p = toInt(r.price); return q && p ? (q * p).toLocaleString('ko-KR') : '' } },
    { key: '_pl', label: '손익', width: 110, kind: 'calc', align: 'right', calc: r => { const q = toInt(r.qty), p = toInt(r.price), b = toInt(r.buy_value); if (!q || !p || !b) return ''; const v = q * p - b; return `${v > 0 ? '+' : ''}${v.toLocaleString('ko-KR')}` } },
  ] : [
    { key: 'name', label: '이름', width: 190, kind: 'text' },
    { key: 'account', label: '계좌·보관처', width: 170, kind: 'text' },
    { key: 'owner', label: '소유자', width: 80, kind: 'select', options: OWNER_OPTS },
    { key: 'share_percent', label: '나의 지분%', width: 92, kind: 'int', align: 'right', disabled: r => r.owner !== 'joint' },
    { key: 'pocket', label: '종류', width: 80, kind: 'select', options: POCKET_OPTS },
    { key: 'assetClass', label: '자산군', width: 100, kind: 'select', options: CLASS_OPTS, disabled: r => r.pocket === 'property' || r.pocket === 'debt' },
    { key: 'amount', label: '금액', width: 140, kind: 'int', align: 'right' },
    { key: 'as_of', label: '기준일', width: 104, kind: 'date' },
  ], [tab, accountOpts])

  const withSpare = useCallback((rs: Row[], cs: Col[]) => { const tail = rs.slice().reverse().findIndex(r => !isEmpty(r, cs)); const filled = tail === -1 ? 0 : rs.length - tail; const out = rs.slice(0, Math.max(filled, 0)); while (out.length < filled + 6) out.push(blank(cs)); return out }, [])

  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const my = ++loadSeq.current   // 늦게 온 이전 응답은 버린다
    setLoading(true); setError(''); setEditing(false); setRowSel(null)
    try {
      if (tab === 'holdings') {
        const d = await api<{ accounts: RegisterAccount[]; rows: { account_id: string; ticker_name: string; ticker: string | null; qty: number; price: number; buy_value: number | null; asset_class: string | null; stock_group: string | null }[] }>(`/register/sheet?owner=${owner}`)
        setAccounts(d.accounts)
        const rs: Row[] = d.rows.map(r => ({ _key: `h${++seq}`, account_id: r.account_id, ticker_name: r.ticker_name, ticker: r.ticker ?? '', qty: String(r.qty), price: String(r.price), buy_value: r.buy_value ? String(r.buy_value) : '', asset_class: r.asset_class ?? '', stock_group: r.stock_group ?? '' }))
        const m: Record<string, Meta> = {}
        rs.forEach(r => { m[r._key] = { id: 'holding', raw: { account_id: r.account_id }, orig: sigOf(r, KEYS.holdings) } })
        if (my !== loadSeq.current) return
        setRows(rs); setMeta(m)
      } else {
        const list = await api<Record<string, unknown>[]>('/assets')
        const visible = list.filter(a => owner === 'together' || a.owner === owner || a.owner === 'joint')
        const rs: Row[] = visible.map(a => ({ _key: `a${++seq}`, name: String(a.name ?? ''), account: String(a.account ?? ''), owner: String(a.owner ?? 'me'), share_percent: a.share_percent ? String(a.share_percent) : '', pocket: String(a.pocket ?? ''), assetClass: String(a.assetClass ?? ''), amount: String(a.amount ?? ''), as_of: String(a.as_of ?? '') }))
        const m: Record<string, Meta> = {}
        rs.forEach((r, i) => { const a = visible[i]; m[r._key] = { id: String(a.id), version: Number(a.version), raw: a, readonly: a.source === 'file' || a.source === 'capture', orig: sigOf(r, KEYS.assets) } })
        if (my !== loadSeq.current) return
        setRows(rs); setMeta(m)
      }
    } catch (e) { if (my === loadSeq.current) setError(e instanceof Error ? e.message : '표를 불러오지 못했어요.') } finally { if (my === loadSeq.current) setLoading(false) }
  }, [tab, owner])
  useEffect(() => { load() }, [load])
  // 처음 불러온 값을 기준으로 바뀐 칸을 표시한다
  useEffect(() => { if (!loading) setRows(rs => withSpare(rs, cols)) }, [loading])   // eslint-disable-line react-hooks/exhaustive-deps

  const rowErrors = useCallback((r: Row): Record<string, string> => {
    if (isEmpty(r, cols) || meta[r._key]?.readonly || meta[r._key]?.deleted) return {}
    const e: Record<string, string> = {}
    if (tab === 'holdings') {
      if (!r.account_id) e.account_id = '계좌를 골라 주세요'
      if (!r.ticker_name.trim()) e.ticker_name = '종목명을 넣어 주세요'
      if (r.ticker && !/^[0-9A-Z]{6}$/.test(r.ticker.trim().toUpperCase())) e.ticker = '종목코드는 6자리예요'
      if (!(toInt(r.qty)! > 0)) e.qty = '1 이상의 정수'
      if (!(toInt(r.price)! > 0)) e.price = '1 이상의 정수'
      if (r.buy_value.trim() && !(toInt(r.buy_value)! >= 0)) e.buy_value = '0 이상의 정수'
      if (!r.asset_class) e.asset_class = '자산군을 골라 주세요'
    } else {
      if (!r.name.trim()) e.name = '이름을 넣어 주세요'
      if (!r.account.trim()) e.account = '계좌나 보관처를 넣어 주세요'
      if (!r.owner) e.owner = '소유자를 골라 주세요'
      if (!r.pocket) e.pocket = '종류를 골라 주세요'
      if ((r.pocket === 'retirement' || r.pocket === 'cash') && !r.assetClass) e.assetClass = '자산군을 골라 주세요'
      if (r.owner === 'joint' && !(toInt(r.share_percent)! >= 1 && toInt(r.share_percent)! <= 99)) e.share_percent = '1~99'
      if (r.owner === 'joint' && r.pocket !== 'property' && r.pocket !== 'debt') e.owner = '공동은 부동산·대출만'
      if (!(toInt(r.amount)! >= 0)) e.amount = '0 이상의 정수'
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.as_of) || r.as_of > today()) e.as_of = 'YYYY-MM-DD, 오늘까지'
    }
    return e
  }, [cols, meta, tab])

  const dirtyKeys = rows.filter(r => { const m = meta[r._key]; if (m?.readonly) return false; if (m?.deleted) return true; if (!m) return !isEmpty(r, cols); return m.orig !== sigOf(r, KEYS[tab]) }).map(r => r._key)
  const errorCount = rows.reduce((n, r) => n + Object.keys(rowErrors(r)).length, 0)

  function setCell(ri: number, key: string, value: string) {
    setRows(rs => {
      const next = rs.map((r, i) => {
        if (i !== ri) return r
        const row = { ...r, [key]: value }
        if (key === 'asset_class' && value !== 'stock') row.stock_group = ''
        if (key === 'pocket' && (value === 'property' || value === 'debt')) row.assetClass = value
        if (key === 'pocket' && (value === 'retirement' || value === 'cash') && (row.assetClass === 'property' || row.assetClass === 'debt')) row.assetClass = ''
        if (tab === 'assets' && !row.as_of && !isEmpty(row, cols)) row.as_of = today()
        if (tab === 'assets' && !row.owner && !isEmpty(row, cols)) row.owner = owner === 'partner' ? 'partner' : 'me'
        return row
      })
      return withSpare(next, cols)
    })
  }
  const optionValue = (c: Col, text: string) => { const t = text.trim(); const hit = c.options?.find(([k, l]) => k === t || l === t || l.replace(/\s/g, '') === t.replace(/\s/g, '')); return hit ? hit[0] : '' }
  const display = (c: Col, r: Row) => c.kind === 'calc' ? c.calc!(r) : c.kind === 'select' ? (c.options?.find(o => o[0] === r[c.key])?.[1] ?? '') : c.kind === 'int' ? fmt(r[c.key] ?? '') : (r[c.key] ?? '')
  const locked = (r: Row, c: Col) => c.kind === 'calc' || !!meta[r._key]?.readonly || !!meta[r._key]?.deleted || !!c.disabled?.(r)

  function move(dr: number, dc: number) {
    setRowSel(null)
    setSel(s => ({ r: Math.max(0, Math.min(rows.length - 1, s.r + dr)), c: Math.max(0, Math.min(cols.length - 1, s.c + dc)) }))
  }
  function startEdit(initial?: string) {
    const r = rows[sel.r], c = cols[sel.c]
    if (!r || locked(r, c)) return
    setDraft(initial ?? (r[c.key] ?? '')); setEditing(true); setTyped(false)
  }
  const focusGrid = () => { const c = cols[sel.c], r = rows[sel.r]; if (r && c && !locked(r, c) && c.kind !== 'select') typerRef.current?.focus(); else gridRef.current?.focus() }
  useEffect(() => { if (!editing && !creatingFor) focusGrid() }, [sel, editing, tab, loading, creatingFor])   // eslint-disable-line react-hooks/exhaustive-deps
  function commit(value = draft) {
    const c = cols[sel.c]
    if (c.kind === 'select' && value === NEW_ACCOUNT) { setCreatingFor(rows[sel.r]._key); setEditing(false); return }
    setCell(sel.r, c.key, c.kind === 'int' ? String(value).replace(/[,\s원주]/g, '') : c.key === 'ticker' ? value.trim().toUpperCase() : value)
    setEditing(false); setTyped(false)
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (creatingFor) return
    if (editing) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); move(1, 0) }
      else if (e.key === 'Tab') { e.preventDefault(); commit(); move(0, e.shiftKey ? -1 : 1) }
      else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setTyped(false) }
      else if (typed && !e.nativeEvent.isComposing && e.key.startsWith('Arrow')) {   // 타이핑으로 시작했으면 엑셀처럼 화살표가 칸을 옮긴다
        e.preventDefault(); commit(); move(e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0, e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0)
      }
      return
    }
    if (e.nativeEvent.isComposing) return
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1, 0) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1, 0) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); move(0, 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(0, -1) }
    else if (e.key === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1) }
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit() }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      if (rowSel !== null) deleteRow(rowSel)
      else { const r = rows[sel.r], c = cols[sel.c]; if (r && !locked(r, c)) setCell(sel.r, c.key, '') }
    }
    else if (mod && e.key.toLowerCase() === 'c') { const r = rows[sel.r]; if (r) navigator.clipboard?.writeText(display(cols[sel.c], r)).catch(() => {}) }
    else if (!mod && e.key.length === 1 && cols[sel.c]?.kind === 'select') { e.preventDefault(); startEdit() }
    // 글자·숫자·한글은 막지 않는다 — 보이지 않는 입력칸이 받아서 onChange로 편집이 시작된다
  }
  function deleteRow(ri: number) {
    const r = rows[ri]; const m = meta[r?._key]
    if (!r || m?.readonly) return
    if (m?.id) setMeta(x => ({ ...x, [r._key]: { ...m, deleted: !m.deleted } }))
    else setRows(rs => withSpare(rs.filter((_, i) => i !== ri), cols))
  }
  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    if (editing || creatingFor) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l.length || i < a.length - 1).map(l => l.split('\t'))
    if (!lines.length) return
    // 첫 줄이 머리글이면 이름으로 맞추고, 아니면 고른 칸부터 차례로
    const aliases: Record<string, string[]> = { account_id: ['계좌', '계좌명'], ticker_name: ['종목명', '종목', '상품명'], ticker: ['종목코드', '코드'], qty: ['보유수량', '수량', '잔고수량'], price: ['현재가', '단가', '기준가'], buy_value: ['매입금액', '매수금액', '원금'], asset_class: ['자산군'], stock_group: ['주식 구분', '주식구분'], name: ['이름', '자산명'], account: ['계좌·보관처', '보관처'], owner: ['소유자'], share_percent: ['나의 지분%', '지분'], pocket: ['종류'], assetClass: ['자산군'], amount: ['금액', '평가금액'], as_of: ['기준일'] }
    const head = lines[0].map(h => h.trim())
    const mapped = head.map(h => cols.findIndex(c => c.kind !== 'calc' && (c.label === h || (aliases[c.key] ?? []).includes(h))))
    const byHeader = mapped.filter(i => i >= 0).length >= 2
    const body = byHeader ? lines.slice(1) : lines
    setRows(rs => {
      const next = rs.slice()
      body.forEach((cells, k) => {
        const ri = sel.r + k
        while (next.length <= ri) next.push(blank(cols))
        const row = { ...next[ri] }
        if (meta[row._key]?.readonly) return
        cells.forEach((raw, j) => {
          const ci = byHeader ? mapped[j] : sel.c + j
          const c = cols[ci]
          if (!c || c.kind === 'calc') return
          const v = raw.trim()
          row[c.key] = c.kind === 'select' ? (c.key === 'account_id' ? (accounts.find(a => a.label === v || a.id === v)?.id ?? '') : optionValue(c, v)) : c.kind === 'int' ? v.replace(/[,\s원주]/g, '') : c.key === 'ticker' ? v.toUpperCase().replace(/^A(\d{6})$/, '$1') : v
        })
        next[ri] = row
      })
      return withSpare(next, cols)
    })
    setNotice(`${body.length}줄을 붙여 넣었어요. 빨간 칸만 고치면 저장할 수 있어요.`)
  }

  async function save() {
    setBusy(true); setError(''); setNotice('')
    try {
      if (tab === 'holdings') {
        const changedAccounts = new Set<string>()
        rows.forEach(r => {
          if (!dirtyKeys.includes(r._key)) return
          if (r.account_id) changedAccounts.add(r.account_id)
          const was = meta[r._key]?.raw?.account_id as string | undefined   // 지웠거나 다른 계좌로 옮긴 행의 원래 계좌도 다시 저장
          if (was) changedAccounts.add(was)
        })
        const now = rows.filter(r => !isEmpty(r, cols) && !meta[r._key]?.deleted)
        let saved = 0, total = 0
        for (const acct of changedAccounts) {
          const list = now.filter(r => r.account_id === acct)
          if (!list.length) { setError(`${accounts.find(a => a.id === acct)?.label ?? acct}의 종목을 모두 지울 수는 없어요. 한 종목 이상 남겨 주세요.`); setBusy(false); return }
          const out = await api<{ total: number; holdings: number }>('/register/commit', 'POST', { account_id: acct, source: 'file', as_of: today(), screen_total: null, accept_diff: true,
            rows: list.map(r => ({ ticker_name: r.ticker_name.trim(), ticker: r.ticker.trim().toUpperCase() || null, qty: toInt(r.qty), price: toInt(r.price), asset_class: r.asset_class, stock_group: r.asset_class === 'stock' && r.stock_group ? r.stock_group : null, buy_value: toInt(r.buy_value) || null })) })
          saved += out.holdings; total += out.total
        }
        window.dispatchEvent(new Event('retire:holdings-changed'))
        onSaved(`${changedAccounts.size}개 계좌 · ${saved}종목 · ${total.toLocaleString('ko-KR')}원을 저장했어요.`)
      } else {
        let n = 0
        for (const r of rows) {
          if (!dirtyKeys.includes(r._key)) continue
          const m = meta[r._key]
          if (m?.deleted && m.id) { await api(`/assets/${m.id}?version=${m.version}`, 'DELETE'); n++; continue }
          if (isEmpty(r, cols)) continue
          const body = { name: r.name.trim(), account: r.account.trim(), owner: r.owner, pocket: r.pocket, assetClass: r.pocket === 'property' || r.pocket === 'debt' ? r.pocket : r.assetClass, amount: toInt(r.amount), as_of: r.as_of, share_percent: r.owner === 'joint' ? toInt(r.share_percent) : null }
          if (m?.id) await api(`/assets/${m.id}`, 'PUT', { ...body, parent_id: (m.raw?.parent_id as string | null) ?? null, valuation_source: (m.raw?.valuation_source as string) ?? 'total', version: m.version })
          else await api('/assets', 'POST', { ...body, parent_id: null, valuation_source: 'total', request_id: crypto.randomUUID() })
          n++
        }
        onSaved(`자산 ${n}건을 저장했어요.`)
      }
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요.'); await load() } finally { setBusy(false) }
  }

  const cur = rows[sel.r], curCol = cols[sel.c]
  const curErr = cur ? rowErrors(cur)[curCol?.key] : undefined
  const creatingRow = rows.find(r => r._key === creatingFor)

  return <div className={`xl-wrap ${embedded ? 'xl-embedded' : ''}`}>
    <div className="xl-bar" onMouseDown={e => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() }}>
      <span className="xl-addr">{letters(sel.c)}{sel.r + 2}</span>
      <span className="xl-fx">fx</span>
      <input className="xl-formula" aria-label="선택한 칸 값" value={editing ? draft : cur && curCol ? (curCol.kind === 'select' ? display(curCol, cur) : curCol.kind === 'calc' ? curCol.calc!(cur) : cur[curCol.key] ?? '') : ''}
        readOnly={!cur || !curCol || locked(cur, curCol) || curCol.kind === 'select'} onFocus={() => { if (cur && curCol && !locked(cur, curCol) && curCol.kind !== 'select') { setDraft(cur[curCol.key] ?? ''); setEditing(true) } }}
        onChange={e => setDraft(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commit() } if (e.key === 'Escape') { setEditing(false) } }}/>
      {curErr && <span className="xl-err-msg">{curErr}</span>}
    </div>

    {creatingRow && <NewAccount initial={{ label: '', owner: owner === 'partner' ? 'partner' : 'me', broker: 'mirae', account_type: 'pension_savings' }} onCancel={() => setCreatingFor(null)}
      onCreated={async id => { const d = await api<{ accounts: RegisterAccount[] }>(`/register/sheet?owner=together`); setAccounts(d.accounts); setRows(rs => rs.map(r => r._key === creatingFor ? { ...r, account_id: id } : r)); setCreatingFor(null); gridRef.current?.focus() }}/>}

    {loading ? <div className="loading-strip" role="status">표를 불러오는 중…</div> :
    <div className="xl-scroll">
      <div className="xl-grid" ref={gridRef} tabIndex={0} role="grid" aria-label={tab === 'holdings' ? '보유종목 표' : '자산 표'} onKeyDown={onKey} onPaste={onPaste}
        style={{ gridTemplateColumns: `40px ${cols.map(c => `${c.width}px`).join(' ')}` }}>
        <div className="xl-corner"/>
        {cols.map((c, i) => <div key={c.key} className={`xl-colh ${sel.c === i ? 'on' : ''}`}>{letters(i)}</div>)}
        <div className="xl-rowh">1</div>
        {cols.map(c => <div key={c.key} className={`xl-head ${c.align === 'right' ? 'r' : ''} ${c.kind === 'calc' ? 'calc' : ''}`}>{c.label}</div>)}
        {rows.map((r, ri) => { const errs = rowErrors(r); const m = meta[r._key]; const dirty = dirtyKeys.includes(r._key); return [
          <div key={`${r._key}-h`} role="rowheader" className={`xl-rowh ${sel.r === ri ? 'on' : ''} ${rowSel === ri ? 'picked' : ''} ${dirty ? 'dirty' : ''}`} title={m?.readonly ? '사진·파일로 등록한 줄은 보유종목 탭에서 고쳐요' : '눌러서 줄 선택 → Delete로 지우기'}
            onMouseDown={e => { e.preventDefault(); if (editing) commit(); setRowSel(ri); setSel({ r: ri, c: 0 }); setEditing(false); gridRef.current?.focus() }}>{ri + 2}</div>,
          ...cols.map((c, ci) => { const on = sel.r === ri && sel.c === ci && rowSel === null; const lk = locked(r, c)
            return <div key={`${r._key}-${c.key}`} role="gridcell" aria-selected={on}
              className={`xl-cell ${c.align === 'right' ? 'r' : ''} ${on ? 'on' : ''} ${rowSel === ri ? 'picked' : ''} ${lk ? 'lock' : ''} ${c.kind === 'calc' ? 'calc' : ''} ${errs[c.key] ? 'bad' : ''} ${m?.deleted ? 'del' : ''} ${m?.readonly ? 'ro' : ''} ${c.key === '_pl' && display(c, r).startsWith('-') ? 'down' : c.key === '_pl' && display(c, r).startsWith('+') ? 'up' : ''}`}
              title={errs[c.key]}
              onMouseDown={e => { if (on && editing) return; e.preventDefault(); if (editing) commit(); setRowSel(null); setEditing(false); setSel({ r: ri, c: ci }) }}   // 기본 동작(표 전체로 포커스)을 막아야 그 칸 입력칸이 포커스를 받는다
              onDoubleClick={() => startEdit()}
              onClick={() => { if (c.kind === 'select' && !lk && !(on && editing)) { setSel({ r: ri, c: ci }); setDraft(r[c.key] ?? ''); setEditing(true) } }}>
              {on && editing && c.kind === 'select'
                ? <select autoFocus aria-label={c.label} value={draft} onChange={e => commit(e.target.value)} onBlur={() => setEditing(false)}><option value="">—</option>{c.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                : <>{!(on && editing) && display(c, r)}{on && !lk && c.kind !== 'select' && <input ref={typerRef} aria-label={c.label} className={editing ? 'xl-edit' : 'xl-typer'} value={editing ? draft : ''}
                    onChange={e => { if (!editing) { setEditing(true); setTyped(true) } setDraft(e.target.value) }}
                    onCompositionStart={() => { if (!editing) { setDraft(''); setEditing(true); setTyped(true) } }}
                    onBlur={() => { if (editing) commit() }} inputMode={c.kind === 'int' ? 'numeric' : undefined} placeholder={editing && c.kind === 'date' ? 'YYYY-MM-DD' : undefined}/>}</>}
            </div> }),
        ] })}
      </div>
    </div>}

    {!embedded && <div className="xl-tabs" role="tablist">
      {([['holdings', '보유종목'], ['assets', '자산']] as [Tab, string][]).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} disabled={busy}
        onClick={() => { if (tab === k) return; if (dirtyKeys.length) { setNotice('바뀐 내용을 먼저 저장해 주세요. 저장하지 않고 탭을 바꾸면 사라져요.'); return } setNotice(''); setTab(k); setSel({ r: 0, c: 0 }) }}>{l}</button>)}
      <span className="xl-hint">{tab === 'holdings' ? '엑셀·구글 시트·증권사 화면에서 복사해 붙여 넣어도 돼요' : '집·대출·예금처럼 금액만 아는 자산. 사진·파일로 등록한 줄은 회색'}</span>
    </div>}

    {notice && <p className="xl-notice">{notice}</p>}
    {error && <div className="form-error" role="alert"><Info size={16}/>{error}</div>}
    <div className="xl-foot">
      <span className="xl-links">{tab === 'holdings' && <><a href={`/api/register/template.xlsx?prefill=1&owner=${owner}`} download><Download size={14}/>지금 잔고를 엑셀로 받기</a><a href="/api/register/template.xlsx" download><Download size={14}/>빈 엑셀 양식</a></>}</span>
      <span className="xl-status">{dirtyKeys.length ? `바뀐 줄 ${dirtyKeys.length}개` : '바뀐 내용 없음'}{errorCount ? ` · 빨간 칸 ${errorCount}개` : ''}</span>
      <button type="button" className="xl-save" disabled={busy || !dirtyKeys.length || errorCount > 0} onClick={save}>{busy ? '저장하는 중…' : '저장'}</button>
    </div>
  </div>
}
