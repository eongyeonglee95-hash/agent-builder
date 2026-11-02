import type { Result, Row } from '../workbook/retirement'

export type Scope = 'together' | 'me' | 'partner'
export const PEOPLE = [['me', '나'], ['partner', '배우자']] as const
export const LAYERS = [
  { id: 1, name: '국민연금', caption: '일상의 기초', description: '공단 예상 월액으로 그리는 기본 소득' },
  { id: 2, name: '퇴직연금', caption: '쌓아온 시간', description: 'DB 퇴직금과 DC·IRP 적립금으로 계산해요' },
  { id: 3, name: '개인연금', caption: '준비한 내일', description: '세제적격 연금저축·IRP 개인납입 — 넣을 때 세액공제, 받을 때 연금소득세' },
  { id: 4, name: '추가연금', caption: '더하는 여유', description: '세제비적격 연금보험 · ISA 등 — 세액공제는 없지만 받을 때 세금 부담이 적고 급하면 해지해 쓸 수 있어요' },
] as const

export const amount = (row: Row | undefined, scope: Scope, layer?: number) => {
  if (!row) return null
  // Only add already calculated server items; no yield, inflation or payout formulas here.
  // 층을 주지 않은 합계는 서버와 같이 1~3층만이다. 4층 추가연금은 extra()로 따로 읽는다 (기본 합계에 넣지 않음, 2026-11-02 사용자).
  if (scope === 'together') return layer ? row.layers_real[String(layer)] ?? 0 : row.total_real
  return row.items.filter(i => i.person === scope && (layer === undefined ? i.layer !== 4 : i.layer === layer)).reduce((sum, i) => sum + i.real, 0)
}
// 4층 추가연금을 월급으로 나눠 쓸 때의 월액(오늘 돈). 서버 extra_real / 사람별 items 합.
export const extra = (row: Row | undefined, scope: Scope) => {
  if (!row) return 0
  if (scope === 'together') return row.extra_real ?? row.layers_real['4'] ?? 0
  return row.items.filter(i => i.person === scope && i.layer === 4).reduce((sum, i) => sum + i.real, 0)
}
// Aggregate registered amounts only. Future contributions and DB forecasts never
// become part of today's account balance. DB accrued is displayed separately.
export function capital(data: Result, scope: Scope, layer?: number) {
  const people = PEOPLE.filter(([who]) => scope === 'together' || who === scope)
  const values = people.flatMap(([who]) => Object.entries(data.capital?.[who]?.balances ?? data.used[who]?.balances ?? {})
    .filter(([key]) => layer === undefined || Number(key) === layer).map(([, value]) => value))
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}
export function accruedDb(data: Result, scope: Scope) {
  return PEOPLE.filter(([who]) => scope === 'together' || who === scope).reduce((sum, [who]) => sum + (data.capital?.[who]?.db_accrued ?? data.plan[who]?.db_accrued ?? 0), 0)
}
export const percent = (value: number) => value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
export function streams(data: Result, scope: Scope, layer?: number) {
  return (data.projection?.summary.streams ?? []).filter(s => (scope === 'together' || s.person === scope) && (layer === undefined || s.layer === layer))
}
export function visibleYears(data: Result, scope: Scope = 'together') {
  // A person's model horizon is not a pension ending. Stop a household view at
  // the first person's horizon, so a missing projection cannot appear as a cut.
  const people = PEOPLE.filter(([key]) => data.used[key] && (scope === 'together' || scope === key))
  const rows = (data.projection?.rows ?? []).filter(row => people.length > 0 && people.every(([key]) => row.ages[key] < data.assumptions.end_age))
  const first = Math.min(data.projection?.summary.retire_year ?? Infinity, ...streams(data, 'together').map(s => s.start_year))
  return Number.isFinite(first) ? rows.filter(r => r.year >= first) : rows
}
export function layerState(data: Result, scope: Scope, year: number, layer: number) {
  if (!data.projection || (scope !== 'together' && !data.used[scope])) return '계산 전'
  const selected = streams(data, scope, layer)
  if (!selected.length) return '준비 정보 없음'
  if (selected.every(s => s.start_year > year)) return `${Math.min(...selected.map(s => s.start_year))}년부터`
  const active = selected.some(s => s.start_year <= year && data.used[s.person] && data.used[s.person]!.age + year - data.base_year < data.assumptions.end_age)
  if (!active) return layer === 1 ? '계산 기간 밖' : '수령 기간 종료'
  return '수령 중'
}

// 큰 금액은 억·만 단위, 소수점 없이 ("2억 32만"). 월 단위 작은 돈은 기존 monthly(소수 한 자리)를 쓴다.
export function manWon(won: number) {
  const sign = won < 0 ? '-' : ''
  const abs = Math.abs(won)
  let eok = Math.floor(abs / 1e8), man = Math.round((abs % 1e8) / 1e4)
  if (man === 10000) { eok += 1; man = 0 }
  if (eok > 0) return `${sign}${eok.toLocaleString('ko-KR')}억${man ? ` ${man.toLocaleString('ko-KR')}만` : ''}`
  return `${sign}${man.toLocaleString('ko-KR')}만`
}
