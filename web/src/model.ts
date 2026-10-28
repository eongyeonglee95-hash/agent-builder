export type Owner = 'together' | 'me' | 'partner'
export type Page = 'home' | 'assets' | 'pension' | 'stocks' | 'property' | 'rebalance'
export type AssetClass = 'stock' | 'long_bond' | 'mid_bond' | 'gold' | 'commodity' | 'cash' | 'property' | 'mixed' | 'debt'
export type Asset = { id: string; name: string; account: string; owner: 'me' | 'partner' | 'joint'; pocket: 'retirement' | 'cash' | 'property' | 'debt'; assetClass: AssetClass; amount: number; as_of?: string; version?: number; updated_at?: string; parent_id?: string | null; valuation_source?: 'total' | 'details'; share_percent?: number | null; full_amount?: number; scoped_owner?: string; source?: string; account_id?: string }
export type Person = { name: string; age: number | null; gender: 'female' | 'male' | 'unspecified'; role: 'wife' | 'husband' | 'partner' | null }
export type Family = { me: Person; partner: Person | null; retirement_age: number | null; target_amount: number | null; version: number; updated_at: string }
export type AccountGroup = { account: Asset; details: Asset[]; source: 'total' | 'details'; details_total: number; difference: number }
export type Snapshot = { assets: Asset[]; debts: Asset[]; total: number; retirement: number; cash: number; property: number; debt: number; net: number; financial: number; classes: { key: string; label: string; color: string; amount: number }[]; count: number; unclassified: number; as_of: string | null; account_groups?: AccountGroup[]; partner_missing?: boolean; goal_missing?: boolean }
export type Strategy = { id: string; name: string; targets: Record<string, number>; labels: Record<string, string>; threshold: number; examples: { assetClass: string; name: string | null; ticker: string | null }[] }
export const AS_OF = '2026.10.27'
export const ownerLabels: Record<Owner, string> = { together: '부부 전체', me: '나', partner: '배우자' }
export const assetOwnerLabel = (owner: Asset['owner']) => owner === 'joint' ? '공동 소유' : ownerLabels[owner]
export const assetSourceLabel = (asset: Asset) => ({ manual: '직접 입력', file: '파일 등록', capture: '사진 등록', photo: '사진 등록' }[asset.source ?? 'manual'] ?? '가져온 자료')
export const classInfo: Record<string, { label: string; color: string }> = {
  stock: { label: '주식', color: '#5985ec' },
  long_bond: { label: '장기채', color: '#42b3aa' },
  mid_bond: { label: '중기채', color: '#8ed2c8' },
  gold: { label: '금', color: '#e6ba69' },
  cash: { label: '현금', color: '#a1acc2' },
  property: { label: '부동산', color: '#a08cce' },
  commodity: { label: '원자재', color: '#d397b5' },
  mixed: { label: '혼합·미분류', color: '#bdc6d4' },
  debt: { label: '대출', color: '#ce968a' },
}

// Entirely synthetic, fixed design-review data. No personal holdings imported.
// Money is integer KRW; each position belongs to exactly one pocket/class/owner.
export const demoAssets: Asset[] = [
  { id: 'm-stock', owner: 'me', pocket: 'retirement', assetClass: 'stock', name: '연금 주식형 자산', account: '나의 연금저축', amount: 102_000_000 },
  { id: 'm-long', owner: 'me', pocket: 'retirement', assetClass: 'long_bond', name: '장기 국채 자산', account: '나의 연금저축', amount: 79_000_000 },
  { id: 'm-mid', owner: 'me', pocket: 'retirement', assetClass: 'mid_bond', name: '중기 채권 자산', account: '나의 퇴직연금', amount: 31_000_000 },
  { id: 'm-gold', owner: 'me', pocket: 'retirement', assetClass: 'gold', name: '금 자산', account: '나의 연금저축', amount: 28_000_000 },
  { id: 'p-stock', owner: 'partner', pocket: 'retirement', assetClass: 'stock', name: '연금 주식형 자산', account: '배우자의 연금저축', amount: 64_000_000 },
  { id: 'p-long', owner: 'partner', pocket: 'retirement', assetClass: 'long_bond', name: '장기 국채 자산', account: '배우자의 연금저축', amount: 62_000_000 },
  { id: 'p-mid', owner: 'partner', pocket: 'retirement', assetClass: 'mid_bond', name: '중기 채권 자산', account: '배우자의 퇴직연금', amount: 27_000_000 },
  { id: 'p-gold', owner: 'partner', pocket: 'retirement', assetClass: 'gold', name: '금 자산', account: '배우자의 연금저축', amount: 30_000_000 },
  { id: 'm-cash-stock', owner: 'me', pocket: 'cash', assetClass: 'stock', name: '일반계좌 주식', account: '나의 현금 주머니', amount: 85_000_000 },
  { id: 'm-cash', owner: 'me', pocket: 'cash', assetClass: 'cash', name: '예금과 현금', account: '나의 현금 주머니', amount: 76_500_000 },
  { id: 'p-cash-stock', owner: 'partner', pocket: 'cash', assetClass: 'stock', name: '일반계좌 주식', account: '배우자의 현금 주머니', amount: 72_000_000 },
  { id: 'p-cash', owner: 'partner', pocket: 'cash', assetClass: 'cash', name: '예금과 현금', account: '배우자의 현금 주머니', amount: 28_000_000 },
  { id: 'm-property', owner: 'me', pocket: 'property', assetClass: 'property', name: '우리 집 · 나의 지분', account: '공동 소유 50%', amount: 300_000_000 },
  { id: 'p-property', owner: 'partner', pocket: 'property', assetClass: 'property', name: '우리 집 · 배우자 지분', account: '공동 소유 50%', amount: 300_000_000 },
]
export function getSnapshot(owner: Owner): Snapshot {
  const assets = demoAssets.filter(a => owner === 'together' || a.owner === owner)
  const sum = (items: Asset[]) => items.reduce((total, a) => total + a.amount, 0)
  const total = sum(assets)
  const retirement = sum(assets.filter(a => a.pocket === 'retirement'))
  const cash = sum(assets.filter(a => a.pocket === 'cash'))
  const property = sum(assets.filter(a => a.pocket === 'property'))
  const debt = owner === 'together' ? 100_000_000 : 50_000_000
  const classes = Object.entries(classInfo).map(([key, info]) => ({ key, ...info, amount: sum(assets.filter(a => a.assetClass === key)) })).filter(a => a.amount > 0)
  return { assets, total, retirement, cash, property, debt, net: total - debt, financial: retirement + cash, classes, debts: [] as Asset[], count: assets.length, unclassified: 0, as_of: '2026-10-27' as string | null }
}
export function money(value: number): string {
  if (value < 0) return `−${money(-value)}`
  const rounded = Math.round(value / 10_000)
  const eok = Math.floor(rounded / 10_000)
  const man = rounded % 10_000
  return `${eok ? `${eok.toLocaleString('ko-KR')}억` : ''}${eok && man ? ' ' : ''}${man ? `${man.toLocaleString('ko-KR')}만` : ''}${!eok && !man ? '0' : ''}원`
}
export function compactMoney(value: number) { return `${(value / 100_000_000).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}억` }
export function downloadDemoCsv(owner: Owner) {
  const rows = getSnapshot(owner).assets.map(a => [assetOwnerLabel(a.owner), a.account, a.name, classInfo[a.assetClass].label, a.amount].join(','))
  const content = '\uFEFF예시 데이터 — 실제 잔고 아님\n소유자,계좌,자산명,자산군,금액(원)\n' + rows.join('\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = `둘이서은퇴_예시자산_${owner}.csv`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
