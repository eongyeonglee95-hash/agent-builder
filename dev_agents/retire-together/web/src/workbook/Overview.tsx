import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  dashboard: { net: number; retirement: number; cash: number }
  accounts: { stale: boolean }[]
  pools: { error?: string; blocked_reason?: string | null; triggered?: boolean }[]
  owner: string
  onRegister: () => void
  onHoldings: () => void
  onRebalance: () => void
  onAssets: () => void
}

export function Overview({ dashboard, accounts, pools, owner, onRegister, onHoldings, onRebalance, onAssets }: Props) {
  const stale = accounts.filter(a => a.stale).length
  const blocked = pools.some(p => p.error || p.blocked_reason)
  const triggered = pools.some(p => p.triggered)
  const action = !accounts.length
    ? { title: '종목 잔고를 등록해 주세요', detail: '자산 총액만 등록했다면, 종목을 추가해 배분 비율도 확인할 수 있어요.', label: '잔고 등록하기', run: onRegister }
    : stale
    ? { title: `${stale}개 계좌의 잔고를 확인해 주세요`, detail: '오래된 잔고가 있어요. 최근 거래·납입 내역을 확인한 뒤 비율을 비교해 주세요.', label: '보유종목 확인', run: onHoldings }
    : blocked
    ? { title: '리밸런싱 계산에 필요한 정보를 확인해 주세요', detail: '계산하지 못했거나 진행 조건을 확인해야 하는 묶음이 있어요.', label: '확인할 항목 보기', run: onRebalance }
    : triggered
    ? { title: '정해 둔 배분 범위를 벗어난 묶음이 있어요', detail: '목표 비율과 현재 비율을 비교하고 이번 납입 계획을 살펴보세요.', label: '리밸런싱 확인', run: onRebalance }
    : { title: '최근에 납입·거래·상환이 있었나요?', detail: '달라진 내역을 반영하면 우리 자산 현황을 정확하게 확인할 수 있어요.', label: '등록 자산 확인', run: onAssets }
  return <section aria-label="우리 자산 한눈에" className="shrink-0 border-b border-grey-200 px-4 py-5 sm:px-6">
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-1">
      <h1 className="text-xl font-semibold">{owner === 'together' ? '우리 부부' : owner === 'me' ? '나' : '배우자'}의 자산 현황</h1>
      <p className="text-xs text-grey-600">선택한 소유자 기준 · 등록 자료로 계산</p>
    </div>
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {[
        ['순자산', dashboard.net, '총자산에서 대출을 뺀 금액'],
        ['노후 주머니', dashboard.retirement, '연금 등 노후를 위해 모은 돈'],
        ['현금 주머니', dashboard.cash, '예금·주식 등 연금 외 금융자산'],
      ].map(([label, value, note], i) => <div key={label} className={i === 0 ? 'col-span-2 sm:col-span-1' : ''}>
        <dt className="text-sm text-grey-700">{label}</dt>
        <dd className="mt-1 break-words text-xl font-semibold tabular-nums sm:text-2xl">{Number(value).toLocaleString('ko-KR')}<span className="ml-1 text-sm font-normal">원</span></dd>
        <dd className="mt-1 text-xs text-grey-600">{note}</dd>
      </div>)}
    </dl>
    <div className="mt-5 flex flex-col items-start gap-3 rounded-lg bg-grey-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="mb-1 text-xs text-grey-600">다음 할 일</p><h2 className="text-base font-semibold">{action.title}</h2><p className="mt-1 text-sm text-grey-700">{action.detail}</p></div>
      <Button className="min-h-11 shrink-0" onClick={action.run}>{action.label}<ArrowRight className="size-4"/></Button>
    </div>
  </section>
}
