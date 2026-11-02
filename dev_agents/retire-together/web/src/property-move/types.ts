import type { Address } from '../property-entry'

export type Candidate = {
  id: string; name: string; address: Address | null; area_m2: number | null
  price: number | null; price_basis: 'manual' | 'trade' | 'asking'; price_date: string | null
  asking_low: number | null; asking_high: number | null; asking_date: string | null
  purchase_costs: number | null; memo: string
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
export const dateToday = () => new Date().toLocaleDateString('sv-SE')
