export type SharedRecord = { kind: string; id: string; member_id: string; payload: Record<string, unknown> }
export type SharedState = { schema: number; members: { me: string; partner: string }; records: SharedRecord[] }
export type DataSummary = { counts: Record<string, number>; totals: Record<string, { assets: number; debt: number }>; holding_values: Record<string, number> }
export type SharedData = { revision: string; state: SharedState; summary: DataSummary; viewer: { me: string; partner: string; retirement_reference_member_id: string }; permissions: Record<string, boolean> }
export const kindLabels: Record<string, string> = { profile: '가족 정보', family_goal: '은퇴 목표', pension: '개인별 연금', retirement: '은퇴 생활비·가정', asset: '자산·대출', account: '계좌', pool: '계좌 묶음', holding: '보유종목', property_detail: '주택 정보', property_plan: '갈아타기 계획', property_track: '부동산 기록', decision: '결정 이력', rules: '투자 규칙' }
export function memberName(state: SharedState, member: string) { return member === 'joint' ? '공동 명의' : member === 'household' ? '우리 집' : String(state.records.find(r => r.kind === 'profile' && r.member_id === member)?.payload.name ?? (member === state.members.me ? '오너' : '배우자')) }
