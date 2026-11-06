import { Input } from '@/components/ui/input'
import type { PersonPlan, Result } from '../workbook/retirement'
import './private-payout.css'

export function PrivatePayoutFields({ who, data, value, onChange }: {
  who: 'me' | 'partner'; data: Result; value: PersonPlan; onChange: (age: number | null) => void
}) {
  const name = who === 'me' ? '나' : '배우자'
  const defaultAge = data.payout_defaults.private_start_age
  const automatic = value.private_start_age == null
  const age = value.private_start_age ?? defaultAge
  const currentAge = data.used[who]?.age
  const start = Math.max(age, currentAge ?? age)
  const end = data.assumptions.end_age
  const minimum = data.assumptions.start_age_min
  const maximum = end - data.assumptions.min_payout_years
  const valid = age >= minimum && age <= maximum && start <= maximum
  return <div className="tower-payout-fields">
    <div className="tower-payout-heading"><strong>연금 받기 시작</strong><span>{automatic ? '기본 가정 · 수령정보 미확인' : '직접 설정한 계산 조건'}</span></div>
    <div className="tower-payout-choices" role="group" aria-label={`${name} 수령 나이 선택`}>
      {[55, 60, 65].filter(preset => preset >= minimum && preset <= maximum).map(preset => <button type="button" key={preset} aria-pressed={age === preset} onClick={() => onChange(preset)}>{preset}세</button>)}
    </div>
    <label className="tower-field"><span>다른 나이로 직접 입력</span><span className="tower-input-unit">
      <Input aria-label={`${name} 사적연금 개시 나이`} type="number" inputMode="numeric" min={minimum} max={maximum} step={1}
        value={value.private_start_age ?? ''} placeholder={String(defaultAge)} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}/><span>세</span>
    </span></label>
    <p className="tower-payout-period" data-testid={`payout-period-${who}`}>{valid ? <><strong>{start}세부터 {end}세 직전까지</strong> · {end - start}년 나눠 받는 계산</> : '나이와 수령 기간을 확인해 주세요.'}</p>
    {currentAge != null && age < currentAge && <p>설정한 나이가 지나 현재 나이부터 계산해요.</p>}
    <p>퇴직·개인·추가연금에 함께 적용돼요. 퇴직금(DB)은 퇴직 이후부터 계산해요. 보험사의 계약 조건을 변경하는 기능은 아니에요.</p>
    <button type="button" className="tower-payout-reset" disabled={automatic} onClick={() => onChange(null)}>기본값 {defaultAge}세로 되돌리기</button>
  </div>
}
