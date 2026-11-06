import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { toMan, fromMan } from './PlanDialog'
import { api } from '../local-data'
import type { PersonPlan, Plan, Result, ServicePeriod } from '../workbook/retirement'
import './db-retirement.css'

// The server uses the same pure calculation for previews and saved projections.
// Hide old values immediately when the input changes; aborted requests cannot win.
export function useDbPreview(plan: Plan, enabled: boolean) {
  const key = JSON.stringify(plan)
  const [response, setResponse] = useState<{ key: string; data?: Result; error?: string } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
      setResponse({ key, error: '계산 응답이 늦어지고 있어요. 다시 계산해 주세요.' })
    }, 10000)
    const timer = setTimeout(async () => {
      try {
        const data = await api<Result>('/retirement/preview', 'POST', JSON.parse(key), controller.signal)
        if (!controller.signal.aborted) setResponse({ key, data })
      } catch (e) {
        if (!controller.signal.aborted) setResponse({ key, error: e instanceof Error ? e.message : '미리보기를 불러오지 못했어요.' })
      } finally { clearTimeout(timeout) }
    }, 250)
    return () => { clearTimeout(timer); clearTimeout(timeout); controller.abort() }
  }, [key, enabled, retry])
  return { data: response?.key === key ? response.data : undefined, error: response?.key === key ? response.error : undefined,
    reload: () => { setResponse(null); setRetry(n => n + 1) } }
}

const won = (value: number | null) => value == null ? '—' : `${value.toLocaleString('ko-KR')}원`
const tenure = (period: ServicePeriod | null) => period ? `${period.years}년 ${period.months}개월 · ${period.days.toLocaleString('ko-KR')}일` : '입사일 입력 전'

export function DbRetirementFields({ who, value, asOf, preview, onChange }: {
  who: 'me' | 'partner'; value: PersonPlan; asOf: string; preview: ReturnType<typeof useDbPreview>;
  onChange: (change: Partial<PersonPlan>) => void
}) {
  const name = who === 'me' ? '나' : '배우자'
  const automatic = value.db_method === 'tenure'
  const estimate = preview.data?.db_estimates[who]
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const rows = estimate?.timeline ?? []
  const point = rows.find(row => row.year === selectedYear) ?? rows[rows.length - 1]
  return <div className="tower-db-fields">
    <div className="tower-db-heading"><strong>DB형 퇴직금</strong><span>세전 · 오늘의 돈</span></div>
    <div className="tower-db-method" role="group" aria-label={`${name} DB 퇴직금 계산 방식`}>
      <button type="button" aria-pressed={automatic} onClick={() => onChange({ db_method: 'tenure' })}>입사일로 계산</button>
      <button type="button" aria-pressed={!automatic} onClick={() => onChange({ db_method: 'reported' })}>회사 확인금액 사용</button>
    </div>
    <div className="tower-db-inputs">
      <label className="tower-field"><span>월급 (최근 3개월 평균) · 세전</span>
        <span className="tower-input-unit"><Input aria-label={`${name} 세전 월 평균급여`} type="number" inputMode="decimal" min={0} max={1e8} step="any" required={automatic}
          value={value.db_monthly_wage ? toMan(value.db_monthly_wage) : ''} onChange={e => onChange({ db_monthly_wage: fromMan(e.target.value) })}/><span>만 원</span></span>
        <small>세금·4대 보험 공제 전 급여 3개월 합계 ÷ 3</small>
      </label>
      {automatic ? <label className="tower-field"><span>입사일</span>
        <Input aria-label={`${name} 입사일`} type="date" max={preview.data?.as_of ?? asOf} required value={value.db_start_date ?? ''}
          onChange={e => onChange({ db_start_date: e.target.value || null })}/>
        <small>입사일부터 오늘까지 근속기간을 자동 계산해요.</small>
      </label> : <label className="tower-field"><span>지금 쌓인 퇴직금</span>
        <span className="tower-input-unit"><Input aria-label={`${name} 지금 쌓인 퇴직금`} type="number" inputMode="decimal" min={0} max={1e8} step="any"
          value={value.db_accrued ? toMan(value.db_accrued) : ''} onChange={e => onChange({ db_accrued: fromMan(e.target.value) })}/><span>만 원</span></span>
        <small>회사에서 확인한 현재 예상 퇴직금 · 과거 근속 포함</small>
      </label>}
    </div>
    <div className="tower-db-preview" aria-label={`${name} DB 예상 퇴직금`} aria-busy={!estimate && !preview.error}>
      {preview.error ? <p role="alert">{preview.error} <button type="button" onClick={preview.reload}>다시 계산</button></p> : !estimate ? <p role="status">예상 퇴직금 계산 중…</p> : estimate.missing.length ?
        <p>{estimate.missing.join(' · ')}를 입력하면 근속기간과 예상액을 보여드려요.</p> : <>
          <div className="tower-db-tenure"><span>{estimate.as_of} 기준{automatic ? ' 근속기간' : ' 회사 확인금액'}</span>{automatic && <strong data-testid={`db-tenure-${who}`}>{tenure(estimate.tenure)}</strong>}</div>
          <dl className="tower-db-amounts">
            <div><dt>현재 예상 퇴직금</dt><dd data-testid={`db-current-${who}`} data-won={estimate.accrued_now ?? undefined}>{won(estimate.accrued_now)}</dd></div>
            <div><dt>은퇴 시점{rows.length > 0 && ` · ${rows[rows.length - 1].year}년`}</dt><dd data-testid={`db-retirement-${who}`} data-won={estimate.lump_at_retire ?? undefined}>{won(estimate.lump_at_retire)}</dd></div>
          </dl>
          {estimate.eligible_now === false && <p>현재 근속 1년 미만으로 예상 지급액은 0원이에요. 1년 이상 계속 근무한 시점부터 계산합니다.</p>}
          {point && rows.length > 1 && <div className="tower-db-timeline">
            <label htmlFor={`db-year-${who}`}><span>{point.year}년 예상 퇴직금</span><strong data-testid={`db-selected-${who}`} data-won={point.amount}>{won(point.amount)}</strong></label>
            <input id={`db-year-${who}`} aria-label={`${name} 퇴직금 살펴보는 연도`} type="range" min={rows[0].year} max={rows[rows.length - 1].year} step={1} value={point.year} onChange={e => setSelectedYear(Number(e.target.value))}/>
            <div className="tower-db-year-labels"><span>현재 · {rows[0].year}</span><span>{automatic ? tenure(point.tenure) : '현재 확인액 + 앞으로 쌓일 금액'}</span><span>은퇴 · {rows[rows.length - 1].year}</span></div>
          </div>}
          {estimate.lump_at_retire == null && <p>은퇴 시점 예상액은 내 정보의 나이와 은퇴 목표를 입력하면 볼 수 있어요.</p>}
          {!automatic && !value.db_monthly_wage && <p>급여를 입력하면 앞으로 더 쌓일 금액도 반영해요.</p>}
        </>}
    </div>
    <details className="tower-db-basis"><summary>계산 기준</summary>
      <p>입사일 계산은 세전 월 평균급여 × 근속일수 ÷ 365의 간편 추정이에요. 회사 확인금액 방식은 현재 금액에 월 평균급여 × 남은 근무 연수를 더해요. 두 금액을 합산하지 않습니다.</p>
      <p>재직 중인 DB형이며 주 15시간 이상 근무하는 경우를 가정합니다. 날짜가 지나면 다시 열 때 근속기간이 갱신돼요. 은퇴까지 같은 회사에서 일하고 급여는 물가만큼 오른다고 보아, 모든 예상액을 오늘의 돈으로 표시합니다.</p>
      <p>상여·연차수당, 통상임금 비교, 제외기간은 따로 반영하지 않은 추정액이에요. 중간정산을 했거나 이미 퇴직했다면 회사 확인금액을 사용해 주세요. 실제 지급액은 회사에서 확인해 주세요.</p>
      <a href="https://1350.moel.go.kr/home/hp/retirementpaycal/retirementpaycal.jsp" target="_blank" rel="noreferrer">고용노동부 퇴직금 계산 기준</a>
    </details>
  </div>
}
