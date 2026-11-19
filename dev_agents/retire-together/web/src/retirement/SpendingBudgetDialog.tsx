import { useState } from 'react'
import { Calculator, Utensils } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Plan, Result, SpendingBudget } from '../workbook/retirement'
import './spending-budget.css'

type Key = keyof SpendingBudget
type Draft = Record<Key, string>
const counts: Partial<Record<Key, number>> = { people: 10, meals_per_day: 10, days_per_month: 31 }
const man = (won: number) => (won / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 2 })
const toDraft = (budget: SpendingBudget) => Object.fromEntries(Object.entries(budget).map(([key, value]) => [key, String(key in counts ? value : value / 10000)])) as Draft

// Instant form feedback only. The save endpoint recomputes the goal from the
// validated line items, using the same whole-won rounding for annual expenses.
function calculate(draft: Draft) {
  const budget = {} as SpendingBudget
  for (const key of Object.keys(draft) as Key[]) {
    const value = Number(draft[key])
    if (!draft[key].trim() || !Number.isFinite(value) || value < 0) return null
    if (key in counts) {
      if (!Number.isInteger(value) || value < 1 || value > counts[key]!) return null
      budget[key] = value
    } else {
      budget[key] = Math.round(value * 10000)
      if (budget[key] > 1e12) return null
    }
  }
  const food = budget.meal_cost * budget.people * budget.meals_per_day * budget.days_per_month
  const tax = Math.floor((budget.housing_tax_annual + 6) / 12)
  const total = food + tax + budget.allowance_monthly + budget.living_monthly + budget.insurance_monthly
    + budget.medical_monthly + budget.health_insurance_monthly + budget.irregular_monthly + budget.other_monthly
  return total <= 1e12 ? { budget, food, tax, total } : null
}

export function SpendingBudgetDialog({ data, save, close, returnFocus }: {
  data: Result; save: (plan: Plan) => Promise<boolean>; close: () => void; returnFocus: () => void
}) {
  const [plan] = useState(() => structuredClone(data.plan))
  const [draft, setDraft] = useState(() => toDraft(data.plan.spending_budget ?? data.spending_budget_template))
  const [mode, setMode] = useState<'direct' | 'items'>('direct')
  const [direct, setDirect] = useState(() => data.plan.monthly_need == null ? '' : String(data.plan.monthly_need / 10000))
  const directValid = direct.trim() === '' || (Number.isFinite(Number(direct)) && Number(direct) >= 0 && Number(direct) <= 1e8)
  const directTotal = direct.trim() === '' ? null : Math.round(Number(direct) * 10000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preview = calculate(draft)
  const valid = mode === 'direct' ? directValid : preview != null
  const total = mode === 'direct' ? directTotal : preview?.total ?? null
  const field = (key: Key, label: string, unit = '만 원') => <span className="tower-budget-input">
    <Input type="number" inputMode={key in counts ? 'numeric' : 'decimal'} aria-label={label} required min={key in counts ? 1 : 0}
      max={counts[key] ?? 1e8} step={key in counts ? 1 : .0001} value={draft[key]}
      onChange={e => { setDraft(p => ({ ...p, [key]: e.target.value })); setError('') }}/><span>{unit}</span>
  </span>
  const row = (key: Key, label: string, hint?: string, provisional = false, annual = false) => <label className="tower-budget-row" key={key}>
    <span><span className="tower-budget-row-title">{label}{provisional && <small className="tower-budget-badge">임시 예산</small>}</span>{hint && <small className="tower-budget-hint">{hint}</small>}</span>
    {field(key, label, annual ? '만 원 / 년' : '만 원 / 월')}
  </label>
  async function submit() {
    if (!valid || busy) return
    setBusy(true); setError('')
    try {
      if (await save(mode === 'direct' ? { ...plan, monthly_need: directTotal, apply_spending_budget: false } : { ...plan, spending_budget: preview!.budget, monthly_need: preview!.total, apply_spending_budget: true })) close()
      else setError('적용하지 못했어요. 입력한 항목은 이 창에 남아 있습니다. 다른 화면에서 계획을 바꿨다면 닫고 새로고침한 뒤 다시 적용해 주세요.')
    } catch (e) { setError(e instanceof Error ? e.message : '적용하지 못했어요. 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) close() }}>
    <DialogContent className="tower-budget-dialog" showCloseButton={!busy}
      onEscapeKeyDown={e => { if (busy) e.preventDefault() }} onPointerDownOutside={e => { if (busy) e.preventDefault() }}
      onCloseAutoFocus={e => { e.preventDefault(); returnFocus() }}>
      <DialogHeader className="tower-budget-header"><DialogTitle><Calculator size={20}/>생활비 설정</DialogTitle>
        <DialogDescription>부부의 월 생활비를 직접 입력하거나 항목별로 계산해 보세요.</DialogDescription>
      </DialogHeader>
      <form className="tower-budget-form" onSubmit={e => { e.preventDefault(); submit() }}>
        <div className="tower-budget-scroll" role="region" aria-label="생활비 입력 항목" tabIndex={0}>
        <fieldset className="tower-budget-body" disabled={busy}>
          <div className="tower-budget-modes" role="group" aria-label="생활비 입력 방식"><Button type="button" variant="outline" aria-pressed={mode === 'direct'} onClick={() => { setMode('direct'); setError('') }}>총액 직접 입력</Button><Button type="button" variant="outline" aria-pressed={mode === 'items'} onClick={() => { setMode('items'); setError('') }}>항목별 계산</Button></div>
          {mode === 'direct' ? <label className="tower-budget-direct"><span>부부 월 생활비 · 오늘의 돈</span><span className="tower-budget-input"><Input type="number" inputMode="decimal" aria-label="은퇴 후 부부 월 생활비" min={0} max={1e8} step={.0001} value={direct} placeholder="예: 500" onChange={e => { setDirect(e.target.value); setError('') }}/><span>만 원 / 월</span></span><small>비우면 생활비 비교를 해제해요. 저장한 항목별 예산은 유지돼요.</small></label> : <><div className="tower-budget-context"><span>{plan.spending_budget ? '저장한 항목에서 이어서' : '검토용 초안 · 적용 전에는 저장되지 않아요'}</span><span>현재 목표 <b>{plan.monthly_need == null ? '미설정' : `월 ${man(plan.monthly_need)}만 원`}</b></span></div>
          <section className="tower-budget-food" aria-labelledby="spending-food-title">
            <div className="tower-budget-section-title"><h3 id="spending-food-title"><Utensils size={16}/>식비</h3><span>월 <b data-testid="budget-food">{preview ? man(preview.food) : '—'}</b>만 원</span></div>
            <div className="tower-budget-food-fields">
              <label><span>한 사람 · 한 끼</span>{field('meal_cost', '1인 한 끼 식비')}</label>
              <label><span>함께 먹는 인원</span>{field('people', '식사 인원', '명')}</label>
              <label><span>하루 끼니 수</span>{field('meals_per_day', '하루 끼니 수', '끼')}</label>
              <label><span>한 달 일수</span>{field('days_per_month', '식비 계산 일수', '일')}</label>
            </div>
            <p>한 끼 금액 × 인원 × 끼니 수 × 일수 · 간식·커피는 식비나 용돈 중 한 곳에 넣어주세요.</p>
          </section>
          <section className="tower-budget-section" aria-labelledby="spending-fixed-title"><h3 id="spending-fixed-title">매달 유지할 생활</h3>
            {row('allowance_monthly', '부부 용돈')}
            {row('living_monthly', '관리비·교통·통신')}
            {row('insurance_monthly', '민간보험료', '건강보험료와 따로 · 은퇴 후 유지할 계약 기준')}
          </section>
          <section className="tower-budget-section" aria-labelledby="spending-reserve-title"><h3 id="spending-reserve-title">세금과 의료·여유비</h3>
            {row('housing_tax_annual', '연간 주택 보유세', '고지액이나 예상 연액을 직접 입력해요.', true, true)}
            <p className="tower-budget-tax">12개월로 나눠 준비하면 <b>월 {preview ? man(preview.tax) : '—'}만 원</b></p>
            {row('medical_monthly', '병원·약값', '평균 통계가 아닌 준비 예산', true)}
            {row('health_insurance_monthly', '건강보험·장기요양보험료', '퇴직 후 예상 고지액을 확인해 조정하세요.', true)}
            {row('irregular_monthly', '여행·경조사·집수리', '가끔 쓰는 돈도 월 적립액으로', true)}
          </section>
          <section className="tower-budget-section" aria-labelledby="spending-other-title"><h3 id="spending-other-title">그 밖에 필요한 돈</h3>
            {row('other_monthly', '기타·대출·교육비', '은퇴 뒤에도 남는 비용이 있다면 더해 주세요.')}
          </section>
          <p className="tower-budget-note">세금·보험료를 자동 산정하는 계산기는 아니에요. 큰 간병비·자녀 지원금은 별도 목돈으로 준비하고, 같은 비용을 여러 항목에 중복해서 넣지 않도록 확인해 주세요.</p>
          <p className="tower-budget-note">이 목표는 실제로 쓸 생활비입니다. 화면의 연금은 세전 금액이라, 연금에서 빠지는 세금은 비교에 아직 반영되지 않아요.</p>
          </>}
        </fieldset>
        </div>
        <div className="tower-budget-footer">
          {mode === 'items' && <p className="tower-budget-scroll-hint">위아래로 스크롤해 전체 항목을 확인하세요.</p>}
          <div className="tower-budget-total" aria-live="polite"><span>우리의 월 생활비<small>오늘 돈 · 부부 합계</small></span><strong><span data-testid="budget-total">{valid && total != null ? man(total) : '—'}</span><small>만 원</small></strong></div>
          {!valid && <p className="tower-budget-validation">입력값을 확인해 주세요. 쓰지 않는 비용은 0으로 입력할 수 있어요.</p>}
          {error && <p className="tower-error" role="alert">{error}</p>}
          <div className="tower-budget-actions"><Button type="button" variant="outline" disabled={busy} onClick={close}>취소</Button><Button type="submit" disabled={busy || !valid}>{busy ? '적용하는 중…' : mode === 'direct' && total == null ? '생활비 비교 해제' : valid && total != null ? `월 ${man(total)}만 원을 생활비 목표로 적용` : '생활비 목표로 적용'}</Button></div>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
