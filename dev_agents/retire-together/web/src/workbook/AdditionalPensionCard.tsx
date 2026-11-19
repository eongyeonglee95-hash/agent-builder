import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { api } from '../local-data'
import { manwon, won } from '@/lib/format'
import { Button } from '@/components/ui/button'

export type AdditionalPension = { id: string; name: string; account: string; amount: number; owner: string }
type Plan = { version: number; monthly: number | null; day: number | null; end_date: string | null; payout_date: string | null; expected_monthly: number | null; status: 'active' | 'paused' | 'complete'; note: string }
type Entry = { request_id: string; event_date: string; amount: number; note: string; recorded_at: string }
type Data = { plan: Plan; next_date: string | null; entries: Entry[] }
const field = 'mt-1 h-9 w-full min-w-0 rounded-md border border-grey-300 bg-white px-2 text-sm'
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const optionalNumber = (form: FormData, key: string) => form.get(key) === '' ? null : Number(form.get(key))

export function AdditionalPensionCard({ asset, index }: { asset: AdditionalPension; index: number }) {
  const [data, setData] = useState<Data | null>(null)
  const [mode, setMode] = useState<'plan' | 'payment' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const requestId = useRef<string | null>(null)
  const url = `/workbook/additional-pensions/${encodeURIComponent(asset.id)}`
  const load = async () => setData(await api<Data>(url))
  useEffect(() => { let active = true; setData(null); setError(''); api<Data>(url).then(value => { if (active) setData(value) }).catch(e => { if (active) setError(String(e.message || e)) }); return () => { active = false } }, [url])
  const open = async (next: 'plan' | 'payment') => { setError(''); setNotice(''); requestId.current = null; try { await load(); setMode(next) } catch(e) { setError(e instanceof Error ? e.message : '납입 정보를 불러오지 못했어요.') } }
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (lock.current || !data) return
    const form = new FormData(event.currentTarget)
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      if (mode === 'plan') {
        await api(url, 'PUT', { version: data.plan.version, monthly: optionalNumber(form, 'monthly'), day: optionalNumber(form, 'day'), end_date: form.get('end_date') || null, payout_date: form.get('payout_date') || null, expected_monthly: optionalNumber(form, 'expected_monthly'), status: form.get('status'), note: form.get('note') })
        setNotice('납입 정보를 저장했어요.')
      } else {
        requestId.current ??= crypto.randomUUID()
        await api(`${url}/payments`, 'POST', { request_id: requestId.current, event_date: form.get('event_date'), amount: Number(form.get('amount')), note: form.get('note') })
        setNotice('납입 기록을 저장했어요. 등록 적립금은 그대로 유지됩니다.')
      }
      setMode(null); await load()
    } catch(e) { setError(e instanceof Error ? e.message : '저장 결과를 확인하지 못했어요. 다시 확인해 주세요.') }
    finally { lock.current = false; setBusy(false) }
  }
  const plan = data?.plan
  const ended = !!plan?.end_date && plan.end_date < today()
  const status = plan?.status === 'complete' ? '납입 완료' : plan?.status === 'paused' ? '납입 중지' : ended ? '납입기간 종료' : '정기 납입'
  const missing = error && !data ? '확인 필요' : data ? '미입력' : '불러오는 중'
  return <section aria-label={asset.name} style={{ '--a': `var(--acct-${index % 4 + 1})`, '--a-tint': `var(--acct-${index % 4 + 1}-tint)` } as CSSProperties} className="grid overflow-hidden rounded-2xl bg-[var(--a-tint)] md:grid-cols-[168px_minmax(0,1fr)]">
    <header className="border-b border-black/10 bg-white/40 px-4 py-3 md:border-b-0 md:border-r"><h4 className="break-words text-sm font-semibold text-[var(--a)]">{asset.name}</h4><p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{manwon(asset.amount)}</p><p className="mt-1 text-xs text-grey-600">등록 적립금 · {asset.owner === 'me' ? '나' : '배우자'}</p><p className="mt-3 text-sm font-semibold">{status}</p></header>
    <div className="min-w-0 px-4 py-3">
      <dl className="grid gap-3 sm:grid-cols-3"><div><dt className="text-xs text-grey-600">월 납입액</dt><dd className="mt-1 text-xl font-bold tabular-nums">{plan?.monthly == null ? missing : won(plan.monthly)}</dd></div><div><dt className="text-xs text-grey-600">다음 납입 예정일</dt><dd className="mt-1 text-sm font-semibold">{data?.next_date ?? (plan && (plan.status !== 'active' || ended) ? '예정 없음' : missing)}</dd>{plan?.day && <p className="mt-1 text-xs text-grey-600">매월 {plan.day}일 · 월말 초과 시 말일</p>}</div><div><dt className="text-xs text-grey-600">납입 종료일</dt><dd className="mt-1 text-sm font-semibold">{plan?.end_date || missing}</dd></div></dl>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-black/10 pt-3"><Button size="sm" variant="outline" disabled={busy} onClick={() => void open('plan')}>납입 정보 수정</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void open('payment')}>납입 기록</Button></div>
      {notice && <p role="status" className="mt-2 text-sm">{notice}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      {mode && data && <form onSubmit={save} onChange={() => { requestId.current = null }} className="mt-3 border-t border-black/10 pt-3" aria-label={mode === 'plan' ? '납입 정보 수정' : '납입 기록 입력'}>
        <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-3">
          {mode === 'plan' ? <>
            <label className="text-xs">월 납입액 (원)<input className={field} type="number" name="monthly" min="0" max="10000000000" step="1" defaultValue={plan?.monthly ?? ''}/></label>
            <label className="text-xs">매월 납입일<input className={field} type="number" name="day" min="1" max="31" step="1" defaultValue={plan?.day ?? ''}/></label>
            <label className="text-xs">납입 종료일<input className={field} type="date" name="end_date" defaultValue={plan?.end_date ?? ''}/></label>
            <label className="text-xs">수령 시작일<input className={field} type="date" name="payout_date" defaultValue={plan?.payout_date ?? ''}/></label>
            <label className="text-xs">계약상 예상 월 연금 (원)<input className={field} type="number" name="expected_monthly" min="0" max="10000000000" step="1" defaultValue={plan?.expected_monthly ?? ''}/></label>
            <label className="text-xs">납입 상태<select className={field} name="status" defaultValue={plan?.status}><option value="active">납입 중</option><option value="paused">납입 중지</option><option value="complete">납입 완료</option></select></label>
          </> : <>
            <label className="text-xs">납입한 날짜<input className={field} name="event_date" type="date" max={today()} defaultValue={today()} required/></label>
            <label className="text-xs">실제 납입액 (원)<input className={field} name="amount" type="number" min="1" max="10000000000" step="1" defaultValue={plan?.monthly ?? ''} required/></label>
          </>}
          <label className="text-xs sm:col-span-3">{mode === 'plan' ? '계약 조건 메모' : '메모'}<input className={field} name="note" maxLength={mode === 'plan' ? 1000 : 500} defaultValue={mode === 'plan' ? plan?.note : ''}/></label>
          <div className="flex gap-2 sm:col-span-3"><Button size="sm" type="submit">{busy ? '저장 중…' : '저장'}</Button><Button size="sm" variant="ghost" type="button" onClick={() => setMode(null)}>취소</Button></div>
        </fieldset>
      </form>}
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <details><summary className="cursor-pointer py-1 font-semibold">수령 계획·계약 조건</summary><div className="mt-2 space-y-1 text-grey-700"><div>수령 시작일 · {plan?.payout_date || '미입력'}</div><div>계약상 예상 월 연금 · {plan?.expected_monthly == null ? '미입력' : won(plan.expected_monthly)}</div><div className="break-words">{plan?.note || '등록한 계약 조건 없음'}</div></div><p className="mt-2 text-grey-600">계약 정보 기록용 · 연금 전체의 계산 가정은 별도 설정</p></details>
        <details><summary className="cursor-pointer py-1 font-semibold">날짜별 납입 내역 {data?.entries.length ? `· ${data.entries.length}건` : ''}</summary><ul className="mt-2 divide-y divide-black/10">{data?.entries.map(e => <li key={e.request_id} className="py-2"><div className="flex justify-between gap-2 tabular-nums"><time>{e.event_date}</time><b>{won(e.amount)}</b></div>{e.note && <p className="mt-1 break-words text-grey-600">{e.note}</p>}</li>)}</ul>{data && !data.entries.length && <p className="mt-2 text-grey-600">아직 기록한 납입이 없어요.</p>}{data?.entries.length === 100 && <p>최근 100건 표시</p>}</details>
      </div>
    </div>
  </section>
}
