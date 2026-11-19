import type { Outlook } from './RetirementOutlook'
import { SecuritiesReport, type ReportAccount, type ResearchNote, type PortfolioExhibit } from './SecuritiesReport'
import { AllocationReport, type AllocationAnalysis } from './AllocationReport'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { api } from '../local-data'
import { manwon } from '@/lib/format'

type Schedule = { enabled: boolean; period: 'month' | 'quarter' | 'half' | 'custom'; days: number; first_date: string; notify: boolean }
type Comparison = { id: string; name: string; error?: string; plan?: { reduce_total: number; increase_total: number; title?: string; title_head?: string; title_tail?: string; kind: string; targets: { label: string; target_pct: number }[] } }
type Report = { portfolio?: PortfolioExhibit; household?: { retirement_outlook?: Outlook }; created_at: string; research?: ResearchNote[]; source: string; scope: string; limitations: string; ai_text: string | null; ai_status: string; ai_report?: AllocationAnalysis | null; generation?: { cache_hit: boolean; source_changes?: string[]; previous_headline?: string | null }; prompt_version?: string; ai_error?: string | null; ai_provider?: string; notification: string | null; accounts: (ReportAccount & { label: string; strategy: string; mode: string; as_of?: string; findings: string[]; comparisons: Comparison[] })[] }
type ReviewState = { config: Schedule | null; next_date: string | null; running: string | null; report: Report | null; error: string | null }
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const initial = (): Schedule => ({ enabled: false, period: 'month', days: 30, first_date: today(), notify: false })
const periods = { month: '매월', quarter: '분기마다', half: '반기마다', custom: '직접 설정' }

export function usePensionReview() {
  const [state, setState] = useState<ReviewState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const refresh = useCallback(async () => {
    try { setState(await api<ReviewState>('/workbook/review')); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : '점검 상태를 불러오지 못했어요.') }
  }, [])
  useEffect(() => { void refresh(); const timer = window.setInterval(refresh, state?.running ? 3000 : 60000); return () => clearInterval(timer) }, [refresh, !!state?.running])
  const action = async (path: string, method: string, body?: unknown) => {
    if (lock.current) return false
    lock.current = true; setBusy(true); setError('')
    try { setState(await api<ReviewState>(path, method, body)); return true }
    catch (e) { setError(e instanceof Error ? e.message : '요청하지 못했어요. 다시 시도해 주세요.'); return false }
    finally { lock.current = false; setBusy(false) }
  }
  return { state, error, busy, refresh, action }
}
type Review = ReturnType<typeof usePensionReview>

export function ReviewSettings({ review, summary }: { review: Review; summary?: string }) {
  const { state, error, busy, action } = review
  const [draft, setDraft] = useState<Schedule>(initial)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (state?.config && !editing) setDraft(state.config) }, [state?.config, editing])
  const running = !!state?.running
  const inputClass = 'h-10 min-w-0 rounded-md border border-grey-300 bg-white px-3 text-sm text-grey-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grey-900'
  return <section aria-label="연금 리밸런싱 및 점검 설정" className="border-b border-grey-200 pb-3">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h2 className="shrink-0 text-xl font-bold">연금 리밸런싱</h2>
      {summary && <p className="text-sm text-grey-600">{summary}</p>}
      <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-grey-700">
          <span>{state?.config?.enabled ? (state.config.period === 'custom' ? `${state.config.days}일마다 점검` : `${periods[state.config.period]} 점검`) : '자동 점검 꺼짐'}</span>
          {state?.next_date && <time dateTime={state.next_date} className="whitespace-nowrap text-grey-600">· 다음 {state.next_date.replaceAll('-', '.')}</time>}
        </p>
        <div className="flex items-center gap-1">
          <Button variant="ghost" disabled={!state || busy || running} aria-expanded={editing} onClick={() => { setEditing(v => !v); setSaved(false) }}>주기 설정<ChevronDown aria-hidden="true" className="size-4"/></Button>
          <Button disabled={!state || busy || running} onClick={() => action('/workbook/review/run', 'POST', {})}>{running && <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none"/>}{running ? '점검 중…' : '지금 점검'}</Button>
        </div>
      </div>
    </div>
    {editing && <form className="mt-4 flex flex-col gap-3 border-t border-grey-200 pt-4" onSubmit={async e => { e.preventDefault(); if (await action('/workbook/review/schedule', 'PUT', draft)) { setEditing(false); setSaved(true) } }}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-grey-700">점검 주기<select className={inputClass} value={draft.period} onChange={e => setDraft({ ...draft, period: e.target.value as Schedule['period'] })}>{Object.entries(periods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {draft.period === 'custom' && <label className="flex flex-col gap-1 text-sm text-grey-700">간격(일)<input type="number" min={1} max={365} required className={`${inputClass} w-24`} value={draft.days} onChange={e => setDraft({ ...draft, days: Number(e.target.value) })}/></label>}
        <label className="flex flex-col gap-1 text-sm text-grey-700">첫 / 다음 점검일<input type="date" required min={today()} className={inputClass} value={draft.first_date} onChange={e => setDraft({ ...draft, first_date: e.target.value })}/></label>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })}/>자동 점검 켜기</label>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={draft.notify} onChange={e => setDraft({ ...draft, notify: e.target.checked })}/>정기 점검 요약을 텔레그램으로 받기</label>
        <Button type="submit" disabled={busy || running}>{busy ? '저장 중…' : '설정 저장'}</Button>
      </div>
      <p className="text-xs text-grey-600">한국 시간 기준 · 서버가 켜져 있을 때 실행해요. 놓친 일정은 다시 켰을 때 한 번 점검해요. 수동 점검은 화면에만 표시해요.</p>
    </form>}
    {saved && <p role="status" className="mt-2 text-sm text-grey-700">점검 설정을 저장했어요.</p>}
    {running && <p role="status" className="mt-2 text-sm text-grey-600">잔고와 세 전략을 비교하고 있어요. AI 설명은 최대 2분 정도 걸릴 수 있어요.</p>}
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error} <button className="underline" onClick={review.refresh}>다시 불러오기</button></p>}
  </section>
}

function AIExplanation({ text }: { text: string }) {
  const plain = text.replace(/\*\*(.*?)\*\*/g, '$1')
  return <div className="text-sm leading-relaxed text-grey-800">
    <p className="max-w-prose whitespace-pre-line">{plain.length > 320 ? `${plain.slice(0, 320)}…` : plain}</p>
    {plain.length > 320 && <details className="mt-2"><summary className="cursor-pointer py-1 font-semibold underline underline-offset-4">AI 상세 설명 · 전략별 차이와 할 일</summary><p className="mt-2 max-w-prose whitespace-pre-line">{plain}</p></details>}
  </div>
}

export function ReviewReport({ review }: { review: Review }) {
  const report = review.state?.report
  return <section aria-labelledby="pension-report-title" className="mt-3 rounded-lg border border-grey-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-grey-200 px-4 py-3 sm:px-5">
      <h3 id="pension-report-title" className="flex items-center gap-2 text-lg font-bold"><FileText aria-hidden="true" className="size-5 text-grey-600"/>연금 운용 리포트</h3>
      {report && <span className="text-xs tabular-nums text-grey-600">최근 점검 {new Date(report.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>}
    </div>
    {review.state?.error && <p role="alert" className="px-4 pt-3 text-sm text-destructive">{review.state.error}{report && ' 아래는 이전 보고서예요.'}</p>}
    {!report ? <div className="px-4 py-5 sm:px-5"><p className="text-sm font-semibold">내 계좌의 문제점부터 전략별 차이까지</p><p className="mt-1 text-sm leading-relaxed text-grey-600">상단의 ‘지금 점검’을 누르면 목표 비중 이탈, 잔고 확인 사항, 세 전략 비교와 이번에 할 일을 정리해요.</p><p className="mt-3 text-xs text-grey-600">책 캡처 근거는 아직 연결되지 않았어요. 지금은 등록한 전략 규칙으로 점검해요.</p></div>
    : <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
      <p className="text-xs text-grey-600">{report.scope}{report.generation?.cache_hit && ' · 동일 자료의 기존 평가'}</p>
      {report.research && report.ai_error && <p role="status" className="text-sm text-grey-600">{report.ai_error} 배분·상품·실행표는 계산 결과로 표시해요.</p>}
      {report.research ? <SecuritiesReport createdAt={report.created_at} analysis={report.ai_report} accounts={report.accounts} research={report.research} outlook={report.household?.retirement_outlook} portfolio={report.portfolio}/> : report.ai_report ? <AllocationReport analysis={report.ai_report}/> : <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div><h4 className="mb-2 text-sm font-bold">전체 진단</h4>
          {report.ai_text ? <AIExplanation text={report.ai_text}/>
            : <p className="text-sm leading-relaxed text-grey-600">{report.ai_error || 'AI 설명을 완료하지 못했어요.'} 계산 엔진의 점검 결과는 오른쪽과 아래에서 확인할 수 있어요. 상단에서 다시 점검할 수 있어요.</p>}
        </div>
        <div><h4 className="mb-2 text-sm font-bold">계좌별 확인할 사항</h4>
          {report.accounts.length === 0 && <p className="text-sm text-grey-600">등록된 리밸런싱 묶음이 없어요. 계좌와 잔고를 먼저 등록해 주세요.</p>}
          <div className="divide-y divide-grey-200">{report.accounts.map(a => <div key={a.label} className="py-2 first:pt-0"><p className="text-sm font-semibold">{a.label.split(' — ')[0]} <span className="font-normal text-grey-600">· {a.strategy}</span></p><ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-relaxed text-grey-700">{a.findings.slice(0, 3).map((f, i) => <li key={i}>{f}</li>)}</ul></div>)}</div>
        </div>
      </div>}
      <details className="border-t border-grey-200 pt-3"><summary className="cursor-pointer py-1 text-sm font-semibold focus-visible:outline-2">세 전략 비교 · 계산 근거 보기</summary>
        <p className="mt-2 text-xs text-grey-600">같은 잔고·추가 납입 없이 비교해요. ‘사기만’ 계좌는 세 전략 모두 매도하지 않는 조건이에요. 금액은 등록 가격 기준이며 전략 순위가 아니에요.</p>
        {report.accounts.map(a => <div key={a.label} className="mt-4"><h4 className="mb-2 text-sm font-semibold">{a.label.split(' — ')[0]} <span className="font-normal text-grey-600">· 잔고 {a.as_of || '기준일 미확인'}</span></h4>
          <div className="divide-y divide-grey-200 rounded-md border border-grey-200">{a.comparisons.map(c => <div key={c.id} className="grid gap-1 px-3 py-3 text-sm sm:grid-cols-[120px_minmax(0,1fr)_auto]"><b className="font-semibold">{c.name}</b>{c.error ? <span className="text-grey-600 sm:col-span-2">{c.error}</span> : <><span className="text-grey-600">{c.plan?.targets.map(t => `${t.label} ${t.target_pct}%`).join(' · ')}</span><span className="tabular-nums">팔기 {manwon(c.plan?.reduce_total ?? 0)} · 사기 {manwon(c.plan?.increase_total ?? 0)}</span><span className="text-xs text-grey-600 sm:col-start-2 sm:col-span-2">{c.plan?.title || `${c.plan?.title_head ?? ''} ${c.plan?.title_tail ?? ''}`}</span></>}</div>)}</div>
          {a.findings.length > 3 && <ul className="mt-2 list-disc pl-4 text-sm text-grey-600">{a.findings.slice(3).map((f, i) => <li key={i}>{f}</li>)}</ul>}
        </div>)}
      </details>
      <details className="border-t border-grey-100 pt-3 text-xs text-grey-600"><summary className="cursor-pointer">자료 출처와 평가 범위</summary><p className="mt-2 leading-relaxed">{report.prompt_version && <>평가 기준 {report.prompt_version}<br/></>}{report.generation?.source_changes?.length ? <>이전 평가 이후 입력 변경: {report.generation.source_changes.join(', ')}<br/></> : null}{report.generation?.previous_headline && <>이전 핵심 판단: {report.generation.previous_headline}<br/></>}{report.source}<br/>{report.limitations}{report.notification && <><br/>{report.notification}</>}</p></details>
    </div>}
  </section>
}
