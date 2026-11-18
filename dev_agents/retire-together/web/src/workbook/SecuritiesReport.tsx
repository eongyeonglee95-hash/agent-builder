import { RetirementOutlook, type Outlook } from './RetirementOutlook'
import { useState } from 'react'
import { ArrowRight, ExternalLink } from 'lucide-react'
import { manwon, pct, shares } from '@/lib/format'
import { AllocationReport, type AllocationAnalysis } from './AllocationReport'

type Mix = { asset_class: string; label: string; current_pct: number; target_pct: number; sell: number; buy: number }
type Product = { asset_class: string; role: string; name: string; ticker: string; position: string; reason: string; structure: string | null; mapping_confirmed: boolean; check: string; source: string }
type Order = { side: string; name: string; ticker: string | null; account: string; qty: number | null; amount: number; status: string; note: string | null }
export type ReportAccount = { label: string; strategy: string; mode: string; as_of?: string; total_value?: number; findings: string[]; products?: Product[]; orders?: Order[]; plan?: { mix?: Mix[]; kind: string; reduce_total: number; increase_total: number; leftover: number; line?: string } }
export type PortfolioExhibit = { total_value: number; account_count: number; dates: string[]; mix: Mix[] }
export type ResearchNote = { title: string; publisher: string; published: string; reviewed: string; url: string; finding: string; application: string }
const color = (key: string) => `var(--cls-${key.replaceAll('_', '-')})`
const percent = (value: number) => pct(value, { signed: false, digits: 1 })
const short = (value: string) => value.split(' — ')[0]

function AllocationExhibit({ rows }: { rows: Mix[] }) {
  if (!rows.length) return <p className="py-6 text-sm text-grey-600">잔고를 등록하면 현재·목표 배분을 비교할 수 있어요.</p>
  return <div>
    <div className="mb-4 flex items-center gap-4 text-xs text-grey-600"><span className="flex items-center gap-1.5"><i className="h-2 w-5 bg-grey-700" aria-hidden="true"/>현재</span><span className="flex items-center gap-1.5"><i className="h-2 w-5 border border-grey-400" aria-hidden="true"/>선택 전략 목표</span></div>
    <div className="space-y-4">{rows.map(row => <div key={row.asset_class} className="grid grid-cols-[64px_minmax(0,1fr)_100px] items-center gap-3 sm:grid-cols-[88px_minmax(0,1fr)_116px]">
      <span className="text-sm font-semibold" title={row.label}>{row.label.split(' (')[0]}</span>
      <div className="flex flex-col gap-1.5" role="img" aria-label={`${row.label} 현재 ${percent(row.current_pct)}, 목표 ${percent(row.target_pct)}`}>
        <div className="h-2.5 bg-grey-100"><div className="h-full" style={{ width: `${row.current_pct}%`, background: color(row.asset_class) }}/></div>
        <div className="h-2.5 bg-grey-100"><div className="h-full border" style={{ width: `${row.target_pct}%`, borderColor: color(row.asset_class) }}/></div>
      </div>
      <span className="text-right text-xs tabular-nums text-grey-600">{percent(row.current_pct)} → <b className="font-semibold text-grey-900">{percent(row.target_pct)}</b></span>
    </div>)}</div>
  </div>
}

export function SecuritiesReport({ analysis, accounts, research, outlook, portfolio }: { portfolio?: PortfolioExhibit; outlook?: Outlook; analysis?: AllocationAnalysis | null; accounts: ReportAccount[]; research: ResearchNote[] }) {
  const [copyNotice, setCopyNotice] = useState('')
  const copy = async (ticker: string) => { try { await navigator.clipboard.writeText(ticker); setCopyNotice(`${ticker} 복사했어요.`) } catch { setCopyNotice('복사하지 못했어요. 코드를 직접 선택해 주세요.') } }
  return <article className="mx-auto max-w-5xl border border-grey-200 bg-white px-4 py-6 text-grey-900 shadow-sm sm:px-10 sm:py-10">
    <p className="mb-3 border-t-4 border-grey-900 pt-3 text-xs font-semibold tracking-widest text-grey-600">둘이서은퇴 · 연금 운용 보고서</p>
    <header className="pb-2">
      <h4 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">연금 준비 현황</h4>
    </header>
    {!!portfolio?.mix.length && <section className="my-6 border-y border-grey-300 py-5">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-xl font-bold">연금 포트폴리오 진단</h4><span className="text-xs text-grey-600">등록 {portfolio.account_count}개 계좌 · {manwon(portfolio.total_value)}</span></div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div><AllocationExhibit rows={portfolio.mix}/><p className="mt-4 text-xs text-grey-600">선택 전략을 계좌 잔고로 가중한 목표 · ETF 내부 구성 미반영</p><p className="mt-1 text-xs text-grey-600">잔고 기준 {portfolio.dates.join(' · ')}</p></div>
        <aside className="space-y-4 border-t border-grey-200 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">{analysis ? ['목표 적합성','집중·중복 위험','충격 대응'].map(d=>{const a=analysis.assessments.find(a=>a.dimension===d);return a && <div key={d}><h5 className="text-xs font-semibold text-grey-600">{d==='목표 적합성' ? '현재 배분의 의미' : d==='충격 대응' ? '더 적극적으로 투자한다면' : '쏠림과 분산'}</h5><p className="mt-1 text-sm font-semibold leading-relaxed">{a.judgment}</p><p className="mt-1 text-xs leading-relaxed text-grey-600">{a.condition}</p></div>}) : <p className="text-sm text-grey-600">AI 진단 생성 전 · 현재와 목표 비중을 확인하세요.</p>}</aside>
      </div>
    </section>}
    <section className="my-5" aria-label="운용 선택지"><h4 className="text-base font-bold">더 적극적으로 준비하는 두 가지 방법</h4><div className="mt-3 grid gap-4 sm:grid-cols-2"><div className="border-t border-grey-300 pt-3"><h5 className="text-sm font-semibold">주식 비중 확대</h5><p className="mt-1 text-xs leading-relaxed text-grey-600">성장 기회를 늘리는 선택. 하락 때 감수할 손실과 생활비 자금을 먼저 확인해요.</p></div><div className="border-t border-grey-300 pt-3"><h5 className="text-sm font-semibold">현재 비중 유지 · 납입 확대</h5><p className="mt-1 text-xs leading-relaxed text-grey-600">추가 저축으로 투자금을 늘리는 선택. 아래 표에서 납입액별 효과를 비교해요.</p></div></div></section>
    <RetirementOutlook value={outlook}/>
    {accounts.map((account, index) => <section key={account.label} className="mt-8 border-t border-grey-300 pt-5">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-lg font-bold">{index + 1}. {short(account.label)}</h4>
        <span className="text-xs text-grey-600">{account.total_value != null && <b className="mr-2 text-grey-900">{manwon(account.total_value)}</b>}{account.strategy} · 잔고 {account.as_of || '미등록'}</span>
      </div>
      <section>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section><h5 className="mb-4 text-base font-bold">현재 → 목표</h5><AllocationExhibit rows={account.plan?.mix ?? []}/>
            <p className="mt-4 text-xs text-grey-600">목표: 선택한 전략 기준</p>
          </section>
          <aside className="border-t border-grey-200 pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"><h5 className="text-base font-bold">이번에 할 일</h5>
            {account?.plan && <p className="mt-4 bg-grey-100 p-3 text-sm font-semibold leading-relaxed">{(account.mode === 'buy_only' && !account.orders?.length ? '납입금을 입력해 매수 수량 확인' : account.plan.line) || (account.plan.kind==='in_range' ? '현재 선택 전략의 범위 안이에요.' : '계좌와 주문 조건을 확인해 주세요.')}</p>}
          </aside>
        </div>
      </section>
      <details className="mt-6 border-t border-grey-200 pt-4">
        <summary className="cursor-pointer text-sm font-semibold">참고 · 보유 상품과 전략 등록 상품</summary>
        {!account?.products?.length && <p className="py-5 text-sm text-grey-600">잔고와 전략의 지정 종목이 확인되면 비교표를 만들 수 있어요.</p>}
        <div className="hidden grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b border-grey-300 bg-grey-100 px-3 py-2 text-xs text-grey-600 md:grid"><span>역할</span><span>보유·검토 후보</span><span>확인할 조건</span></div>
        <div className="divide-y divide-grey-200">{account?.products?.map((p,i)=><div key={`${p.asset_class}-${p.ticker}-${i}`} className="grid gap-2 px-1 py-3 text-sm md:grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)] md:gap-4 md:px-3"><span className="font-semibold">{p.role.split(' (')[0]}</span><div><p className="font-bold">{p.name}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-grey-600"><span>{p.position}</span>{p.ticker && <button title="종목코드 복사" aria-label={`${p.name} 종목코드 복사`} className="min-h-7 tabular-nums underline underline-offset-4" onClick={()=>copy(p.ticker)}>{p.ticker}</button>}</div>{!p.mapping_confirmed && <p className="text-xs text-grey-600">자산 분류 확인 필요</p>}</div><div><details className="mt-2 text-xs text-grey-600"><summary className="cursor-pointer">상품 정보</summary><p className="mt-1 leading-relaxed">{p.structure || '상품 구조 상세 미확인'}<br/>{p.check}<br/>등록 근거: {p.source}</p></details></div></div>)}</div>
        {copyNotice && <p role="status" className="mt-2 text-sm text-grey-600">{copyNotice}</p>}
      </details>
      <section className="mt-6 border-t border-grey-200 pt-4">
        <h5 className="text-base font-bold">주문 검토표</h5><p className="my-2 text-xs text-grey-600">등록 가격 기준 · 주문 전 현재가 확인</p>
        {!account?.orders?.length && <p className="bg-grey-100 p-4 text-sm text-grey-700">{account?.mode==='buy_only' ? '납입금 입력 후 매수 수량 확인' : '주문 없음 · 잔고와 계좌 설정 확인'}</p>}
        <div className="divide-y divide-grey-200">{account?.orders?.map((o,i)=><div key={i} className="grid grid-cols-[48px_minmax(0,1fr)] gap-2 py-3 sm:grid-cols-[48px_minmax(0,1fr)_auto]"><b className={`text-sm ${o.side==='매도'?'text-down':'text-up'}`}>{o.side==='매도'?'팔기':'사기'}</b><div><p className="text-sm font-semibold">{o.name} <span className="font-normal text-grey-600">{o.ticker}</span></p><p className="mt-1 text-xs text-grey-600">{o.account} · {o.status}</p>{o.note && <p className="mt-1 text-xs text-grey-600">{o.note.split(' — 입력')[0]}</p>}</div><span className="col-start-2 text-sm tabular-nums sm:col-start-auto sm:text-right">{o.qty ? shares(o.qty) : '수량 미확정'} · <b>{manwon(o.amount)}</b></span></div>)}</div>
      </section>
    </section>)}
        {analysis && <section className="mt-5 border-t border-grey-300 pt-4"><h5 className="text-base font-bold">다음 할 일</h5><ol className="mt-2 divide-y divide-grey-200">{analysis.actions.map(a=><li key={a.timing} className="grid gap-2 py-3 sm:grid-cols-[90px_minmax(0,1fr)]"><span className="text-xs font-semibold text-grey-600">{a.timing}</span><div><p className="text-sm font-semibold">{a.action}</p><details className="mt-1 text-xs text-grey-600"><summary className="cursor-pointer">근거</summary><p className="mt-2">{a.reason}</p><p>{a.completion}</p></details></div></li>)}</ol></section>}

      <section className="mt-8 border-t border-grey-300 pt-5">
        <h5 className="text-base font-bold">내 연금 판단에 연결한 리서치</h5><p className="mt-1 text-xs text-grey-600">검토한 자료 · 자동 수집 아님</p>
        <div className="divide-y divide-grey-200">{research.map(r=><section key={r.url} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"><div><a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-2 text-base font-bold underline-offset-4 hover:underline">{r.title}<ExternalLink className="mt-1 size-3.5 shrink-0" aria-hidden="true"/></a><p className="mt-2 text-xs text-grey-600">{r.publisher}<br/>발행 {r.published} · 검토 {r.reviewed}</p></div><div><p className="text-sm leading-relaxed text-grey-700">{r.finding}</p><p className="mt-2 flex gap-2 text-sm leading-relaxed"><ArrowRight className="mt-1 size-4 shrink-0" aria-hidden="true"/>{r.application}</p></div></section>)}</div>
      </section>

    {analysis && <details className="mt-5 border-t border-grey-300 pt-3"><summary className="cursor-pointer py-1 text-sm font-semibold">종합 평가 · 세 전략의 조건별 해석</summary><div className="mt-4"><AllocationReport analysis={analysis}/></div></details>}
  </article>
}
