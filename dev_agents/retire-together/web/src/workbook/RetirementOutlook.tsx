import { manwon, pct } from '@/lib/format'
export type Outlook = {
  available: boolean; missing?: string[]; error?: string; monthly_need?: number | null;
  retire_year?: number; short_years?: number; basis?: string;
  assumptions?: { return_rate: number; inflation: number; end_age: number };
  milestones?: { year: number; income: number; need: number | null; shortfall: number | null }[];
  scenarios: { extra_monthly: number; income: number; increase: number; shortfall: number | null; year: number }[];
  scenario_note?: string; contribution_schedule?: { start_year?: number; end_year?: number; payments?: number };
}

function IncomeBar({ income, need, maximum, increase = 0 }: { income: number; need: number | null; maximum: number; increase?: number }) {
  const width = (amount: number) => `${Math.max(0, Math.min(100, amount / maximum * 100))}%`
  const added = Math.max(0, Math.min(income, increase))
  return <div className="relative flex h-3 bg-grey-100" role="img" aria-label={`월 연금 ${manwon(income)}${need == null ? ' · 생활비 미입력' : ` · 목표 생활비 ${manwon(need)}`}${added > 0 ? ` · 추가 납입에 따른 증가 ${manwon(added)}` : ''}`}>
    <span className="h-full bg-grey-800" style={{ width: width(income - added) }}/>
    {added > 0 && <span className="h-full bg-primary" style={{ width: width(added) }}/>}
    {need != null && <span className="absolute -top-1 h-5 border-l-2 border-grey-700" style={{ left: width(need) }} aria-hidden="true"/>}
  </div>
}

export function RetirementOutlook({ value, compact = false }: { value?: Outlook; compact?: boolean }) {
  if (!value?.available) return <section className="my-4 border-y border-grey-300 py-3"><h4 className="text-base font-bold">은퇴 생활비</h4><p className="mt-2 text-sm text-grey-600">{value?.error || `${value?.missing?.join(' · ') || '저장한 은퇴 계획'}을 확인하면 예상 연금과 생활비 부족분을 비교할 수 있어요.`}</p></section>
  const first = value.milestones?.[0]
  const milestones = value.milestones ?? []
  const scenarios = value.scenarios ?? []
  const maximum = Math.max(1, ...milestones.flatMap(m => [m.income, m.need ?? 0]), ...scenarios.map(s => s.income))
  const need = first?.need ?? value.monthly_need ?? null
  const assumptions = value.assumptions
  return <section className="report-outlook my-4" aria-label="은퇴 생활비 시각 분석">
    {!compact && <p className="mb-3 text-sm font-semibold">목표 생활비 {value.monthly_need == null ? '미입력' : `${manwon(value.monthly_need)} / 월`}</p>}
    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-label="시점별 연금 비교">
        <h4 className="text-base font-bold">은퇴 시점별 생활비 대비 연금</h4>
        <p className="mb-3 mt-1 text-xs text-grey-600">세전 · 현재 돈 가치 · 각 확인 시점의 월 금액</p>
        <div className="flex flex-wrap gap-3 text-xs text-grey-600"><span className="flex items-center gap-1"><i className="h-2 w-4 bg-grey-800" aria-hidden="true"/>월 연금</span><span className="flex items-center gap-1"><i className="h-3 border-l-2 border-grey-700" aria-hidden="true"/>목표 생활비</span></div>
        <div className="mt-2 divide-y divide-grey-200 border-y border-grey-200">{milestones.map((m, i) => <div key={m.year} className="py-3">
          <div className="mb-2 flex items-baseline justify-between gap-2"><h5 className="text-sm font-semibold">{m.year}년 <span className="text-xs font-normal text-grey-600">{i === 0 ? '은퇴 첫해' : i === milestones.length - 1 ? '계산 마지막 해' : '모든 연금 시작'}</span></h5><span className="text-sm font-semibold tabular-nums">{manwon(m.income)}</span></div>
          <IncomeBar income={m.income} need={m.need} maximum={maximum}/>
          <p className="mt-2 text-right text-xs tabular-nums text-grey-600">{m.shortfall == null ? '목표 생활비 입력 필요' : m.shortfall > 0 ? <>월 부족분 <b className="text-up">{manwon(m.shortfall)}</b></> : '이 시점의 생활비 충족'}</p>
        </div>)}</div>
      </section>
      <section aria-label="추가 납입 시나리오 비교">
        <h4 className="text-base font-bold">매월 더 넣으면 부족분이 얼마나 줄까요?</h4>
        <p className="mb-3 mt-1 text-xs text-grey-600">내 연금저축 · {value.contribution_schedule?.start_year && `${value.contribution_schedule.start_year}~${value.contribution_schedule.end_year}년 납입 · `}은퇴 첫해 기준</p>
        <div className="flex flex-wrap gap-3 text-xs text-grey-600"><span className="flex items-center gap-1"><i className="h-2 w-4 bg-grey-800" aria-hidden="true"/>기존 월 연금</span><span className="flex items-center gap-1"><i className="h-2 w-4 bg-primary" aria-hidden="true"/>늘어나는 연금</span></div>
        <div className="mt-2 divide-y divide-grey-200 border-y border-grey-200">{scenarios.map(s => <div key={s.extra_monthly} className="py-3">
          <div className="mb-2 flex items-baseline justify-between gap-2"><h5 className="text-sm font-semibold">매월 +{manwon(s.extra_monthly)}</h5><span className="text-xs tabular-nums">월 연금 <b className="text-sm">{manwon(s.income)}</b></span></div>
          <IncomeBar income={s.income} need={need} maximum={maximum} increase={s.increase}/>
          <div className="mt-2 flex flex-wrap justify-between gap-1 text-xs tabular-nums"><span>월 연금 +{manwon(s.increase)}</span><span className="text-grey-600">남는 부족분 <b className={(s.shortfall ?? 0) > 0 ? 'text-up' : ''}>{s.shortfall == null ? '미계산' : manwon(s.shortfall)}</b></span></div>
        </div>)}</div>
        {!scenarios.length && <p className="py-3 text-sm text-grey-600">납입 계획을 입력하면 추가 저축 효과를 비교할 수 있어요.</p>}
        <details className="mt-2 text-xs text-grey-600"><summary className="cursor-pointer py-1">납입 조건 · 비교 가정</summary><p className="mt-1 leading-relaxed">{value.scenario_note || '저장한 납입 기간과 수익률 가정으로 비교해요. 권장 납입액이 아닙니다.'}</p></details>
      </section>
    </div>
    <p className="mt-3 border-t border-grey-200 pt-2 text-xs leading-relaxed text-grey-600">동일 금액 축 · {assumptions ? `가정: 수익률 ${pct(assumptions.return_rate * 100, { signed: false })} · 물가 ${pct(assumptions.inflation * 100, { signed: false })} · ${assumptions.end_age}세까지` : '계산 가정 미확인'} · 연금만 계산 · 부동산·일반자산 인출 제외</p>
  </section>
}
