import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Download, FileSpreadsheet, Camera, LayoutGrid, RefreshCw, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { api } from '../local-data'
import { AssetSheet } from '../sheet'
import { UploadFlow } from '../register'
import { ReadGrid, type Cell } from './ReadGrid'

// 첫 화면 — 엑셀 워크북 (2026-10-28 사용자 "처음부터 엑셀처럼", "먼저 엑셀 형태로 자산을 다 보여준 다음 다른 버전으로 보기").
// 시트: 요약 · 보유종목 · 자산 · 리밸런싱. 맨 위 한 줄 요약(서버 템플릿), 보고서 엑셀 내려받기. 숫자는 전부 서버 계산.

type Owner = 'together' | 'me' | 'partner'
type SheetKey = 'summary' | 'holdings' | 'assets' | 'rebalance'
const SHEETS: [SheetKey, string][] = [['summary', '요약'], ['holdings', '보유종목'], ['assets', '자산'], ['rebalance', '리밸런싱']]
const CLASS: Record<string, [string, string]> = { stock: ['주식', 'var(--cls-stock)'], long_bond: ['장기채', 'var(--cls-long-bond)'], mid_bond: ['중기채', 'var(--cls-mid-bond)'], gold: ['금', 'var(--cls-gold)'], commodity: ['원자재', 'var(--cls-commodity)'], cash: ['현금', 'var(--cls-cash)'], mixed: ['혼합·미분류', 'var(--grey-300)'] }
const OWNER_LABEL: Record<string, string> = { me: '나', partner: '배우자', joint: '공동' }

type Totals = { value: number; buy_value: number | null; total_return: number | null; total_rate: number | null; today_return: number | null; today_rate: number | null; count: number; cost_known: number }
type HAccount = Totals & { id: string; label: string; owner: string; as_of: string | null; stale: boolean; age_days: number | null }
type HRow = { account_id: string; asset_class: string | null; value: number }
type Pool = { pool_id: string; label: string; mode: string; strategy?: string; threshold_pp?: number; total_value?: number; new_cash?: number; new_cash_account?: string; accounts: { id: string; label: string }[]; as_of: string | null; error?: string; headline?: string; triggered?: boolean; blocked_reason?: string | null; notes?: string[]
  classes?: { asset_class: string; label: string; target: number; current: number; deviation_pp: number; value: number; over_threshold: boolean }[]
  orders?: { side: string; asset_class: string; account_id: string; ticker_name: string | null; qty: number | null; amount: number; note: string }[] }
type Summary = { line: string; dashboard: { net: number; total: number; debt: number; retirement: number; cash: number; property: number; financial: number }; holdings: { accounts: HAccount[]; holdings: HRow[]; total: Totals; live: boolean }; rebalance: { pools: Pool[] } }

export function Workbook({ onClassic }: { onClassic: () => void }) {
  const [sheet, setSheet] = useState<SheetKey>(() => { const h = location.hash.slice(1); return (SHEETS.find(s => s[0] === h)?.[0]) ?? 'summary' })
  const [owner, setOwner] = useState<Owner>('together')
  const [live, setLive] = useState(false)
  const [data, setData] = useState<Summary | null>(null)
  const [pools, setPools] = useState<Pool[] | null>(null)
  const [cash, setCash] = useState<Record<string, number>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [importMode, setImportMode] = useState<'capture' | 'file' | null>(null)
  const [rev, setRev] = useState(0)
  const [toast, setToast] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await api<Summary>(`/workbook/summary?owner=${owner}${live ? '&live=true' : ''}`)) }
    catch (e) { setError(e instanceof Error ? e.message : '불러오지 못했어요.') } finally { setLoading(false) }
  }, [owner, live])
  useEffect(() => { load() }, [load, rev])
  const loadPools = useCallback(async () => {
    try {
      const body = { owner, live, cash: Object.fromEntries(Object.entries(cash).filter(([, v]) => v > 0).map(([k, v]) => [k, { amount: v }])) }
      setPools((await api<{ pools: Pool[] }>('/workbook/rebalance', 'POST', body)).pools)
    } catch (e) { setError(e instanceof Error ? e.message : '리밸런싱을 계산하지 못했어요.') }
  }, [owner, live, cash])
  useEffect(() => { if (sheet === 'rebalance') loadPools() }, [sheet, loadPools, rev])
  useEffect(() => { history.replaceState(null, '', sheet === 'summary' ? location.pathname : `#${sheet}`) }, [sheet])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t) }, [toast])
  const changed = (msg: string) => { setToast(msg); setRev(r => r + 1) }

  const summaryRows = useMemo<Cell[][]>(() => {
    if (!data) return []
    const d = data.dashboard, h = data.holdings, t = h.total
    const rows: Cell[][] = []
    const pctOf = (v: number, base: number) => base ? v / base * 100 : 0
    rows.push([{ v: '우리 자산', section: true, span: 8 }])
    rows.push([{ v: '항목', head: true }, { v: '금액(원)', head: true }, { v: '비중', head: true }, { v: '', head: true, span: 5 }])
    rows.push([{ v: '순자산', bold: true }, { v: d.net, fmt: 'won', bold: true }, {}, { span: 5 }])
    rows.push([{ v: '총자산' }, { v: d.total, fmt: 'won' }, {}, { span: 5 }])
    rows.push([{ v: '대출' }, { v: d.debt, fmt: 'won' }, {}, { span: 5 }])
    rows.push([{ v: '노후 주머니' }, { v: d.retirement, fmt: 'won' }, { v: pctOf(d.retirement, d.financial), fmt: 'pct' }, { span: 5, bar: { pct: pctOf(d.retirement, d.financial), color: 'var(--cls-long-bond)' } }])
    rows.push([{ v: '현금 주머니' }, { v: d.cash, fmt: 'won' }, { v: pctOf(d.cash, d.financial), fmt: 'pct' }, { span: 5, bar: { pct: pctOf(d.cash, d.financial), color: 'var(--cls-cash)' } }])
    rows.push([{ v: '부동산' }, { v: d.property, fmt: 'won' }, {}, { span: 5 }])
    rows.push([{ span: 8 }])
    rows.push([{ v: `계좌별 종목 잔고${h.live ? ' · 현재가 반영' : ' · 등록한 잔고 기준'}`, section: true, span: 8 }])
    rows.push(['계좌', '소유자', '기준일', '평가금액', '넣은 돈', '불어난 돈', '수익률', h.live ? '오늘' : '비중'].map(v => ({ v, head: true })))
    for (const a of h.accounts) rows.push([{ v: a.label, tone: a.stale ? 'muted' : undefined }, { v: OWNER_LABEL[a.owner] ?? a.owner }, { v: a.as_of ? `${a.as_of}${a.stale ? ` (${a.age_days}일 전)` : ''}` : '—', tone: a.stale ? 'muted' : undefined },
      { v: a.value, fmt: 'won' }, { v: a.buy_value, fmt: 'won' }, { v: a.total_return, fmt: 'signed', tone: 'auto' }, { v: a.total_rate, fmt: 'pct', tone: 'auto' },
      h.live ? { v: a.today_return, fmt: 'signed', tone: 'auto' } : { v: pctOf(a.value, t.value), fmt: 'pct' }])
    if (h.accounts.length) rows.push([{ v: '합계', bold: true }, {}, {}, { v: t.value, fmt: 'won', bold: true }, { v: t.buy_value, fmt: 'won', bold: true }, { v: t.total_return, fmt: 'signed', tone: 'auto', bold: true }, { v: t.total_rate, fmt: 'pct', tone: 'auto', bold: true }, h.live ? { v: t.today_return, fmt: 'signed', tone: 'auto', bold: true } : { v: 100, fmt: 'pct' }])
    else rows.push([{ v: '등록한 종목 잔고가 없어요. 위 "가져오기"에서 사진이나 엑셀로 등록하세요.', span: 8, tone: 'muted' }])
    if (t.count && t.cost_known < t.count) rows.push([{ v: `넣은 돈·불어난 돈은 매입금액을 아는 ${t.cost_known}/${t.count}종목 기준이에요.`, span: 8, tone: 'muted' }])
    rows.push([{ span: 8 }])
    rows.push([{ v: '자산군 비중 (종목 잔고)', section: true, span: 8 }])
    rows.push([{ v: '자산군', head: true }, { v: '금액(원)', head: true }, { v: '비중', head: true }, { v: '', head: true, span: 5 }])
    const byCls = new Map<string, number>()
    h.holdings.forEach(r => byCls.set(r.asset_class ?? 'mixed', (byCls.get(r.asset_class ?? 'mixed') ?? 0) + r.value))
    ;[...byCls.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => rows.push([{ v: CLASS[k]?.[0] ?? k }, { v, fmt: 'won' }, { v: pctOf(v, t.value), fmt: 'pct' }, { span: 5, bar: { pct: pctOf(v, t.value), color: CLASS[k]?.[1] ?? 'var(--grey-300)' } }]))
    rows.push([{ span: 8 }])
    rows.push([{ v: '리밸런싱 판정', section: true, span: 8 }])
    rows.push([{ v: '묶음', head: true }, { v: '전략', head: true, span: 2 }, { v: '판정', head: true }, { v: '가장 큰 편차', head: true, span: 2 }, { v: '', head: true, span: 2 }])
    for (const p of data.rebalance.pools) {
      const worst = p.classes?.slice().sort((a, b) => Math.abs(b.deviation_pp) - Math.abs(a.deviation_pp))[0]
      rows.push([{ v: p.label }, { v: p.error ? '—' : p.strategy ?? '', span: 2 }, { v: p.error ? '계산 못 함' : p.triggered ? '조정 필요' : '범위 안', tone: p.triggered ? 'up' : 'muted', bold: !!p.triggered },
        { v: worst ? `${worst.label} ${worst.deviation_pp > 0 ? '+' : ''}${worst.deviation_pp.toFixed(1)}%p` : p.error ?? '', span: 2 }, { span: 2 }])
    }
    return rows
  }, [data])

  const rebalanceRows = useMemo<Cell[][]>(() => {
    if (!pools) return []
    const rows: Cell[][] = []
    for (const p of pools) {
      rows.push([{ v: `${p.label}${p.strategy ? ` · ${p.strategy}` : ''}`, section: true, span: 7 }])
      if (p.error) { rows.push([{ v: p.error, span: 7, tone: 'muted' }], [{ span: 7 }]); continue }
      rows.push([{ v: '총 평가액', bold: true }, { v: p.total_value ?? 0, fmt: 'won', bold: true }, { v: '이번 달 납입', head: true },
        { v: '', edit: { label: `${p.label} 이번 달 납입`, value: String(cash[p.pool_id] ?? ''), placeholder: '0', onCommit: v => setCash(c => ({ ...c, [p.pool_id]: Number(v) || 0 })) } },
        { v: `납입 계좌: ${p.accounts.find(a => a.id === p.new_cash_account)?.label ?? p.accounts[0]?.label}`, span: 2, tone: 'muted' }, { v: `임계 ±${p.threshold_pp}%p`, tone: 'muted' }])
      rows.push([{ v: p.headline ?? '', span: 7, bold: true, tone: p.triggered ? 'up' : undefined }])
      rows.push(['자산군', '목표', '현재', '편차', '판정', '평가금액(원)', ''].map(v => ({ v, head: true })))
      for (const c of p.classes ?? []) rows.push([{ v: c.label }, { v: c.target * 100, fmt: 'pct' }, { v: c.current * 100, fmt: 'pct' }, { v: c.deviation_pp, fmt: 'pp', tone: c.over_threshold ? (c.deviation_pp > 0 ? 'up' : 'down') : undefined, bold: c.over_threshold },
        { v: c.over_threshold ? '범위 밖' : '범위 안', tone: c.over_threshold ? undefined : 'muted' }, { v: c.value, fmt: 'won' }, { bar: { pct: c.current * 100, color: CLASS[c.asset_class]?.[1] ?? 'var(--grey-300)' } }])
      rows.push([{ span: 7 }])
      if (p.blocked_reason) rows.push([{ v: `주문표 보류: ${p.blocked_reason}`, span: 7, tone: 'muted' }])
      else if (p.orders?.length) {
        rows.push(['구분', '자산군', '종목', '수량', '금액(원)', '비고', ''].map(v => ({ v, head: true })))
        for (const o of p.orders) rows.push([{ v: o.side, bold: o.side !== '생략', tone: o.side === '매도' ? 'down' : o.side === '매수' ? 'up' : 'muted' }, { v: CLASS[o.asset_class]?.[0] ?? o.asset_class }, { v: o.ticker_name ?? '' },
          { v: o.qty ?? '금액만' }, { v: o.amount, fmt: 'won' }, { v: o.note, span: 2, tone: 'muted' }])
      } else rows.push([{ v: p.mode === 'buy_only' ? '매수만 계좌예요. "이번 달 납입"에 금액을 넣으면 살 종목이 계산돼요.' : '지금은 사고팔 것이 없어요.', span: 7, tone: 'muted' }])
      for (const n of p.notes ?? []) rows.push([{ v: `· ${n}`, span: 7, tone: 'muted' }])
      rows.push([{ span: 7 }])
    }
    return rows
  }, [pools, cash])

  return <div className="wb flex h-dvh flex-col bg-grey-100 text-grey-900">
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-grey-200 bg-white px-3 sm:gap-3 sm:px-4">
      <span className="shrink-0 whitespace-nowrap text-base font-semibold tracking-tight">둘이서은퇴</span>
      <span className="hidden text-xs text-grey-600 sm:inline">우리 자산.xlsx</span>
      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
        <Select value={owner} onValueChange={v => setOwner(v as Owner)}>
          <SelectTrigger size="sm" className="h-8 w-[92px] text-sm sm:w-[110px]" aria-label="누구의 자산"><SelectValue/></SelectTrigger>
          <SelectContent><SelectItem value="together">부부 전체</SelectItem><SelectItem value="me">나</SelectItem><SelectItem value="partner">배우자</SelectItem></SelectContent>
        </Select>
        <label className="hidden items-center gap-1.5 text-sm text-grey-700 md:flex"><Checkbox checked={live} onCheckedChange={v => setLive(v === true)}/>현재가 반영</label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-8 px-2.5 sm:px-3">가져오기<ChevronDown className="size-3.5"/></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => setImportMode('capture')}><Camera className="size-4"/>증권사 앱 캡처로 등록</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImportMode('file')}><FileSpreadsheet className="size-4"/>엑셀·CSV 파일 올리기</DropdownMenuItem>
            <DropdownMenuSeparator/>
            <DropdownMenuItem asChild><a href={`/api/register/template.xlsx?prefill=1&owner=${owner}`} download><Download className="size-4"/>지금 잔고를 엑셀로 받기</a></DropdownMenuItem>
            <DropdownMenuItem asChild><a href="/api/register/template.xlsx" download><Download className="size-4"/>빈 엑셀 양식 받기</a></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button asChild size="sm" className="h-8 px-2.5 sm:px-3"><a href={`/api/workbook/report.xlsx?owner=${owner}${live ? '&live=true' : ''}`} download aria-label="보고서 내려받기"><Download className="size-3.5"/><span className="hidden sm:inline">보고서 내려받기</span></a></Button>
        <Button variant="ghost" size="sm" className="h-8 px-2 text-grey-700" onClick={onClassic} aria-label="다른 버전으로 보기"><LayoutGrid className="size-3.5"/><span className="hidden lg:inline">다른 버전으로 보기</span></Button>
      </div>
    </header>

    <div className="flex shrink-0 items-start gap-2 border-b border-grey-200 bg-white px-4 py-2.5">
      <p className="min-w-0 flex-1 text-sm leading-relaxed text-grey-900" aria-live="polite">{loading && !data ? '불러오는 중…' : error ? <span className="text-destructive">{error}</span> : data?.line}</p>
      {loading && <RefreshCw className="mt-0.5 size-3.5 animate-spin text-grey-600"/>}
      {data && <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-grey-600" onClick={() => navigator.clipboard?.writeText(data.line).then(() => setToast('한 줄 요약을 복사했어요.')).catch(() => {})}><Copy className="size-3.5"/>복사</Button>}
    </div>

    <main className="flex min-h-0 flex-1 flex-col bg-white">
      {sheet === 'summary' && (data ? <ReadGrid label="요약 시트" widths={[220, 120, 110, 130, 130, 130, 90, 130]} rows={summaryRows}/> : <div className="p-6 text-sm text-grey-600">불러오는 중…</div>)}
      {sheet === 'holdings' && <AssetSheet key={`h-${owner}-${rev}`} owner={owner} initialTab="holdings" embedded onSaved={changed}/>}
      {sheet === 'assets' && <AssetSheet key={`a-${owner}-${rev}`} owner={owner} initialTab="assets" embedded onSaved={changed}/>}
      {sheet === 'rebalance' && (pools ? <ReadGrid label="리밸런싱 시트" widths={[200, 120, 110, 120, 110, 200, 240]} rows={rebalanceRows}/> : <div className="p-6 text-sm text-grey-600">계산하는 중…</div>)}
    </main>

    <nav className="flex h-9 shrink-0 items-stretch border-t border-grey-300 bg-grey-100 text-sm" role="tablist" aria-label="시트">
      {SHEETS.map(([k, l]) => <button key={k} role="tab" aria-selected={sheet === k} onClick={() => setSheet(k)}
        className={cn('border-r border-grey-300 px-5 text-grey-700 transition-colors hover:bg-white', sheet === k && 'bg-white font-semibold text-sheet-select shadow-[inset_0_-2px_0_var(--sheet-select)]')}>{l}</button>)}
      <span className="ml-auto hidden items-center px-4 text-xs text-grey-600 md:flex">{sheet === 'rebalance' ? '이번 달 납입 칸에 금액을 넣으면 다시 계산해요' : sheet === 'summary' ? '숫자는 등록한 잔고와 장부로 계산했어요' : '칸을 눌러 바로 고치고, 엑셀에서 복사해 붙여 넣어도 돼요'}</span>
    </nav>

    <Dialog open={importMode !== null} onOpenChange={o => { if (!o) setImportMode(null) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{importMode === 'capture' ? '증권사 앱 캡처로 등록' : '엑셀·CSV 파일 올리기'}</DialogTitle></DialogHeader>
        {importMode && <UploadFlow mode={importMode} owner={owner} onSaved={msg => { setImportMode(null); changed(msg) }}/>}
      </DialogContent>
    </Dialog>
    {toast && <div role="status" className="fixed bottom-14 left-1/2 z-50 -translate-x-1/2 rounded-md bg-grey-900 px-4 py-2 text-sm text-white">{toast}</div>}
  </div>
}
