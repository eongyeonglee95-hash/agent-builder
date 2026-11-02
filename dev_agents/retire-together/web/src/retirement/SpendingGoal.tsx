import { ArrowRight, Settings2, TrendingUp } from 'lucide-react'
import type { Result } from '../workbook/retirement'

export function SpendingGoal({ data, hidden, error, onGoal, onAssumptions, onTiming }: {
  data: Result; hidden: boolean; error: string; onGoal: () => void; onAssumptions: () => void; onTiming: () => void
}) {
  const target = error ? null : data.spending_target
  const number = (won: number | null) => hidden ? '••••' : won == null ? '—' : (won / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })
  return <section className="tower-spending" aria-label="물가를 반영한 은퇴 생활비">
    <div className="tower-spending-title"><div><span className="tower-eyebrow">같은 생활, 달라지는 금액</span><h2>지금의 한 달을, 은퇴 후에도.</h2></div><button onClick={onGoal}><Settings2 size={14}/>생활비 설정</button></div>
    <div className="tower-spending-comparison">
      <div className="tower-spending-now"><span>오늘 기준 · 부부 월 생활비</span><strong data-testid="spending-today" data-won={hidden || error ? undefined : data.plan.monthly_need ?? undefined}>{number(error ? null : data.plan.monthly_need)}<small>만 원 / 월</small></strong><p>{data.base_year}년 현재가치로 설정한 목표</p></div>
      <div className="tower-spending-bridge"><button onClick={onAssumptions}><TrendingUp size={15}/>연 물가 {(data.assumptions.inflation * 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%</button><ArrowRight size={30}/><button onClick={onTiming}>{target ? target.years === 0 ? '올해 기준' : `${target.years}년 뒤` : '은퇴 시점 설정'}</button></div>
      <div className="tower-spending-future"><span>{target ? `${target.target_year}년${target.years === 0 ? ' · 현재 은퇴 생활비' : ' · 은퇴 첫해 필요한 생활비'}` : '은퇴 첫해 필요한 생활비'}</span><strong data-testid="spending-retirement" data-won={hidden ? undefined : target?.monthly_nominal}>{number(target?.monthly_nominal ?? null)}<small>만 원 / 월</small></strong><p>{target ? target.monthly_increase > 0 ? <>같은 생활에 <b>월 {number(target.monthly_increase)}만 원</b> 더 필요해요</> : '입력한 기간과 물가에서는 같은 금액이에요' : error ? '계획을 새로고침해 주세요' : data.plan.monthly_need == null ? '오늘 기준 생활비를 입력해 주세요' : '내 나이와 은퇴 나이를 입력해 주세요'}</p></div>
    </div>
    <p className="tower-spending-note">나의 은퇴 시점 기준 · 부부 합계 · 입력한 물가로 계산한 월 생활비이며, 필요한 총자산을 뜻하지 않아요.</p>
  </section>
}
