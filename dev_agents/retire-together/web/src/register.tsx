import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Camera, Check, Download, FileSpreadsheet, Info, PencilLine, Plus, Sheet, Upload, X } from 'lucide-react'
import { AssetForm } from './forms'
import { api } from './local-data'
import { classInfo, money, type Asset, type Family, type Owner } from './model'
import './register.css'
import { AssetSheet } from './sheet'

// REG-01 — '자산 등록' 한 곳. 사진(캡처)·직접 입력·파일 중 고르면 같은 확인 표로 모이고 저장은 한 곳(/api/register/commit)으로 간다.
// 계산은 전부 서버(코드)가 한다. 화면은 값을 보여 주고 사용자가 고친 칸을 그대로 보낸다.

type Method = 'choose' | 'capture' | 'manual' | 'file' | 'sheet'
export type RegisterAccount = { id: string; label: string; owner: 'me' | 'partner'; broker: string | null; broker_label: string; account_type: string | null; type_label: string; pocket: 'retirement' | 'cash'; active: boolean; has_holdings: boolean }
type PreviewRow = { ticker_name: string; ticker: string | null; qty: number | null; price: number | null; value: number | null; buy_value: number | null; asset_class: string | null; stock_group: string | null; role: string | null; confirmed: boolean; candidates: [string, string][] }
type Preview = { account_id: string; account_label: string; source: 'capture' | 'file'; rows: PreviewRow[]; computed_total: number; screen_total: number | null; verified: boolean; reconciled: boolean; diff: number; value_diff: number | null; errors: string[]; class_labels: Record<string, string>; stock_groups?: Record<string, string>; matched_label?: string | null; suggested?: { label: string; owner: 'me' | 'partner'; broker: string; account_type: string } }
type EditRow = { key: number; ticker_name: string; ticker: string; qty: string; price: string; buy: string; asset_class: string; stock_group: string; confirmed: boolean; candidates: [string, string][] }
const HOLDING_CLASSES = ['stock', 'long_bond', 'mid_bond', 'gold', 'commodity', 'cash', 'mixed']
// 주식 안의 구분 — 보여 주기만 나눈다. 리밸런싱은 주식 하나로 맞춘다 (2026-10-28 사용자)
const STOCK_GROUPS: [string, string, string][] = [['us', '미국', '#5985ec'], ['kr', '국내', '#3d64c4'], ['em', '신흥국·테마', '#9db8f5'], ['income', '배당·리츠', '#7fa0e6']]
const groupInfo = (k: string) => STOCK_GROUPS.find(g => g[0] === k)
const BROKERS: [string, string][] = [['mirae', '미래에셋'], ['kiwoom', '키움'], ['kis', '한국투자'], ['samsung', '삼성'], ['nh', 'NH'], ['kb', 'KB'], ['shinhan', '신한'], ['toss', '토스'], ['other', '기타']]
const TYPES: [string, string][] = [['pension_savings', '연금저축'], ['irp', 'IRP'], ['isa', 'ISA'], ['general', '일반(주식·예금)']]

async function upload<T>(path: string, form: FormData): Promise<T> {
  let response: Response
  try { response = await fetch(`/api${path}`, { method: 'POST', body: form, headers: { 'X-Retire-Local': '1' } }) }
  catch { throw new Error('저장 서버에 연결할 수 없습니다. 서버 실행 상태를 확인한 뒤 다시 시도해 주세요.') }
  if (!response.ok) {
    let detail: unknown
    try { detail = (await response.json()).detail } catch { /* non-JSON */ }
    throw new Error(typeof detail === 'string' ? detail : '파일을 읽지 못했어요. 다시 시도해 주세요.')
  }
  return response.json()
}
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
const toInt = (s: string) => { const n = Number(String(s).replace(/[,\s]/g, '')); return Number.isInteger(n) && n > 0 ? n : null }

export function RegisterModal({ family, owner, page, asset, parent, onSaved, onProfile }: {
  family: Family | null; owner: Owner; page: string; asset: Asset | null; parent?: Asset | null; onSaved: (message: string) => void; onProfile: () => void
}) {
  const [method, setMethod] = useState<Method>(asset ? 'manual' : 'choose')
  if (asset) return <AssetForm family={family} asset={asset} owner={owner} parent={parent} onSaved={() => onSaved('자산을 수정했어요.')} onProfile={onProfile}/>
  if (method === 'choose') return <div className="register-choose">
    <p className="form-intro">가장 쉬운 방법으로 시작해요.<br/>어느 길로 들어와도 같은 확인 표에서 저장돼요.</p>
    <div className="register-choice" role="group" aria-label="등록 방법">
      <button onClick={() => setMethod('capture')}><span className="choice-icon capture"><Camera size={24}/></span><strong>사진</strong><small>증권사 앱 잔고 화면 캡처를 올려요. 표로 바뀌고 합계를 맞춰 봐요.</small></button>
      <button onClick={() => setMethod('sheet')}><span className="choice-icon sheet"><Sheet size={24}/></span><strong>표로 입력·수정</strong><small>엑셀처럼 칸에 바로 치거나, 엑셀·구글 시트에서 복사해 붙여 넣어요.</small></button>
      <button onClick={() => setMethod('file')}><span className="choice-icon file"><FileSpreadsheet size={24}/></span><strong>엑셀·CSV 파일</strong><small>엑셀 양식을 받아 채워서 올려요. 계좌 여러 개도 한 파일에.</small></button>
      <button onClick={() => setMethod('manual')}><span className="choice-icon manual"><PencilLine size={24}/></span><strong>금액 직접 입력</strong><small>집·대출·예금처럼 금액만 알면 되는 자산 하나.</small></button>
    </div>
    <p className="form-help">사진과 파일은 종목 단위로 저장되고 자산군별 금액으로 묶여 자산 표에 올라가요. 구글 시트가 연결돼 있으면 시트에 바로 쓰여요.</p>
  </div>
  if (method === 'sheet') return <><BackLink onClick={() => setMethod('choose')}/><AssetSheet owner={owner} initialTab="holdings" onSaved={onSaved}/></>
  if (method === 'manual') return <><BackLink onClick={() => setMethod('choose')}/><AssetForm family={family} asset={null} owner={owner} parent={parent} initialKind={page === 'stocks' ? 'stock' : page === 'property' ? 'property' : undefined} onSaved={() => onSaved('자산을 등록했어요.')} onProfile={onProfile}/></>
  return <><BackLink onClick={() => setMethod('choose')}/><UploadFlow mode={method} owner={owner} onSaved={onSaved}/></>
}

function BackLink({ onClick }: { onClick: () => void }) {
  return <button type="button" className="text-link register-back" onClick={onClick}><ArrowLeft size={14}/>다른 방법으로</button>
}

type Group = { key: number; preview: Preview; rows: EditRow[]; accountId: string; acceptDiff: boolean; creating: boolean; picking: boolean; error: string; saved: string }
const toEdit = (p: Preview): EditRow[] => p.rows.map((r, i) => ({ key: i, ticker_name: r.ticker_name, ticker: r.ticker ?? '', qty: r.qty === null ? '' : String(r.qty), price: r.price === null ? '' : String(r.price), buy: r.buy_value ? String(r.buy_value) : '', asset_class: r.asset_class ?? '', stock_group: r.stock_group ?? '', confirmed: r.confirmed, candidates: r.candidates }))
const toMoney = (s: string) => { const n = Number(String(s).replace(/[,\s]/g, '')); return Number.isInteger(n) && n >= 0 && String(s).trim() !== '' ? n : null }
const value = (r: EditRow) => (toInt(r.qty) ?? 0) * (toInt(r.price) ?? 0)
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('ko-KR')}`
const tone = (n: number) => n < 0 ? 'down' : n > 0 ? 'up' : ''
function rowProblems(rows: EditRow[]) {
  return [...new Set(rows.flatMap(r => [
    !r.ticker_name.trim() ? '종목명이 빈 줄이 있어요.' : '',
    toInt(r.qty) === null ? `${r.ticker_name || '빈 줄'}: 보유수량은 1 이상의 정수예요.` : '',
    toInt(r.price) === null ? `${r.ticker_name || '빈 줄'}: 현재가는 1 이상의 정수예요.` : '',
    r.buy.trim() && toMoney(r.buy) === null ? `${r.ticker_name}: 매입금액은 0 이상의 정수예요.` : '',
    r.ticker && !/^[0-9A-Z]{6}$/.test(r.ticker.trim().toUpperCase()) ? `${r.ticker_name}: 종목코드는 6자리예요.` : '',
  ].filter(Boolean)))]
}

export function UploadFlow({ mode, owner, onSaved }: { mode: 'capture' | 'file'; owner: Owner; onSaved: (message: string) => void }) {
  const [accounts, setAccounts] = useState<RegisterAccount[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [asOf, setAsOf] = useState(new Date().toLocaleDateString('en-CA'))
  const [dateOpen, setDateOpen] = useState(false)
  const [split, setSplit] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const today = new Date().toLocaleDateString('en-CA')
  const isCapture = mode === 'capture'
  const ownerHint = owner === 'partner' ? 'partner' : 'me'
  const source = isCapture ? '캡처 화면' : '파일'

  async function loadAccounts() {
    try { setAccounts(await api<RegisterAccount[]>('/register/accounts')) } catch { /* 목록이 없어도 등록은 진행 — 확인 화면에서 새 계좌를 만든다 */ }
  }
  useEffect(() => { loadAccounts() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  function pick(list: FileList | null) {
    if (!list) return
    const next = Array.from(list).filter(f => isCapture ? f.type.startsWith('image/') : /\.(csv|xlsx|xlsm|xls)$/i.test(f.name))
    if (!next.length) { setError(isCapture ? 'PNG·JPG 이미지를 올려 주세요.' : 'CSV 또는 엑셀(.xlsx) 파일을 올려 주세요.'); return }
    setError('')
    setFiles(isCapture ? [...files, ...next].slice(0, 12) : [next[0]])
  }
  async function convert() {
    if (!files.length) { setError(isCapture ? '캡처를 한 장 이상 올려 주세요.' : '파일을 올려 주세요.'); return }
    setBusy(true); setError('')
    const form = new FormData()
    form.append('owner', ownerHint)
    if (isCapture) files.forEach(f => form.append('images', f)); else form.append('file', files[0])
    try {
      const out = await upload<{ groups: Preview[] }>(isCapture ? '/register/capture' : '/register/file', form)
      setGroups(out.groups.map((p, i) => ({ key: i, preview: p, rows: toEdit(p), accountId: p.account_id ?? '', acceptDiff: false, creating: !p.account_id, picking: false, error: '', saved: '' })))
      setEditing(null)
    } catch (e) { setError(e instanceof Error ? e.message : '변환하지 못했어요.') } finally { setBusy(false) }
  }
  const patchGroup = (key: number, patch: Partial<Group> | ((g: Group) => Partial<Group>)) => setGroups(gs => gs && gs.map(g => g.key === key ? { ...g, ...(typeof patch === 'function' ? patch(g) : patch) } : g))
  const editRow = (g: Group, rowKey: number, patch: Partial<EditRow>) => patchGroup(g.key, gg => ({ rows: gg.rows.map(r => r.key === rowKey ? { ...r, ...patch } : r) }))

  function stats(g: Group) {
    const total = g.rows.reduce((n, r) => n + value(r), 0)
    const hasBuy = g.rows.length > 0 && g.rows.every(r => toMoney(r.buy))
    const buy = hasBuy ? g.rows.reduce((n, r) => n + (toMoney(r.buy) ?? 0), 0) : 0
    const verified = !!g.preview.screen_total
    const diff = verified ? total - g.preview.screen_total! : 0
    const matches = verified && Math.abs(diff) <= 5000
    const problems = rowProblems(g.rows)
    const unclassified = g.rows.filter(r => !r.asset_class).length
    const ready = !g.saved && g.rows.length > 0 && !problems.length && !unclassified && !!g.accountId && (!verified || matches || g.acceptDiff)
    return { total, hasBuy, buy, verified, diff, matches, problems, unclassified, ready }
  }
  const pending = (groups ?? []).filter(g => !g.saved)
  const canSave = pending.length > 0 && pending.every(g => stats(g).ready)
  const ctaLabel = (() => {
    if (!groups) return ''
    if (pending.some(g => !g.accountId)) return '저장할 계좌를 골라 주세요'
    const need = pending.reduce((n, g) => n + stats(g).unclassified, 0)
    if (need) return `자산군 ${need}개를 골라 주세요`
    if (pending.some(g => stats(g).problems.length)) return '표시된 칸을 고쳐 주세요'
    if (pending.some(g => { const st = stats(g); return st.verified && !st.matches && !g.acceptDiff })) return '합계 차이를 확인해 주세요'
    const sum = pending.reduce((n, g) => n + stats(g).total, 0)
    return pending.length > 1 ? `계좌 ${pending.length}개 · ${won(sum)} 등록하기` : `${won(sum)} 등록하기`
  })()

  async function saveAll(e: FormEvent) {
    e.preventDefault()
    if (!groups || !canSave) return
    setBusy(true)
    const done: string[] = []
    let sheet = false
    for (const g of groups) {
      if (g.saved) { done.push(g.saved); continue }
      try {
        const out = await api<{ total: number; holdings: number; sheet: boolean }>('/register/commit', 'POST', {
          account_id: g.accountId, source: g.preview.source, as_of: asOf, screen_total: g.preview.screen_total, accept_diff: g.acceptDiff,
          rows: g.rows.map(r => ({ ticker_name: r.ticker_name.trim(), ticker: r.ticker.trim().toUpperCase() || null, qty: toInt(r.qty), price: toInt(r.price),
            asset_class: r.asset_class, stock_group: r.asset_class === 'stock' && r.stock_group ? r.stock_group : null, buy_value: toMoney(r.buy) || null })),
        })
        sheet = sheet || out.sheet
        const label = accounts.find(a => a.id === g.accountId)?.label ?? g.preview.account_label
        const msg = `${label} ${out.holdings}종목 · ${money(out.total)}`
        done.push(msg); patchGroup(g.key, { saved: msg, error: '' })
      } catch (err) { patchGroup(g.key, { error: err instanceof Error ? err.message : '저장하지 못했어요.' }); setBusy(false); return }
    }
    setBusy(false)
    window.dispatchEvent(new Event('retire:holdings-changed'))   // 종목 잔고 화면이 다시 읽는다
    onSaved(`등록했어요: ${done.join(' / ')}${sheet ? ' · 구글 시트에도 썼어요.' : ''}`)
  }

  function rowView(g: Group, r: EditRow, total: number) {
    const k = `${g.key}:${r.key}`, open = editing === k || !r.asset_class
    const v = value(r), b = toMoney(r.buy), pl = b ? v - b : null
    const toggle = () => setEditing(editing === k ? null : k)
    return <div className={`rv-row ${open ? 'open' : ''}`} key={r.key} role="button" tabIndex={0} aria-expanded={open} aria-label={`${r.ticker_name || '새 종목'} ${open ? '닫기' : '고치기'}`}
      onClick={e => { if (!(e.target as HTMLElement).closest('.rv-edit')) toggle() }} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !(e.target as HTMLElement).closest('.rv-edit')) { e.preventDefault(); toggle() } }}>
      <span className="rv-nm">{r.ticker_name || '새 종목'}</span>
      <span className="rv-qty n">{toInt(r.qty)?.toLocaleString('ko-KR') ?? '—'}주{b && toInt(r.qty) ? ` · 평균 ${won(Math.round(b / toInt(r.qty)!))}` : ''}</span>
      <span className="rv-val n">{v ? won(v) : '—'}</span><span className="rv-buy n">{b ? won(b) : ''}</span>
      <span className={`rv-pl n ${pl === null ? '' : tone(pl)}`}>{pl === null ? '' : signed(pl)}</span><span className={`rv-rt n ${pl === null ? '' : tone(pl)}`}>{pl === null || !b ? '' : `${(pl / b * 100).toFixed(2)}%`}</span>
      <span className="rv-wt n">{total ? `${(v / total * 100).toFixed(1)}%` : ''}</span>
      {open && <div className="rv-edit" onClick={e => e.stopPropagation()}>
        <label>자산군<select aria-label="자산군" value={r.asset_class} onChange={e => { editRow(g, r.key, { asset_class: e.target.value }); setEditing(null) }}><option value="">고르기</option>{HOLDING_CLASSES.map(c => <option key={c} value={c}>{classInfo[c]?.label ?? c}</option>)}</select></label>
        {r.asset_class === 'stock' && <label>주식 구분<select aria-label="주식 구분" value={r.stock_group} onChange={e => editRow(g, r.key, { stock_group: e.target.value })}><option value="">고르기</option>{STOCK_GROUPS.map(([k2, l]) => <option key={k2} value={k2}>{l}</option>)}</select></label>}
        <label>종목명<input aria-label="종목명" value={r.ticker_name} onChange={e => editRow(g, r.key, { ticker_name: e.target.value })}/></label>
        <label>종목코드<input aria-label="종목코드" value={r.ticker} maxLength={6} placeholder="6자리" onChange={e => editRow(g, r.key, { ticker: e.target.value })}/></label>
        <label>보유수량<input aria-label="보유수량" className="n" inputMode="numeric" value={r.qty} onChange={e => editRow(g, r.key, { qty: e.target.value })}/></label>
        <label>현재가<input aria-label="현재가" className="n" inputMode="numeric" value={r.price} onChange={e => editRow(g, r.key, { price: e.target.value })}/></label>
        <label>매입금액<input aria-label="매입금액" className="n" inputMode="numeric" value={r.buy} placeholder="모르면 비워 두기" onChange={e => editRow(g, r.key, { buy: e.target.value })}/></label>
        <div className="rv-edit-tools">{r.candidates.length > 0 && !r.ticker && <span className="candidates">종목코드 후보 {r.candidates.map(([code, name]) => <button type="button" key={code} onClick={() => editRow(g, r.key, { ticker: code })}>{code} {name}</button>)}</span>}<button type="button" className="text-link danger" onClick={() => { patchGroup(g.key, gg => ({ rows: gg.rows.filter(x => x.key !== r.key) })); setEditing(null) }}>이 종목 빼기</button></div>
      </div>}
    </div>
  }

  function holdingsView(g: Group, total: number) {
    const byCls = new Map<string, EditRow[]>()
    g.rows.forEach(r => byCls.set(r.asset_class, [...(byCls.get(r.asset_class) ?? []), r]))
    const sum = (list: EditRow[]) => list.reduce((n, r) => n + value(r), 0)
    const order = [...byCls.keys()].sort((a, b) => a === '' ? -1 : b === '' ? 1 : sum(byCls.get(b)!) - sum(byCls.get(a)!))
    const head = (cls: string, label: string, color: string, list: EditRow[]) => {
      const gv = sum(list), allBuy = list.every(r => toMoney(r.buy)), gpl = allBuy ? gv - list.reduce((n, r) => n + (toMoney(r.buy) ?? 0), 0) : null
      return <div className={`rv-group n ${cls}`} key={`h-${cls}-${label}`}><span className="rv-g-name"><i style={{ background: color }}/>{label}<small>{list.length}종목</small></span><span className="rv-g-val">{won(gv)}</span><span className={`rv-g-pl ${gpl === null ? '' : tone(gpl)}`}>{gpl === null ? '' : signed(gpl)}</span><span className="rv-g-wt">{total ? `${(gv / total * 100).toFixed(1)}%` : ''}</span></div>
    }
    const byValue = (list: EditRow[]) => [...list].sort((a, b) => value(b) - value(a))
    return order.map(c => {
      const list = byCls.get(c)!
      if (!c) return [head('need', '자산군을 골라 주세요', '#3182f6', list), ...byValue(list).map(r => rowView(g, r, total))]
      const parts = [head('', classInfo[c]?.label ?? c, classInfo[c]?.color ?? '#b0b8c1', list)]
      if (c === 'stock' && split) {
        const subs = [...STOCK_GROUPS.map(([k]) => k), ''].map(k => ({ k, list: list.filter(r => (r.stock_group || '') === k) })).filter(x => x.list.length).sort((a, b) => sum(b.list) - sum(a.list))
        subs.forEach(x => { parts.push(head('sub', x.k ? groupInfo(x.k)![1] : '구분 안 함', x.k ? groupInfo(x.k)![2] : '#d1d6db', x.list)); parts.push(...byValue(x.list).map(r => rowView(g, r, total))) })
      } else parts.push(...byValue(list).map(r => rowView(g, r, total)))
      return parts
    })
  }

  function mixView(g: Group, total: number) {
    const segs: [string, string, number][] = []
    const classes = HOLDING_CLASSES.filter(c => g.rows.some(r => r.asset_class === c)).map(c => [c, g.rows.filter(r => r.asset_class === c).reduce((n, r) => n + value(r), 0)] as [string, number]).sort((a, b) => b[1] - a[1])
    classes.forEach(([c, v]) => {
      if (c === 'stock' && split) {
        [...STOCK_GROUPS.map(([k]) => k), ''].map(k => [k, g.rows.filter(r => r.asset_class === 'stock' && (r.stock_group || '') === k).reduce((n, r) => n + value(r), 0)] as [string, number])
          .filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).forEach(([k, sv]) => segs.push([`주식 · ${k ? groupInfo(k)![1] : '구분 안 함'}`, k ? groupInfo(k)![2] : '#d1d6db', sv]))
      } else segs.push([classInfo[c]?.label ?? c, classInfo[c]?.color ?? '#b0b8c1', v])
    })
    const none = g.rows.filter(r => !r.asset_class).reduce((n, r) => n + value(r), 0)
    if (none) segs.push(['미정', '#e5e8eb', none])
    if (!total) return null
    return <div className="rv-mix">
      <div className="rv-bar" role="img" aria-label={segs.map(([l, , v]) => `${l} ${(v / total * 100).toFixed(1)}%`).join(', ')}>{segs.map(([l, c, v]) => <span key={l} style={{ flex: v, background: c }}/>)}</div>
      <div className="rv-legend n">{segs.map(([l, c, v]) => <span key={l}><i style={{ background: c }}/>{l} {(v / total * 100).toFixed(1)}%</span>)}</div>
      {g.rows.some(r => r.asset_class === 'stock') && <label className="rv-split"><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)}/>주식을 나눠 보기<small>국내 · 미국 · 신흥국·테마 · 배당·리츠</small></label>}
    </div>
  }

  if (groups) return <form className="rv register-wide" onSubmit={saveAll}>
    <div className="rv-top"><h3>이렇게 등록할게요</h3><span className="rv-date">{asOf.replaceAll('-', '.')} 기준{dateOpen ? <input type="date" aria-label="기준일" value={asOf} max={today} onChange={e => setAsOf(e.target.value)} required/> : <button type="button" className="rv-link" onClick={() => setDateOpen(true)}>바꾸기</button>}</span></div>
    {groups.map(g => { const st = stats(g); const target = accounts.find(a => a.id === g.accountId); const pl = st.hasBuy ? st.total - st.buy : null; return <section className={`rv-acct ${g.saved ? 'is-saved' : ''}`} key={g.key}>
      <div className="rv-acct-line"><h4>{g.preview.account_label}</h4>
        {g.picking || (!g.accountId && !g.creating)
          ? <select aria-label="저장할 계좌" value={g.creating ? '__new__' : g.accountId} onChange={e => e.target.value === '__new__' ? patchGroup(g.key, { creating: true, picking: false }) : patchGroup(g.key, { creating: false, picking: false, accountId: e.target.value })}>
              <option value="" disabled>저장할 계좌 고르기</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.label} · {a.owner === 'me' ? '나' : '배우자'} · {a.broker_label} {a.type_label}</option>)}
              <option value="__new__">새 계좌로 추가 — {g.preview.suggested?.label ?? g.preview.account_label}</option>
            </select>
          : target && <span className="rv-to">{target.broker_label} {target.type_label} · {target.owner === 'me' ? '나' : '배우자'}의 <b>{target.label}</b>에 저장<button type="button" className="rv-link" onClick={() => patchGroup(g.key, { picking: true })}>바꾸기</button></span>}
      </div>
      {g.creating && <NewAccount initial={g.preview.suggested ?? { label: g.preview.account_label, owner: ownerHint, broker: 'other', account_type: 'general' }} onCancel={accounts.length ? () => patchGroup(g.key, { creating: false, picking: true }) : undefined} onCreated={async id => { await loadAccounts(); patchGroup(g.key, { creating: false, picking: false, accountId: id }) }}/>}
      <div className="rv-total n">
        <div className="rv-big">{won(st.total)}</div>
        {pl !== null && <div className={`rv-pl-line ${tone(pl)}`}>{signed(pl)}원 ({(pl / st.buy * 100).toFixed(2)}%)</div>}
        <div className={`rv-check ${st.verified && !st.matches ? 'warn' : ''}`}>
          {st.hasBuy && <>매입 {won(st.buy)} · </>}
          {!st.verified ? `${source} 합계를 읽지 못해 대조하지 않았어요. 숫자를 한 번 봐 주세요.`
            : st.matches ? <>{source} 합계 <b>{won(g.preview.screen_total!)}</b>와 같아요</>
            : <>{source} 합계 <b>{won(g.preview.screen_total!)}</b>와 {signed(st.diff)}원 달라요. {isCapture ? '이 계좌 캡처가 한 장 빠졌을 수 있어요.' : '수량이나 현재가를 확인해 주세요.'}</>}
        </div>
        {st.verified && !st.matches && <label className="rv-accept"><input type="checkbox" checked={g.acceptDiff} onChange={e => patchGroup(g.key, { acceptDiff: e.target.checked })}/>차이를 확인했고 이대로 등록할게요</label>}
      </div>
      {mixView(g, st.total)}
      {g.preview.errors.length > 0 && <ul className="rv-notes">{g.preview.errors.map(e => <li key={e}>{e}</li>)}</ul>}
      <div className="rv-list">
        <div className="rv-head"><span>종목 · 보유수량</span><span>평가금액 · 매입</span><span>손익 · 수익률</span><span>비중</span></div>
        {holdingsView(g, st.total)}
        <button type="button" className="rv-link rv-add" onClick={() => { const key = Date.now(); patchGroup(g.key, gg => ({ rows: [...gg.rows, { key, ticker_name: '', ticker: '', qty: '', price: '', buy: '', asset_class: '', stock_group: '', confirmed: false, candidates: [] }] })); setEditing(`${g.key}:${key}`) }}><Plus size={14}/>종목 추가</button>
      </div>
      {st.problems.length > 0 && <ul className="rv-notes">{st.problems.slice(0, 4).map(p => <li key={p}>{p}</li>)}</ul>}
      {g.error && <div className="form-error" role="alert"><Info size={16}/>{g.error}</div>}
      {g.saved && <p className="rv-saved"><Check size={15}/>등록했어요 · {g.saved}</p>}
    </section> })}
    <div className="rv-cta">
      <button type="submit" className="rv-save" disabled={busy || !canSave}>{busy ? '등록하는 중…' : ctaLabel}</button>
      <button type="button" className="rv-link" disabled={busy} onClick={() => setGroups(null)}>다른 {isCapture ? '캡처' : '파일'} 올리기</button>
    </div>
  </form>

  return <div className="register-upload">
    <p className="form-intro">{isCapture ? <>증권사 앱의 잔고 화면을 캡처해서 전부 올려요.<br/>계좌가 여러 개여도 한 번에 — 화면 위의 계좌 이름으로 나눠요.</> : <>CSV나 엑셀을 올려요.<br/>종목명·수량·현재가(또는 평가금액) 열만 있으면 돼요.</>}</p>
    <button type="button" className={`dropzone ${files.length ? 'has-files' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files) }}>
      <Upload size={22}/><strong>{isCapture ? '캡처 이미지 올리기' : '파일 올리기'}</strong><small>{isCapture ? '여러 장 · 여러 계좌 가능 · PNG, JPG · 끌어다 놓기' : 'CSV, XLSX · 끌어다 놓기'}</small>
      <input ref={inputRef} type="file" hidden multiple={isCapture} accept={isCapture ? 'image/png,image/jpeg,image/webp' : '.csv,.xlsx,.xlsm,.xls'} onChange={e => { pick(e.target.files); e.target.value = '' }}/>
    </button>
    {files.length > 0 && <ul className="file-list">{files.map((f, i) => <li key={`${f.name}-${i}`}><span>{f.name}</span><small>{(f.size / 1024).toFixed(0)}KB</small><button type="button" className="icon-button" aria-label={`${f.name} 빼기`} onClick={() => setFiles(files.filter((_, k) => k !== i))}><X size={14}/></button></li>)}</ul>}
    {error && <div className="form-error" role="alert"><Info size={16}/>{error}</div>}
    <button type="button" className="primary-button full-width" disabled={busy} onClick={convert}>{busy ? (isCapture ? '캡처를 읽는 중… (계좌가 많으면 1분쯤)' : '파일을 읽는 중…') : '표로 바꾸기'}<ArrowRight size={16}/></button>
    {!isCapture && <p className="xl-links reg-template"><a href="/api/register/template.xlsx" download><Download size={14}/>빈 엑셀 양식 받기</a><a href={`/api/register/template.xlsx?prefill=1&owner=${owner}`} download><Download size={14}/>지금 잔고를 엑셀로 받아 고치기</a></p>}
    <p className="form-help">{isCapture ? '사진은 이 컴퓨터에만 저장되고 Claude 비전이 표로 옮겨요. 숫자는 계산하지 않고 보이는 값만 옮기며, 어느 계좌인지는 다음 화면에서 확인해요.' : '첫 줄 위에 제목이 있어도 돼요. 숫자의 쉼표·원 표기는 알아서 떼요. 어느 계좌인지는 다음 화면에서 골라요.'}</p>
  </div>
}

export type AccountSuggestion = { label: string; owner: 'me' | 'partner'; broker: string; account_type: string }
export function NewAccount({ initial, onCancel, onCreated }: { initial: AccountSuggestion; onCancel?: () => void; onCreated: (id: string) => void | Promise<void> }) {
  // 확인 표(form) 안에 들어가므로 form을 겹치지 않는다 — 겹치면 버튼이 바깥 폼을 제출한다
  const [value, setValue] = useState<AccountSuggestion>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (patch: Partial<AccountSuggestion>) => setValue(v => ({ ...v, ...patch }))
  async function submit() {
    if (!value.label.trim()) { setError('계좌 이름을 넣어 주세요.'); return }
    setBusy(true); setError('')
    try {
      const created = await api<RegisterAccount>('/register/accounts', 'POST', { label: value.label.trim(), owner: value.owner, broker: value.broker, account_type: value.account_type })
      await onCreated(created.id)
    } catch (e) { setError(e instanceof Error ? e.message : '계좌를 추가하지 못했어요.') } finally { setBusy(false) }
  }
  return <div className="new-account" role="group" aria-label="새 계좌로 추가"><strong>새 계좌로 추가</strong><div className="form-grid"><label className="form-label">계좌 이름<input name="label" value={value.label} onChange={e => set({ label: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} placeholder="예: 미래에셋 연금저축(신)" maxLength={60} required/></label><label className="form-label">누구의 계좌<select name="owner" value={value.owner} onChange={e => set({ owner: e.target.value as 'me' | 'partner' })}><option value="me">나</option><option value="partner">배우자</option></select></label><label className="form-label">증권사<select name="broker" value={value.broker} onChange={e => set({ broker: e.target.value })}>{BROKERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label className="form-label">계좌 종류<select name="account_type" value={value.account_type} onChange={e => set({ account_type: e.target.value })}>{TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>{error && <div className="form-error" role="alert"><Info size={16}/>{error}</div>}<div className="button-row">{onCancel && <button type="button" className="secondary-button" onClick={onCancel}>취소</button>}<button type="button" className="primary-button" disabled={busy} onClick={submit}>{busy ? '추가 중…' : '계좌 추가'}</button></div><p className="form-help">계좌번호는 넣지 않아요. 연금저축·IRP는 노후 주머니, 나머지는 현금 주머니로 들어가요. 리밸런싱 묶음·전략은 설정에서 정해요.</p></div>
}
