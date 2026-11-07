import type { ComponentProps } from 'react'
import { ArrowRight, ArrowUpRight, CalendarDays, ChevronRight, CirclePlus, Clock3, Eye, EyeOff, House, RefreshCw, Wallet } from 'lucide-react'
import { Donut, IncomeChart, PanelHeading, Ring, StrategyStack } from '../components'
import { assetOwnerLabel, assetSourceLabel, money, ownerLabels, type Owner } from '../model'
import type { HomeDashboard } from './HomeDashboard'
import './classic-home.css'

// concept.jpg의 정보 순서. 미등록 상태에도 같은 대시보드 틀을 유지한다.
export function ClassicHome(props: ComponentProps<typeof HomeDashboard>) {
  const { snapshot, owner, scope, hidden, isDemo, loading, error, onOwner, onHide, onAdd, onAssets, onEdit, onPension, onRebalance, onStrategy } = props
  const ready = isDemo || (!loading && !error)
  const populated = ready && snapshot.count > 0
  const display = (value: number) => hidden ? '••••••' : ready ? money(value) : '—'
  const ledger = [...snapshot.assets, ...snapshot.debts]
  const stale = isDemo || !ready ? [] : ledger.filter(a => a.as_of && (Date.now() - new Date(`${a.as_of}T00:00:00`).getTime()) / 86_400_000 >= 30)
  const recent = isDemo || !ready ? [] : [...ledger].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).slice(0, 4)
  const status = !ready ? loading ? '불러오는 중' : '자료 확인 필요' : isDemo ? '예시 자료' : snapshot.as_of ? `${snapshot.as_of.replaceAll('-', '.')} 기준` : '등록된 자산 없음'
  // 순서 (2026-11-07 사용자): 노후 주머니(메인) → 갈아타기 재원 → 두 주머니와 부동산을 더한 총자산
  const cards = [
    { id: 'retirement', title: '노후 주머니', amount: snapshot.retirement, registered: populated && snapshot.assets.some(a => a.pocket === 'retirement'), note: '금융자산 중 · 연금·퇴직연금', color: 'var(--accent-hi)' },
    { id: 'cash', title: '갈아타기 재원', amount: snapshot.cash, registered: populated && snapshot.assets.some(a => a.pocket === 'cash'), note: '현금 주머니 · 예금·주식', color: 'var(--cls-commodity)' },
    { id: 'all', title: '총자산', amount: snapshot.total, registered: populated, note: `순자산 ${populated ? display(snapshot.net) : '—'}`, color: 'var(--primary)' },
  ]
  return <div className="classic-home" aria-busy={!isDemo && loading}>
    <header className="classic-home-heading">
      <div><h1>{scope}의 자산 현황</h1><p>{status}</p></div>
      <div className="classic-home-controls"><div className="owner-switch" role="group" aria-label="자산 소유자 선택">{(Object.keys(ownerLabels) as Owner[]).map(key => <button key={key} onClick={() => onOwner(key)} className={owner === key ? 'active' : ''} aria-pressed={owner === key}>{ownerLabels[key]}</button>)}</div><button className="register-shortcut" onClick={onAdd} disabled={!isDemo && loading}><CirclePlus size={15}/>자산 등록</button></div>
    </header>
    <section className="stats-grid" aria-label="자산 요약">
      {cards.map(card => <article className={`stat-card ${card.id === 'all' ? 'total-stat' : card.id === 'retirement' ? 'pocket-hero' : ''}`} aria-label={card.title} key={card.id}>
        <div className="stat-top"><h2>{card.title}</h2>{card.id === 'all' ? <button className="icon-button" onClick={onHide} aria-label={hidden ? '금액 표시' : '금액 숨기기'}>{hidden ? <EyeOff size={16}/> : <Eye size={16}/>}</button> : <ArrowUpRight size={16} className="muted"/>}</div>
        <button className="stat-body" onClick={() => onAssets(card.id)} disabled={!ready} aria-label={`${card.title} 상세 보기`}><strong className="stat-number">{hidden ? '••••••' : !ready ? '—' : card.registered ? money(card.amount) : '미등록'}</strong>{card.id !== 'all' && <Ring value={!hidden && card.registered && snapshot.financial > 0 ? card.amount / snapshot.financial * 100 : 0} color={card.color}>{hidden ? <strong>••</strong> : !ready || !card.registered || snapshot.financial <= 0 ? <strong>—</strong> : undefined}</Ring>}</button>
        <p className="stat-note">{card.note}</p>
      </article>)}
    </section>
    <div className="dashboard-grid">
      <section className="panel assets-panel" aria-label="자산 구성"><PanelHeading title="자산 구성 현황"><button className="text-link" onClick={() => onAssets()}>상세 보기<ChevronRight size={13}/></button></PanelHeading>
        {populated && snapshot.total > 0 && snapshot.classes.length > 0 ? <Donut items={snapshot.classes} total={snapshot.total} hidden={hidden}/> : <div className="classic-empty-chart"><div>{hidden ? '••••' : ready ? '미등록' : '—'}</div><span>주식 · 채권 · 현금 · 부동산</span></div>}
        <div className="asset-summary"><span>대출·부채 <b>{populated ? display(snapshot.debt) : '—'}</b></span><span>순자산 <strong>{populated ? display(snapshot.net) : '—'}</strong></span></div>
      </section>
      <div className="right-stack">{props.retirementCard}
        <section className="panel alerts-panel"><PanelHeading title="주요 알림"/>
          {stale.length > 0 && <button className="alert-row" onClick={() => onEdit(stale[0])}><span className="alert-icon amber"><Clock3 size={16}/></span><span><strong>{stale.length}개 자산 금액 갱신</strong><small>기준일로부터 30일 경과</small></span><ChevronRight size={15}/></button>}
          <button className="alert-row" onClick={onRebalance}><span className="alert-icon amber"><RefreshCw size={16}/></span><span><strong>리밸런싱 점검</strong><small>{!ready || props.largestDeviation === null ? '등록 자산과 목표 비율 비교' : `${isDemo ? '예시 · ' : ''}연금 자산 최대 편차 ${props.largestDeviation.toFixed(1)}%p`}</small></span><ChevronRight size={15}/></button>
          <button className="alert-row" onClick={onPension}><span className="alert-icon purple"><CalendarDays size={16}/></span><span><strong>연금 수령 계획</strong><small>월 연금과 생활비 확인</small></span><ChevronRight size={15}/></button>
        </section>
      </div>
    </div>
    <div className="bottom-grid">
      <section className="panel strategy-panel"><PanelHeading title="전략별 자산 배분"><button className="text-link" onClick={onStrategy}>전략 보기<ChevronRight size={13}/></button></PanelHeading><StrategyStack strategies={props.strategies}/></section>
      <section className="panel income-panel"><PanelHeading title="가구 소득 흐름"><span className="outline-tag">{isDemo ? '예시' : '연금'}</span></PanelHeading>{isDemo ? <IncomeChart hidden={hidden}/> : <div className="classic-income-empty"><span>연금 화면에서 수령 계획을 확인하세요.</span><button className="text-link" onClick={onPension}>연금 보기<ArrowRight size={14}/></button></div>}</section>
    </div>
    <div className="classic-home-checklist">{props.checklist}</div>
    {recent.length > 0 && <section className="panel recent-assets"><PanelHeading title="최근 등록·갱신한 자산"><button className="text-link" onClick={() => onAssets()}>전체 내역<ArrowRight size={13}/></button></PanelHeading>{recent.map(asset => <button className="recent-asset" key={asset.id} onClick={() => onEdit(asset)}><span className="soft-icon">{asset.pocket === 'property' ? <House size={17}/> : <Wallet size={17}/>}</span><span><strong>{asset.name}</strong><small>{assetOwnerLabel(asset.owner)} · {asset.as_of} · {assetSourceLabel(asset)}</small></span><b>{display(asset.amount)}</b><span className="recent-edit">금액 갱신<ArrowRight size={12}/></span></button>)}</section>}
  </div>
}
