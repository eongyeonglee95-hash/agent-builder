import { useId } from 'react'
import { Info, X } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { PensionTaxCheck, PensionTaxRule } from '../workbook/retirement'
import './pension-tax-notice.css'

export function PensionTaxNotice({ checks, rule, year }: { checks: PensionTaxCheck[]; rule: PensionTaxRule; year: number }) {
  const uid = useId()
  const threshold = (rule.annual_threshold / 10000).toLocaleString('ko-KR')
  return <Popover.Root>
    <Popover.Trigger asChild><button type="button" className="tower-tax-badge" aria-label="개인연금 세금 확인"><Info size={12}/>세금 확인</button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="tower-tax-popover" side="top" align="end" sideOffset={8} collisionPadding={12}
      aria-labelledby={`${uid}-title`} aria-describedby={`${uid}-description`}>
      <div className="tower-tax-heading"><h3 id={`${uid}-title`}>개인연금 세금 확인</h3><Popover.Close aria-label="세금 안내 닫기"><X size={16}/></Popover.Close></div>
      <p className="tower-tax-date">{year}년 · 세전 · 그해 금액</p>
      <div className="tower-tax-people">{checks.map(check => <div key={check.person} data-testid={`pension-tax-${check.person}`}>
        <strong>{check.person === 'me' ? '나' : '배우자'} · 개인연금 연 {threshold}만 원 초과 예상</strong>
        <span>예상 연 수령액 <b data-won={check.annual_nominal}>{check.annual_nominal.toLocaleString('ko-KR')}원</b></span>
      </div>)}</div>
      <p id={`${uid}-description`}>과세 대상 금액을 확인하고, 종합과세와 {(rule.separate_rate_with_local_tax * 100).toLocaleString('ko-KR')}% 분리과세(지방세 포함)를 비교해 보세요.</p>
      <p className="tower-tax-note">3층 수령액으로 살펴본 안내예요. 세액공제 받지 않은 원금 등이 섞여 있으면 실제 과세 대상은 달라져요. 2층 IRP의 개인납입분·운용수익 등은 별도로 확인해 주세요.</p>
      <p className="tower-tax-note">현재 기준을 적용한 예상이며, 실제 수령 시점의 세법을 다시 확인해야 해요. 그래프의 연금액에서 세금을 차감한 것은 아니에요.</p>
      <a href={rule.source_url} target="_blank" rel="noreferrer">국세청 과세 기준 <span>· {rule.checked_on} 확인</span></a>
    </Popover.Content></Popover.Portal>
  </Popover.Root>
}
