import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { PersonPlan, Plan, Result } from '../workbook/retirement'
import { PEOPLE, type Scope } from './presentation'

export type Editor = 1 | 2 | 3 | 'goal' | 'timing' | 'assumptions'
const TITLES = { 1: '국민연금 입력', 2: '퇴직연금 입력', 3: '개인연금 입력', goal: '은퇴 후 생활비', timing: '은퇴·수령 시점', assumptions: '계산 가정' }

export function PlanDialog({ data, scope, section, save, close }: {
  data: Result; scope: Scope; section: Editor; save: (plan: Plan) => Promise<boolean>; close: () => void
}) {
  const [draft, setDraft] = useState(() => structuredClone(data.plan))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const people = PEOPLE.filter(([key]) => (scope === 'together' || key === scope) && (key === 'me' || data.used.partner))
  const update = (who: 'me' | 'partner', field: keyof PersonPlan, value: string, nullable = false) => {
    setDraft(p => ({ ...p, [who]: { ...p[who], [field]: value === '' && nullable ? null : Number(value) } }))
  }
  const personField = (who: 'me' | 'partner', label: string, field: keyof PersonPlan, unit: '원' | '세', hint: string, placeholder?: number) => <label className="tower-field" key={field}>
    <span>{label}</span><span className="tower-input-unit"><Input aria-label={`${who === 'me' ? '나' : '배우자'} ${label}`} type="number" inputMode="numeric" min={unit === '세' ? 18 : 0} max={unit === '세' ? 100 : 1e12} step={1}
      value={draft[who][field] ?? ''} placeholder={placeholder == null ? '' : String(placeholder)} onChange={e => update(who, field, e.target.value, unit === '세')}/><span>{unit}</span></span><small>{hint}</small>
  </label>
  async function submit() {
    setBusy(true); setError('')
    try {
      if (await save(draft)) close()
      else setError('저장하지 못했어요. 입력값은 이 창에 남아 있습니다. 다른 화면에서 변경했다면 창을 닫고 최신 계획을 새로고침해 주세요.')
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요.') }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) close() }}>
    <DialogContent className="tower-plan-dialog max-h-[88dvh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={e => { if (busy) e.preventDefault() }} onPointerDownOutside={e => { if (busy) e.preventDefault() }}>
      <DialogHeader><DialogTitle>{TITLES[section]}</DialogTitle><DialogDescription>저장하면 등록한 적립금과 함께 다시 계산합니다. 금액은 원 단위로 입력해 주세요.</DialogDescription></DialogHeader>
      <form onSubmit={e => { e.preventDefault(); submit() }} className="tower-plan-form">
        {typeof section === 'number' || section === 'timing' ? people.map(([who, name]) => <fieldset key={who} disabled={busy}><legend>{name}</legend><div className="tower-form-grid">
          {section === 1 && <>
            {personField(who, '국민연금 예상 월액', 'national_monthly', '원', '공단에서 확인한 예상 월액 · 오늘 돈')}
            {personField(who, '국민연금 개시 나이', 'national_start_age', '세', '비우면 출생연도 기준', data.used[who]?.national_start_age)}
          </>}
          {section === 2 && <>
            {personField(who, '월급 (최근 3개월 평균)', 'db_monthly_wage', '원', 'DB형 퇴직금 계산에 사용')}
            {personField(who, '지금 쌓인 퇴직금', 'db_accrued', '원', '회사에서 확인한 현재 예상 퇴직금')}
            {personField(who, 'DC·IRP 연 납입', 'irp_annual', '원', '은퇴 또는 수령 개시 전까지 넣을 돈')}
            <p className="tower-form-note">DC·IRP 적립금은 등록한 계좌에서 가져와요. DB 퇴직금과 같은 돈을 중복 입력하지 않도록 확인해 주세요.</p>
          </>}
          {section === 3 && <>
            {personField(who, '연금저축 1년 납입액', 'savings_annual', '원', '앞으로 1년에 넣을 돈')}
            <p className="tower-form-note">현재 적립금은 등록한 연금저축 계좌를 사용해요. 적립금을 바꾸려면 자산에서 해당 계좌를 수정해 주세요.</p>
          </>}
          {section === 'timing' && <>
            {personField(who, '은퇴 나이', 'retire_age', '세', '비우면 내 정보의 은퇴 목표', data.used[who]?.retire_age)}
            {personField(who, '사적연금 개시 나이', 'private_start_age', '세', `퇴직·개인연금 · ${data.assumptions.start_age_min}세 이상, ${data.assumptions.end_age}세까지 ${data.assumptions.min_payout_years}년 이상 수령`, data.used[who]?.private_start_age)}
          </>}
        </div></fieldset>) : section === 'goal' ? <label className="tower-field"><span>은퇴 후 부부 월 생활비 · 오늘의 돈</span><span className="tower-input-unit"><Input autoFocus type="number" inputMode="numeric" aria-label="은퇴 후 부부 월 생활비" min={0} max={1e12} step={1} value={draft.monthly_need ?? ''} placeholder="비우면 비교하지 않아요" onChange={e => setDraft(p => ({ ...p, monthly_need: e.target.value === '' ? null : Number(e.target.value) }))}/><span>원</span></span><small>지금 물가로 생각한 한 달 생활비를 입력하세요. 예: 월 500만 원은 5000000. 저장하면 은퇴 시점에 필요한 금액을 물가에 맞춰 계산해요. 개인 보기에서도 부부 공동 목표입니다.</small></label> : <div className="tower-form-grid">
          {([['return_rate', '연 수익률', 15], ['inflation', '물가상승률', 10]] as const).map(([field, label, max]) => <label className="tower-field" key={field}><span>{label}</span><span className="tower-input-unit"><Input type="number" inputMode="decimal" aria-label={label} min={0} max={max} step={.01} value={draft[field] == null ? '' : +(draft[field]! * 100).toFixed(2)} placeholder={String(data.assumptions[field] * 100)} onChange={e => setDraft(p => ({ ...p, [field]: e.target.value === '' ? null : Number(e.target.value) / 100 }))}/><span>%</span></span><small>빈 칸은 기본 가정을 사용해요.</small></label>)}
        </div>}
        {error && <p className="tower-error" role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>취소</Button><Button type="submit" disabled={busy}>{busy ? '저장하는 중…' : '저장하고 다시 계산'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}
