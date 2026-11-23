import { NativeSelect } from '../components/ui/native-select'
import { Input } from '../components/ui/input'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { api } from '../local-data'
import { won, shares } from '@/lib/format'

type Account = { id: string; label: string }
type Order = { side: string; ticker?: string | null; ticker_name: string | null; account_id?: string; qty: number | null }
type RecordRow = { id: string; kind: 'trade' | 'hold'; event_date: string; recorded_at: string; account_label: string | null; side: string; ticker: string; name: string; qty: number; price: number; amount: number; note: string }
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const field = 'h-10 w-full min-w-0 rounded-md border border-grey-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2'

export function TradeJournal({ poolId, accounts, orders, disabled, orderToggle, sendButton }: { poolId: string; accounts: Account[]; orders: Order[]; disabled: boolean; orderToggle?: ReactNode; sendButton?: ReactNode }) {
  const [mode, setMode] = useState<'trade' | 'hold' | null>(null)
  const [date, setDate] = useState(today)
  const [account, setAccount] = useState(accounts[0]?.id ?? '')
  const [side, setSide] = useState('매수')
  const [ticker, setTicker] = useState('')
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [opened, setOpened] = useState(false)
  const [entries, setEntries] = useState<RecordRow[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const requestId = useRef<string | null>(null)
  const lock = useRef(false)
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])
  const load = async (offset = 0) => {
    setLoading(true); setHistoryError('')
    try {
      const result = await api<{ entries: RecordRow[]; next_offset: number | null }>(`/workbook/journal?pool_id=${encodeURIComponent(poolId)}&offset=${offset}`)
      setEntries(previous => offset ? [...previous, ...result.entries] : result.entries); setNext(result.next_offset)
    } catch(e) { setHistoryError(e instanceof Error ? e.message : '기록을 불러오지 못했어요.') }
    finally { setLoading(false) }
  }
  const open = (kind: 'trade' | 'hold') => { setMode(kind); setError(''); setNotice(''); setDate(today()); setQty(''); setPrice(''); setNote(''); setReason(''); setTicker(''); setName(''); setSide('매수'); setAccount(accounts[0]?.id ?? ''); requestId.current = null }
  const save = async () => {
    if (lock.current) return
    lock.current = true; setSaving(true); setError('')
    requestId.current ??= crypto.randomUUID()
    try {
      await api('/workbook/journal', 'POST', { request_id: requestId.current, pool_id: poolId, kind: mode, event_date: date,
        ...(mode === 'trade' ? { account_id: account, side, ticker, name, qty: Number(qty), price: Number(price), note } : { note: [reason, note].filter(Boolean).join(' · ') }) })
      setMode(null); setNotice(mode === 'trade' ? '실제 체결 내역을 저장했어요. 등록 잔고는 별도로 갱신해 주세요.' : '보류 사유를 저장했어요.')
      setOpened(false)
    } catch(e) { setError(e instanceof Error ? e.message : '저장 결과를 확인하지 못했어요. 기록을 확인한 뒤 다시 시도해 주세요.') }
    finally { lock.current = false; setSaving(false) }
  }
  return <>
    <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-3">
      {orderToggle}
      <button type="button" aria-expanded={opened} className="min-h-9 px-1 text-sm text-grey-600 underline underline-offset-4" onClick={() => { setOpened(!opened); if (!opened) void load() }}>날짜별 기록</button>
      <span className="hidden flex-1 lg:block"/>
      <Button variant="ghost" disabled={disabled || saving} onClick={() => open('hold')}>이번엔 보류</Button>
      <Button variant="outline" disabled={disabled || saving} onClick={() => open('trade')}>거래 내역 기록</Button>
      {sendButton}
    </div>
    {notice && <p role="status" className="text-sm text-grey-700">{notice}</p>}
    {opened && <section aria-label="날짜별 거래·보류 기록" className="rounded-md border border-grey-200 bg-white px-3 py-2">
      {historyError && <p role="alert" className="py-2 text-sm text-destructive">{historyError} <button className="underline" onClick={() => load()}>다시 불러오기</button></p>}
      {loading && <p role="status" className="py-2 text-sm text-grey-600">기록을 불러오는 중…</p>}
      {!loading && !historyError && entries.length === 0 && <p className="py-2 text-sm text-grey-600">아직 저장한 거래·보류 기록이 없어요.</p>}
      <ol className="divide-y divide-grey-200">{entries.map(r => <li key={r.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[100px_minmax(0,1fr)]">
        <time className="tabular-nums font-semibold" dateTime={r.event_date}>{r.event_date}</time>
        <div>{r.kind === 'trade' ? <><p className="font-semibold">{r.side} · {r.name} <span className="font-normal text-grey-600">{r.ticker}</span></p><p className="mt-1 tabular-nums">{shares(r.qty)} · 체결가 {won(r.price)} · 금액 {won(r.amount)}</p><p className="text-xs text-grey-600">{r.account_label} · 체결 기록 · 수수료·세금 제외</p></> : <p className="font-semibold">이번엔 보류</p>}
          {r.note && <p className="mt-1 break-words text-grey-700">{r.note}</p>}
          <p className="mt-1 text-xs text-grey-600">기록 시각 {new Date(r.recorded_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p>
        </div>
      </li>)}</ol>
      {next !== null && <Button variant="ghost" disabled={loading} onClick={() => load(next)}>이전 기록 더 보기</Button>}
    </section>}
    <Dialog open={mode !== null} onOpenChange={value => { if (!value && !saving) setMode(null) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>{mode === 'trade' ? '거래 내역 기록' : '이번엔 보류'}</DialogTitle><DialogDescription>{mode === 'trade' ? '증권사 체결 내역을 보고 입력해 주세요. 일부만 거래했다면 체결된 수량만 기록해요.' : '이번에 거래하지 않는 이유를 남겨요.'}</DialogDescription></DialogHeader>
        <form onSubmit={e => { e.preventDefault(); void save() }} onChange={() => { requestId.current = null }}>
          <fieldset disabled={saving} className="flex min-w-0 flex-col gap-3">
            <label className="text-sm">{mode === 'trade' ? '실제 거래일' : '보류일'}<Input type="date" required max={today()} value={date} onChange={e => setDate(e.target.value)} className={field}/></label>
            {mode === 'trade' ? <>
              {orders.length > 0 && <label className="text-sm">계획에서 종목 가져오기 <span className="text-grey-600">(선택)</span><NativeSelect className={field} defaultValue="" onChange={e => { const o=orders[Number(e.target.value)]; if (e.target.value && o) { setName(o.ticker_name ?? ''); setTicker(o.ticker ?? ''); setSide(o.side); if (o.account_id) setAccount(o.account_id) } }}><option value="">직접 입력</option>{orders.map((o,i) => <option key={i} value={i}>{o.side} · {o.ticker_name || '종목 미지정'}</option>)}</NativeSelect></label>}
              <div className="grid grid-cols-2 gap-3"><label className="min-w-0 text-sm">계좌<NativeSelect aria-label="체결 계좌" required value={account} onChange={e => setAccount(e.target.value)} className={field}>{accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</NativeSelect></label><label className="text-sm">매매 구분<NativeSelect aria-label="매매 구분" value={side} onChange={e => setSide(e.target.value)} className={field}><option>매수</option><option>매도</option></NativeSelect></label></div>
              <label className="text-sm">종목명<Input required maxLength={100} value={name} onChange={e => setName(e.target.value)} className={field}/></label>
              <label className="text-sm">종목코드<Input required maxLength={30} value={ticker} onChange={e => setTicker(e.target.value)} className={field}/></label>
              <div className="grid grid-cols-2 gap-3"><label className="text-sm">실제 체결 수량(주)<Input type="number" inputMode="numeric" required min={1} max={100000000} step={1} value={qty} onChange={e => setQty(e.target.value)} className={field}/></label><label className="text-sm">실제 체결가(원)<Input type="number" inputMode="numeric" required min={1} max={1000000000} step={1} value={price} onChange={e => setPrice(e.target.value)} className={field}/></label></div>
              <p className="text-xs text-grey-600">체결가가 다르면 나눠 기록해요. 기록만으로 전체 계획 완료나 잔고 갱신 처리는 하지 않아요.</p>
            </> : <label className="text-sm">보류 사유<NativeSelect aria-label="보류 사유" required className={field} value={reason} onChange={e => setReason(e.target.value)}><option value="">선택해 주세요</option>{['잔고·가격 확인 필요','자금 마련 후 진행','일정을 미룸','전략을 더 검토','기타'].map(r => <option key={r}>{r}</option>)}</NativeSelect></label>}
            <label className="text-sm">메모 <span className="text-grey-600">(선택)</span><textarea maxLength={400} rows={2} value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-md border border-grey-300 bg-white p-3 text-sm"/></label>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setMode(null)}>취소</Button><Button type="submit">{saving ? '저장 중…' : mode === 'trade' ? '체결 내역 저장' : '보류 기록 저장'}</Button></div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  </>
}
