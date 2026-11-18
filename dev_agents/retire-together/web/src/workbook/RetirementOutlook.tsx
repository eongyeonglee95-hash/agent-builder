import { manwon, pct } from '@/lib/format'
export type Outlook = {
  available: boolean; missing?: string[]; error?: string; monthly_need?: number | null;
  retire_year?: number; short_years?: number; basis?: string;
  assumptions?: { return_rate: number; inflation: number; end_age: number };
  milestones?: { year: number; income: number; need: number | null; shortfall: number | null }[];
  scenarios: { extra_monthly: number; income: number; increase: number; shortfall: number | null; year: number }[];
  scenario_note?: string; contribution_schedule?: { start_year?: number; end_year?: number; payments?: number };
}
export function RetirementOutlook({ value }: { value?: Outlook }) {
  if (!value?.available) return <section className="my-8 border-y border-grey-300 py-5"><h4 className="text-lg font-bold">은퇴 생활비</h4><p className="mt-2 text-sm text-grey-600">{value?.error || `${value?.missing?.join(' · ') || '저장한 은퇴 계획'}을 확인하면 예상 연금과 생활비 부족분을 비교할 수 있어요.`}</p></section>
  const first = value.milestones?.[0]
  const items = [['목표 생활비 / 월', value.monthly_need], [`은퇴 첫해 ${first?.year ?? ''} / 월`, first?.income], ['부족분 / 월', first?.shortfall]] as const
  return <section className="mb-8 mt-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-xl font-bold leading-snug tracking-tight">{first?.shortfall == null ? '생활비 목표 입력 필요' : first.shortfall > 0 ? '은퇴 첫해, 연금 외 자금이 더 필요해요.' : '은퇴 첫해 생활비 충족 · 이후 부족분 확인'}</h4><span className="text-xs text-grey-600">저장한 계획 기준 · 세전 · 현재 돈 가치</span></div>
    <div className="my-5 grid gap-4 border-y border-grey-200 py-5 sm:grid-cols-3">{items.map(([label,amount],i)=><div key={label} className={i ? 'sm:border-l sm:border-grey-200 sm:pl-5' : ''}><p className="text-xs text-grey-600">{label}</p><p className={`mt-2 text-3xl font-bold tracking-tight tabular-nums ${i===2 && (amount ?? 0)>0 ? 'text-up' : 'text-grey-900'}`}>{amount == null ? '미입력' : manwon(amount)}</p></div>)}</div>
    <table className="mt-4 w-full text-left text-sm tabular-nums"><caption className="sr-only">은퇴 시기별 월 연금과 생활비 부족분</caption><thead className="border-b border-grey-300 text-xs text-grey-600"><tr><th className="py-2 font-normal">확인 시점</th><th className="text-right font-normal">월 연금</th><th className="text-right font-normal">월 부족분</th></tr></thead><tbody>{value.milestones?.map((m,i)=><tr key={m.year} className="border-b border-grey-200"><th className="py-3 font-medium">{m.year}년 <span className="block text-xs font-normal text-grey-600">{i===0 ? '은퇴 첫해' : i===value.milestones!.length-1 ? '계산 기간 마지막 해' : '모든 연금 수령 시작'}</span></th><td className="text-right">{manwon(m.income)}</td><td className="text-right font-semibold">{m.shortfall == null ? '미계산' : manwon(m.shortfall)}</td></tr>)}</tbody></table>
    <div className="mt-6"><h5 className="text-base font-bold">추가 저축 효과</h5><p className="mt-1 text-xs leading-relaxed text-grey-600">내 연금저축 · {value.contribution_schedule?.start_year && `${value.contribution_schedule.start_year}~${value.contribution_schedule.end_year}년 납입 · `}은퇴 첫해 기준</p>
      {!!value.scenarios.length && <table className="mt-3 w-full text-left text-sm tabular-nums"><caption className="sr-only">추가 납입 비교 가정</caption><thead className="border-b border-grey-300 bg-grey-100 text-xs text-grey-600"><tr><th className="px-2 py-2 font-normal">매월 추가</th><th className="text-right font-normal">월 연금 증가</th><th className="px-2 text-right font-normal">남는 월 부족분</th></tr></thead><tbody>{value.scenarios.map(s=><tr key={s.extra_monthly} className="border-b border-grey-200"><th className="px-2 py-3 font-semibold">{manwon(s.extra_monthly)}</th><td className="text-right">+{manwon(s.increase)}</td><td className="px-2 text-right">{s.shortfall == null ? '미계산' : manwon(s.shortfall)}</td></tr>)}</tbody></table>}
      <details className="mt-2 text-xs text-grey-600"><summary className="cursor-pointer">납입 조건</summary><p className="mt-2 leading-relaxed">{value.scenario_note}</p></details>
    </div>
    <p className="mt-4 border-l-2 border-grey-400 pl-3 text-xs leading-relaxed text-grey-600">가정: 수익률 {pct((value.assumptions?.return_rate ?? 0)*100,{signed:false})} · 물가 {pct((value.assumptions?.inflation ?? 0)*100,{signed:false})} · {value.assumptions?.end_age}세까지 · 연금만 계산 · 부동산·일반자산 인출 제외</p>
  </section>
}
