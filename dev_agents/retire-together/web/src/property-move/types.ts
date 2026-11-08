import type { Address } from '../property-entry'

export type Living = { school: string; commute: string; life: string; concerns: string }
export const emptyLiving = (): Living => ({ school: '', commute: '', life: '', concerns: '' })
export type Candidate = {
  id: string; name: string; address: Address | null; area_m2: number | null
  members?: { name: string; jibun: string }[]   // 여러 차수 묶음(국토부 이름·지번). 화면은 보존만 한다
  price: number | null; price_basis: 'manual' | 'trade' | 'asking'; price_date: string | null
  asking_low: number | null; asking_high: number | null; asking_date: string | null
  purchase_costs: number | null; memo: string; living: Living
}
export type MovePlan = {
  version: number; source_home_ids: string[]; cash: number | null; sale_costs: number | null
  new_loan: number; monthly_saving: number; target_month: string | null; target_id: string | null; candidates: Candidate[]
}
export type Budget = {
  id?: string; sale_value: number; loans: number; deposit: number; sale_net: number
  own_funds: number | null; total_needed: number | null; gap: number | null; coverage: number | null
  months: number | null; future_savings: number | null; future_gap: number | null; required_monthly: number | null
  surplus: number | null; costs_complete: boolean; price_gap?: number | null
}
export type TrackEntry = {
  day: string; price: number; price_basis: 'manual' | 'trade' | 'asking'; price_date: string | null; note: string
  home_value: number; home_net: number; own_funds: number | null; gap: number; needed: number | null; costs_complete: boolean; saved_at: string
}
export type MoveState = { plan: MovePlan; comparisons: Budget[]; funds: Budget; cash_reference: number; missing_home_ids: string[]; valuation_needs_review: string[]; track: Record<string, TrackEntry[]> }
export type PriceCheck = {
  configured: boolean; months: number; trades: { name: string; area: number; price: number; date: string; floor: number | null; kind: string }[]
  analysis: { count: number; latest: number | null; latest_date: string | null; low: number | null; high: number | null; median: number | null; first_date: string | null; last_date: string | null; asking: number | null
    premium_latest: number | null; premium_latest_pct: number | null; premium_median: number | null; premium_median_pct: number | null }
}
export const dateToday = () => new Date().toLocaleDateString('sv-SE')
