import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Plan, Result } from '../workbook/retirement'
import { useDbPreview as usePlanPreview } from './DbRetirementFields'
import { PEOPLE, type Scope } from './presentation'
import './savings-plan.css'

type Who = 'me' | 'partner'
type Fields = { annual: string; start: string; end: string }
const man = (won: number) => (won / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })

function initial(data: Result, who: Who): Fields {
  const p = data.plan[who], used = data.used[who], template = data.savings_plan_template
  const saved = p.savings_start_year != null || p.savings_end_age != null
  const legacy = !saved && p.savings_annual > 0
  return {
    annual: String((saved || legacy ? p.savings_annual : template.annual) / 10000),
    start: String(p.savings_start_year ?? data.base_year + template.start_year_offset),
    end: String(p.savings_end_age ?? (legacy && used ? Math.min(used.retire_age, used.private_start_age) : template.end_age)),
  }
}

export function SavingsPlanDialog({ data, scope, save, close, returnFocus }: {
  data: Result; scope: Scope; save: (plan: Plan) => Promise<boolean>; close: () => void; returnFocus: () => void
}) {
  // Keep the version opened by the user. A concurrent edit must produce a conflict, not overwrite it.
  const [source] = useState(() => structuredClone(data))
  const [who, setWho] = useState<Who>(scope === 'partner' ? 'partner' : 'me')
  const [fields, setFields] = useState(() => ({ me: initial(source, 'me'), partner: initial(source, 'partner') }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const f = fields[who], used = source.used[who], label = who === 'me' ? '나' : '배우자'
  const annual = Math.round(Number(f.annual) * 10000), start = Number(f.start), end = Number(f.end)
  const valid = Object.values(f).every(v => v.trim() !== '') && Number.isFinite(annual) && annual >= 0 && annual <= 1e12
    && Number.isInteger(start) && start >= 1900 && start <= 2200 && Number.isInteger(end) && end >= 18 && end <= 100
  const draft: Plan = { ...source.plan, [who]: { ...source.plan[who], savings_annual: annual, savings_start_year: start, savings_end_age: end } }
  const preview = usePlanPreview(draft, valid && !!used)
  const result = valid ? preview.data : undefined
  const estimate = result?.savings_plans[who]
  const problem = !used ? '내 정보에서 나이와 은퇴 나이를 먼저 입력해 주세요.' : !valid ? '납입 금액·시작 연도·종료 나이를 확인해 주세요.'
    : preview.error || result?.savings_errors[who] || result?.error || (result && !result.projection ? '가족 정보와 수령 시점을 먼저 확인해 주세요.' : '')
  const ready = !!estimate && estimate.principal != null && !problem && (annual === 0 || estimate.payments > 0)
  const hasSaved = source.plan[who].savings_start_year != null || source.plan[who].savings_annual > 0
  const amountCell = (value: number | null, testId: string, added = false) => <td data-testid={testId} data-won={value ?? undefined} title={value == null ? undefined : `${value.toLocaleString('ko-KR')}원`}>
    {value == null ? '—' : `${added ? '+' : ''}${man(value)}만`}
  </td>
  const update = (key: keyof Fields, value: string) => { setFields(p => ({ ...p, [who]: { ...p[who], [key]: value } })); setError('') }
  async function submit() {
    if (!ready || busy) return
    setBusy(true); setError('')
    try {
      if (await save(draft)) close()
      else setError('저장하지 못했어요. 입력값은 남아 있습니다. 다른 화면에서 계획을 바꿨다면 닫고 새로고침한 뒤 다시 저장해 주세요.')
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요. 다시 시도해 주세요.') }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) close() }}>
    <DialogContent className="tower-plan-dialog tower-savings-dialog" showCloseButton={!busy}
      onEscapeKeyDown={e => { if (busy) e.preventDefault() }} onPointerDownOutside={e => { if (busy) e.preventDefault() }}
      onCloseAutoFocus={e => { e.preventDefault(); returnFocus() }}>
      <DialogHeader><DialogTitle>개인연금 미래 납입 계획</DialogTitle><DialogDescription>앞으로 넣을 돈을 정해보세요. 계획을 저장하면 예상 월 연금에 반영해요.</DialogDescription></DialogHeader>
      <form onSubmit={e => { e.preventDefault(); submit() }}>
        <fieldset disabled={busy}>
          <div className="tower-savings-person" role="group" aria-label="납입 계획 대상">{PEOPLE.filter(([key]) => source.used[key]).map(([key, name]) => <button type="button" key={key} aria-pressed={who === key} onClick={() => { setWho(key); setError('') }}>{name}</button>)}</div>
          <p className="tower-savings-context">{hasSaved ? '저장한 계획' : '새 계획 · 저장 전'}{used && ` · 현재 ${used.age}세 · 연금 수령 ${Math.max(used.age, used.private_start_age)}세부터`}</p>
          <div className="tower-savings-current"><span>현재 등록된 개인연금 적립금</span><strong data-testid="savings-balance-now" data-won={estimate?.balance_now ?? source.capital[who].balances['3'] ?? 0}>{man(estimate?.balance_now ?? source.capital[who].balances['3'] ?? 0)}만 원</strong><small>현재 적립금은 유지하고, 아래 납입 계획의 효과를 따로 계산해요.</small></div>
          <label className="tower-field"><span>매년 납입할 금액</span><span className="tower-input-unit"><Input aria-label="매년 납입할 금액" type="number" inputMode="decimal" required min={0} max={1e8} step={.0001} value={f.annual} onChange={e => update('annual', e.target.value)}/><span>만 원 / 년</span></span></label>
          <div className="tower-savings-period">
            <label className="tower-field"><span>납입 시작</span><span className="tower-input-unit"><Input aria-label="납입 시작 연도" type="number" inputMode="numeric" required min={1900} max={2200} step={1} value={f.start} onChange={e => update('start', e.target.value)}/><span>년부터</span></span></label>
            <label className="tower-field"><span>납입 종료</span><span className="tower-input-unit"><Input aria-label="납입 종료 나이" type="number" inputMode="numeric" required min={18} max={100} step={1} value={f.end} onChange={e => update('end', e.target.value)}/><span>세까지</span></span></label>
          </div>
          <div className="tower-savings-preview" aria-live="polite" aria-busy={valid && !!used && !problem && !estimate}>
            {problem ? <p role="alert">{problem}{preview.error && <button type="button" onClick={preview.reload}>다시 계산</button>}</p> : !estimate ? <p role="status">납입 계획 계산 중…</p> : <>
              <p data-testid="savings-period">{annual === 0 ? '추가 납입 없이 현재 적립금만 운용해요.' : estimate.payments ? `${estimate.start_year === estimate.end_year ? estimate.start_year : `${estimate.start_year}~${estimate.end_year}`}년 · 매년 1회, 총 ${estimate.payments}회 납입` : '남은 납입 기간이 없어요. 시작 연도와 종료 나이를 조정해 주세요.'}</p>
              <dl><div><dt>이번 계획으로 납입할 총액</dt><dd data-testid="savings-total" data-won={estimate.total_contributions}>{man(estimate.total_contributions)}만 원</dd></div></dl>
              <table className="tower-savings-comparison" aria-label="현재 적립금과 납입 계획 비교">
                <caption>{estimate.payout_age}세 수령 시작 때<small>만 원 단위 · 반올림</small></caption>
                <thead><tr><th scope="col">구분</th><th scope="col">적립금<small>그때 금액</small></th><th scope="col">첫해 월 연금<small>세전 · 오늘 돈</small></th></tr></thead>
                <tbody>
                  <tr><th scope="row">현재 적립금만<small>추가 납입 없이 운용</small></th>{amountCell(estimate.existing_principal, 'savings-existing-principal')}{amountCell(estimate.existing_monthly_real, 'savings-existing-monthly')}</tr>
                  <tr className="is-added"><th scope="row">이번 납입 효과<small>새로 넣는 돈으로 증가</small></th>{amountCell(estimate.contribution_principal, 'savings-added-principal', true)}{amountCell(estimate.contribution_monthly_real, 'savings-added-monthly', true)}</tr>
                  <tr className="is-total"><th scope="row">합계</th>{amountCell(estimate.principal, 'savings-principal')}{amountCell(estimate.monthly_real, 'savings-monthly')}</tr>
                </tbody>
              </table>
            </>}
          </div>
          <p className="tower-savings-note">납입을 마쳐도 수령 시작까지 계속 운용해요. 종료 나이는 바꿀 수 있어요.</p>
          <details className="tower-savings-basis"><summary>계산 기준</summary>
            <p>등록한 현재 개인연금 적립금 {man(source.capital[who].balances['3'] ?? 0)}만 원에 앞으로 납입할 돈을 더해 계산해요. 미래 납입액을 현재 자산에 더하지 않아요.</p>
            <p>종료 나이가 되는 해를 포함해 매년 말 같은 금액을 납입하는 연 단위 가정이에요. 올해와 지난 납입은 현재 적립금에 포함된 것으로 보고, 내년 이후의 납입만 계산해요.</p>
            <p>연 수익률 {source.assumptions.return_rate * 100}% · 물가 {source.assumptions.inflation * 100}%, {source.assumptions.end_age}세 직전까지 나눠 받는 가정이에요. 세금과 세액공제 환급금 재투자는 반영하지 않아요.</p>
          </details>
        </fieldset>
        {error && <p className="tower-error" role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>취소</Button><Button type="submit" disabled={busy || !ready}>{busy ? '저장하는 중…' : `${label} 계획 저장`}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
