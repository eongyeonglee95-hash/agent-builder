import './linked-ledger.css'
import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../local-data'
import { Button } from '@/components/ui/button'
import { ReadGrid, type Cell } from './ReadGrid'

type Table = { rows: (string | number)[][]; headers: number[]; summary: (string | number)[][]; keys?: string[][]; editable?: Record<number, string>[] }
type Ledger = { revision: string; spreadsheet_id: string; tabs: Record<string, Table>; sheet_ids: Record<string, number>; pending: { cell: string; before: unknown; after: unknown }[]; issue: string }
export const LINKED_TABS = { summary: '우리 자산', holdings: '보유 종목', assets: '자산 내역', pension: '연금', stocks: '주식', property: '부동산', cash: '현금·기타' } as const

export function LinkedLedger({ tab, rev, onChanged, onEdit }: { tab: keyof typeof LINKED_TABS; rev: number; onChanged: (message: string) => void; onEdit?: () => void }) {
  const [data, setData] = useState<Ledger | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const title = LINKED_TABS[tab]
  const load = useCallback(async () => { setError(''); try { setData(await api<Ledger>('/shared-data/ledger')) } catch (e) { setError((e as Error).message) } }, [])
  useEffect(() => { void load() }, [load, rev])
  const context = () => ({ operation_id: crypto.randomUUID(), expected_revision: data!.revision, expected_spreadsheet_id: data!.spreadsheet_id })
  async function sync() {
    if (!data || busy) return
    setBusy(true); setError('')
    try { const result = await api<{ changed?: number }>('/shared-data/ledger/sync', 'POST', context()); await load(); window.dispatchEvent(new Event('retire:holdings-changed')); onChanged(result.changed ? `시트에서 수정한 ${result.changed}개 값을 반영했어요.` : '시트와 앱의 자료가 같아요.') }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function edit(row: number, column: number, value: string) {
    if (!data || busy) return
    const table = data.tabs[title]; const field = table.editable?.[row]?.[column]
    if (!field) return
    const numeric = ['amount', 'qty', 'price', 'buy_value'].includes(field)
    const parsed = numeric ? value.trim() === '' ? null : Number(value.replaceAll(',', '')) : value
    if (numeric && parsed !== null && (!Number.isSafeInteger(parsed) || Number(parsed) < 0)) { setError('0 이상의 정수를 입력해 주세요.'); return }
    if ((parsed ?? '') === table.rows[row+2][column]) return
    setBusy(true); setError('')
    try { await api('/shared-data/ledger/edit', 'POST', { ...context(), tab: title, row_id: table.keys![row].join(':'), column, value: parsed }); await load(); window.dispatchEvent(new Event('retire:holdings-changed')); onChanged('앱과 구글 시트에 저장했어요.') }
    catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const table = data?.tabs[title]
  const rows: Cell[][] = table?.rows.map((row, r) => row.map((v, c) => ({ v, fmt: typeof v === 'number' ? 'won' : 'text', head: table.headers.includes(r), section: r === 0,
    ...(r === 0 ? { span: table.rows[1]?.length ?? 8 } : {}),
    ...(r >= 2 && table.editable?.[r-2]?.[c] && !busy && !data?.pending.length && !data?.issue ? { edit: { value: String(v ?? ''), text: !['amount', 'qty', 'price', 'buy_value'].includes(table.editable[r-2][c]), label: String(table.rows[1][c]), onCommit: (value: string) => void edit(r-2, c, value) } } : {})
  }))) ?? []
  return <section className="linked-ledger flex min-h-0 flex-1 flex-col" aria-label={`${title} · 연결된 구글 시트`}>
    <div className="flex flex-wrap items-center gap-2 border-b border-grey-200 px-4 py-3 text-sm">
      <span className="mr-auto text-grey-700">구글 시트와 같은 장부 · 부부 전체 · 금액 단위 원</span>
      <Button variant="outline" size="sm" disabled={busy || !data} onClick={() => void sync()}><RefreshCw className="size-4"/>{busy ? '반영 중…' : '시트 변경 불러오기'}</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void load()}>새로고침</Button>
      {onEdit && <Button variant="outline" size="sm" onClick={onEdit}>행 추가·상세 편집</Button>}
      {data && <a className="inline-flex items-center gap-1 text-sm underline underline-offset-4" href={`https://docs.google.com/spreadsheets/d/${data.spreadsheet_id}/edit#gid=${data.sheet_ids[title] ?? 1701000}`} target="_blank" rel="noreferrer">같은 시트 열기<ExternalLink size={14}/></a>}
    </div>
    {(error || data?.issue) && <p role="alert" className="border-b border-grey-200 px-4 py-3 text-sm text-destructive">{error || data?.issue}</p>}
    {!!data?.pending.length && <p role="status" className="bg-input-soft px-4 py-3 text-sm">구글 시트에서 바뀐 값 {data.pending.length}개가 있어요. ‘시트 변경 불러오기’를 누르면 계산과 자산 현황에 반영됩니다.</p>}
    {!!table?.summary.length && <div className="flex flex-wrap gap-x-8 gap-y-2 border-b border-grey-200 px-4 py-3 text-sm">{table.summary.slice(1,4).map(([label, value]) => <span key={label}>{label} <strong className="ml-2 tabular-nums">{typeof value === 'number' ? value.toLocaleString('ko-KR') : value}원</strong></span>)}</div>}
    {table ? <ReadGrid label={`${title} 시트`} widths={title === '보유 종목' ? [190,170,100,110,120,120,110,140,120,120,150] : title === '자산 내역' ? [190,170,100,110,120,120,110,140,150] : [300,120,290,135,150,160,160,145]} rows={rows}/> : <p role="status" className="p-4 text-sm">{error ? '자료를 불러오지 못했어요.' : '연결된 시트를 불러오는 중…'}</p>}
    <p className="border-t border-grey-200 px-4 py-2 text-xs text-grey-600">{title === '자산 내역' && '계좌와 세부 자산이 함께 표시됩니다. 총액은 우리 자산에서 확인해 주세요. '}{table?.editable ? '입력 칸은 앱에서 바로 수정할 수 있어요. 시트의 연한 노란색 칸도 같은 항목입니다. 행 추가·삭제와 분류 변경은 상세 편집에서 해 주세요.' : '자산 내역과 보유 종목으로 계산한 표입니다. 수정은 해당 입력 탭에서 해 주세요.'}</p>
  </section>
}
