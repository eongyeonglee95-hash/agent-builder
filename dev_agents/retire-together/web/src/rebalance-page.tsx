import { ArrowRight, BookOpen, RefreshCw, ShieldCheck } from 'lucide-react'
import { PanelHeading, StrategyStack, TextLink } from './components'
import { classInfo, type Owner, type Strategy } from './model'
import { RebalancePreview } from './rebalance'
import { RebalancePlan } from './workbook/RebalancePlan'

// 예전 카드형 화면의 리밸런싱 페이지 — 리밸런싱 영역 파일 (docs/WORK_AREAS.md). App.tsx는 이 컴포넌트 한 줄만 둔다.
// 실제 데이터: 워크북과 같은 리밸런싱 카드(RebalancePlan) + Codex의 CSV 계산 미리보기. 예시 보기: 예전 비교 화면.
type Deviation = { key: string; target: number; current: number; delta: number }

export function RebalancePage({ isDemo, owner, onChanged, onRegister, strategies, strategy, strategyId, onStrategy, onExamples,
  largestDeviation, deviations, canCompare, scopeLabel, retirementText }: {
  isDemo: boolean; owner: Owner; onChanged: () => void; onRegister: () => void
  strategies: Strategy[]; strategy: Strategy; strategyId: string; onStrategy: (id: string) => void; onExamples: () => void
  largestDeviation: number | null; deviations: Deviation[]; canCompare: boolean; scopeLabel: string; retirementText: string
}) {
  if (!isDemo) return <div className="rebalance-plan-embed">
    <RebalancePlan embedded owner={owner} live={false} rev={0} onChanged={onChanged} onError={msg => console.warn(msg)} onRegister={onRegister}/>
    <RebalancePreview key={owner} owner={owner}/>
  </div>
  return <><div className="rebalance-layout"><section className="panel"><PanelHeading title="지키고 싶은 투자 원칙" detail="세 원칙을 한 번에 비교해요. 비교해도 실제 운용 전략은 바뀌지 않아요."/><StrategyStack strategies={strategies} selected={strategyId} onSelect={onStrategy}/><div className="panel-bottom"><span><ShieldCheck size={15}/>비율과 종목은 사용자 결정</span><TextLink onClick={() => onExamples()}>예시 종목</TextLink></div></section><section className="panel rebalance-summary"><span className="soft-icon"><RefreshCw size={24}/></span><span className="eyebrow">STAY WITH YOUR PLAN</span><h2>{largestDeviation === null ? '비율 확인을 기다리고 있어요' : largestDeviation > strategy.threshold + 1e-9 ? '배분을 살펴볼 시간이에요' : '정해 둔 범위 안에 있어요'}</h2><p>{largestDeviation === null ? '출처와 목표 비율을 확정한 후 비교할 수 있어요.' : `${isDemo ? '예시 ' : ''}연금 자산의 최대 편차는 ${largestDeviation.toFixed(1)}%p예요. 점검 기준은 ±${strategy.threshold}%p입니다.`}</p><small>실제 주문표가 아닌 자산군 비교 예시</small></section></div><section className="panel allocation-panel"><PanelHeading title="목표와 현재, 얼마나 다를까요?" detail={`${scopeLabel}의 ${isDemo ? '예시 ' : ''}노후 주머니 · ${retirementText}`}><div className="allocation-key"><span><i/>목표</span><span><i/>{isDemo ? '현재 예시' : '등록 자산'}</span></div></PanelHeading>{deviations.length && canCompare && Object.keys(strategy.targets).length ? deviations.map(d => <div className="allocation-row" key={d.key}><span>{strategy.labels[d.key] ?? classInfo[d.key]?.label ?? d.key}</span><div className="allocation-bars"><div style={{ width: `${d.target}%` }}/><div style={{ width: `${d.current}%`, background: classInfo[d.key]?.color }}/></div><span>{d.target}% <ArrowRight size={13}/> {d.current.toFixed(1)}%</span><b className={Math.abs(d.delta) > strategy.threshold + 1e-9 ? 'deviation-warn' : ''}>{d.delta >= 0 ? '+' : ''}{d.delta.toFixed(1)}%p</b></div>) : <div className="empty-state"><BookOpen size={28}/><h3>비교에 필요한 정보를 먼저 확인해요</h3><p>노후 자산을 등록하고 혼합·미분류 항목의 자산군을 구분해 주세요.<br/>목표 비율이 확정된 전략에서 비교할 수 있어요.</p></div>}<div className="info-note"><ShieldCheck size={18}/><p>이 비교는 직접 등록한 자산 총액 기준입니다. 아래에서 계좌별 종목 잔고를 올리면 별도로 검토용 주문표를 계산할 수 있어요.</p></div></section></>
}
