import type { ReportAccount } from './SecuritiesReport'
import type { AllocationAnalysis } from './AllocationReport'
import { pct } from '@/lib/format'

export function PortfolioDiagnostics({ accounts, analysis }: { accounts: ReportAccount[]; analysis?: AllocationAnalysis | null }) {
  const funded = accounts.filter(a => a.plan?.mix?.length)
  const classes = [...new Map(funded.flatMap(a => a.plan!.mix!.map(m => [m.asset_class, m.label.split(' (')[0]] as const))).entries()]
  return <section className="my-4 border-y border-grey-300 py-3" aria-label="계좌별 배분과 핵심 평가">
    {!!funded.length && <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1"><h4 className="text-base font-bold">어느 계좌에 어떤 자산이 몰려 있나요?</h4><span className="text-xs text-grey-600">등록 자산군 기준 · 같은 0~100% 축</span></div>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-grey-700">{classes.map(([key, label]) => <span key={key} className="flex items-center gap-1"><i className="size-2" style={{ background: `var(--cls-${key.replaceAll('_', '-')})` }} aria-hidden="true"/>{label}</span>)}</div>
      <div className="divide-y divide-grey-200">{funded.map(a => <div key={a.label} className="grid gap-2 py-2 sm:grid-cols-[140px_minmax(0,1fr)]"><div><h5 className="text-sm font-semibold">{a.label.split(' — ')[0]}</h5><p className="text-xs text-grey-600">{a.strategy}</p></div><div>
        <div className="flex h-6 overflow-hidden bg-grey-100" role="img" aria-label={`${a.label} 현재 배분: ${a.plan!.mix!.map(m => `${m.label} ${pct(m.current_pct, { signed: false, digits: 1 })}`).join(', ')}`}>
          {a.plan!.mix!.filter(m => m.current_pct > 0).map(m => <span key={m.asset_class} title={`${m.label} ${pct(m.current_pct, { signed: false, digits: 1 })}`} className="h-full" style={{ width: `${m.current_pct}%`, background: `var(--cls-${m.asset_class.replaceAll('_', '-')})` }}/>)}</div>
        <p className="mt-1 text-xs leading-relaxed tabular-nums text-grey-600">{a.plan!.mix!.filter(m => m.current_pct > 0).map(m => `${m.label.split(' (')[0]} ${pct(m.current_pct, { signed: false, digits: 1 })}`).join(' · ')}</p>
      </div></div>)}</div>
    </div>}
    {!!analysis?.assessments.length && <section className={funded.length ? 'mt-3 border-t border-grey-300 pt-3' : ''} aria-label="핵심 평가"><h4 className="mb-2 text-base font-bold">배분·집중·현금흐름 핵심 평가</h4><div className="grid gap-x-5 md:grid-cols-2">{analysis.assessments.map(a => <div key={a.dimension} className="border-t border-grey-200 py-2"><div className="flex items-baseline justify-between gap-2"><h5 className="text-xs font-semibold text-grey-700">{a.dimension}</h5><span className="text-xs text-grey-600">{a.status}</span></div><p className="mt-1 text-sm leading-relaxed">{a.judgment}</p><details className="mt-1 text-xs text-grey-600"><summary className="cursor-pointer py-1">근거·판단 조건</summary><p className="mt-1 leading-relaxed">{a.evidence}</p><p className="mt-1 leading-relaxed">{a.condition}</p></details></div>)}</div></section>}
  </section>
}
