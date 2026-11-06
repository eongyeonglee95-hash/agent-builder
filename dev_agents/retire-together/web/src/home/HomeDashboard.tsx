import type { ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, CirclePlus, Eye, EyeOff, House, RefreshCw, Users, Wallet } from 'lucide-react'
import { Donut, IncomeChart, PanelHeading, StrategyStack } from '../components'
import { assetOwnerLabel, assetSourceLabel, money, ownerLabels, type Asset, type Owner, type Snapshot, type Strategy } from '../model'
import './home.css'

type Props = {
  snapshot: Snapshot
  owner: Owner
  scope: string
  hidden: boolean
  isDemo: boolean
  loading: boolean
  error: string
  strategies: Strategy[]
  largestDeviation: number | null
  retirementCard: ReactNode
  checklist: ReactNode
  onOwner: (owner: Owner) => void
  onHide: () => void
  onAdd: () => void
  onAssets: (pocket?: string) => void
  onEdit: (asset: Asset) => void
  onProfile: () => void
  onDemo: () => void
  onPension: () => void
  onRebalance: () => void
  onStrategy: () => void
}

export function HomeDashboard(props: Props) {
  const { snapshot, owner, scope, hidden, isDemo, loading, error, onOwner, onHide, onAdd, onAssets, onEdit, onProfile, onDemo, onPension, onRebalance, onStrategy } = props
  const pending = !isDemo && loading
  const failed = !isDemo && !!error
  const ready = !pending && !failed
  const populated = ready && snapshot.count > 0
  const ledger = [...snapshot.assets, ...snapshot.debts]
  const stale = isDemo ? [] : ledger.filter(a => a.as_of && (Date.now() - new Date(`${a.as_of}T00:00:00`).getTime()) / 86_400_000 >= 30)
  const recent = isDemo ? [] : [...ledger].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).slice(0, 4)
  const display = (amount: number) => hidden ? '••••••' : !ready ? '—' : money(amount)
  const status = pending ? '자료를 불러오고 있어요' : failed ? '자료를 확인해 주세요' : isDemo ? '예시 자료 · 실제 자산과 별개' : !populated ? '등록한 자산부터 함께 보여드려요' : `${snapshot.as_of?.replaceAll('-', '.') ?? '등록일'} 기준 · 직접 등록한 자료`

  const pockets = [
    { id: 'retirement', label: '노후 주머니', title: <>함께 누릴,<br/>조금 더 긴 내일.</>, note: '연금·퇴직연금으로 준비하는 은퇴', image: '/coastal-couple.png', amount: snapshot.retirement, action: onPension, actionLabel: '연금 계획 살펴보기' },
    { id: 'cash', label: '현금 주머니', title: <>살고 싶은 집,<br/>하고 싶은 일.</>, note: '예금·주식 등 연금 밖 금융자산', image: '/home-future-living.jpg', amount: snapshot.cash, action: () => onAssets('cash'), actionLabel: '현금 자산 살펴보기' },
  ]

  return <div className="home-dashboard" aria-busy={pending}>
    <div className="home-toolbar">
      <span className="home-scope">{scope}의 자산 노트</span>
      <div className="home-owner" role="group" aria-label="자산 소유자 선택">
        {(Object.keys(ownerLabels) as Owner[]).map(key => <button key={key} onClick={() => onOwner(key)} aria-pressed={owner === key}>{ownerLabels[key]}</button>)}
      </div>
    </div>

    <header className="home-opening">
      <div className="home-heading">
        <h1>오늘을 모아,<br/><span>함께 누릴 내일.</span></h1>
        <p>각자의 자산을 한곳에.<br/>두 사람의 다음을 함께 준비해요.</p>
        <button className="home-button" onClick={onAdd} disabled={pending}><CirclePlus size={17}/>자산 등록<ArrowRight size={17}/></button>
      </div>
      <section className="home-balance" aria-label="자산 요약">
        <div className="home-balance-label"><span>{scope}의 순자산</span><button className="home-icon-button" onClick={onHide} aria-label={hidden ? '금액 표시' : '금액 숨기기'}>{hidden ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
        <button className="home-net" onClick={() => onAssets()} aria-label="순자산 상세 보기"><strong className="stat-number">{populated ? display(snapshot.net) : hidden ? '••••••' : '—'}</strong><ArrowUpRight size={24}/></button>
        <p className="home-data-status">{status}</p>
        <dl className="home-balance-parts">
          <div><dt>총자산</dt><dd>{populated ? display(snapshot.total) : '—'}</dd></div>
          <div><dt>대출·부채</dt><dd>{populated ? display(snapshot.debt) : '—'}</dd></div>
        </dl>
        <p className="home-balance-note">총자산에서 대출·부채를 뺀 금액이에요.</p>
      </section>
    </header>

    <section className="home-pockets" aria-label="우리의 두 주머니">
      {pockets.map(pocket => {
        const hasAssets = populated && snapshot.assets.some(asset => asset.pocket === pocket.id)
        const share = hasAssets && snapshot.financial > 0 ? pocket.amount / snapshot.financial * 100 : null
        return <article className={`home-pocket home-pocket-${pocket.id}`} key={pocket.id} aria-label={pocket.label}>
          <div className="home-pocket-photo">
            <img src={pocket.image} alt="" fetchPriority={pocket.id === 'retirement' ? 'high' : 'auto'}/>
            <div className="home-pocket-copy"><span>{pocket.label}</span><h2>{pocket.title}</h2></div>
            <button className="home-photo-link" onClick={pocket.action}>{pocket.actionLabel}<ArrowUpRight size={18}/></button>
          </div>
          <button className="home-pocket-balance" onClick={() => hasAssets ? onAssets(pocket.id) : onAdd()} disabled={pending || failed} aria-label={hasAssets ? `${pocket.label} 상세 보기` : `${pocket.label} 자산 등록`}>
            <span className="home-pocket-label">{pocket.label}<ArrowRight size={18}/></span>
            <strong className="home-pocket-number">{hidden ? '••••••' : !ready ? '—' : hasAssets ? money(pocket.amount) : '등록 전'}</strong>
            <span className="home-pocket-note">{pocket.note}</span>
            <span className="home-pocket-divider"/>
            <span className="home-pocket-share">{!ready ? pending ? '불러오는 중' : '자료 확인 후 표시해요' : !hasAssets ? '금액 하나부터 채워보세요' : hidden ? '금액을 숨겼어요' : share === null ? '등록 금액 기준' : <>금융자산 중 <b>{share.toFixed(1)}%</b></>}</span>
          </button>
        </article>
      })}
    </section>
    <p className="home-pockets-note">두 주머니는 금융자산 기준이에요. 부동산과 대출은 전체 자산에서 함께 확인해요.</p>

    {ready && !populated && <section className="home-empty" aria-label="자산 등록 시작">
      <div><span className="home-section-label">우리의 첫 기록</span><h2>자산 하나부터 시작해요.</h2><p>지금 알고 있는 계좌와 금액이면 충분해요.<br/>가족 정보와 은퇴 목표는 천천히 채워도 괜찮아요.</p></div>
      <div className="home-empty-actions"><ol><li>종류와 금액 입력</li><li>입력 내용 확인</li><li>두 주머니에서 확인</li></ol><button className="home-text-button" onClick={onDemo}>예시로 둘러보기<ArrowRight size={17}/></button></div>
    </section>}

    {populated && <>
      <section className="home-today" aria-label="다음 할 일">
        <div><span className="home-section-label">오늘, 한 가지만</span><h2>{stale.length ? `${stale.length}개 자산의 금액을 확인해 주세요` : '최근에 납입이나 거래가 있었나요?'}</h2><p>{stale.length ? '기준일이 30일 이상 지난 자료예요. 바뀐 금액을 반영해 주세요.' : '달라진 금액과 기준일만 갱신하면 우리 자산도 함께 달라져요.'}</p></div>
        <button className="home-button" onClick={() => stale.length ? onEdit(stale[0]) : onAssets()}>{stale.length ? '오래된 금액 갱신' : '등록 내역 확인'}<ArrowRight size={17}/></button>
      </section>

      <div className="home-detail-grid">
        <section className="panel home-assets-panel"><PanelHeading title="흩어진 자산, 한눈에"><button className="home-text-button" onClick={() => onAssets()}>전체 내역<ArrowRight size={16}/></button></PanelHeading><Donut items={snapshot.classes} total={snapshot.total} hidden={hidden}/><p className="home-small-note">연금 안의 자산도 주식·채권 등 자산군으로 한 번만 집계해요.</p></section>
        <div className="home-goal-stack">{props.retirementCard}<button className="home-review" onClick={onRebalance}><RefreshCw size={20}/><span><strong>우리의 투자 원칙 점검하기</strong><small>{props.largestDeviation === null ? '등록 자산과 정해 둔 비율을 비교해요' : `${isDemo ? '예시 ' : ''}연금 자산 · 최대 편차 ${props.largestDeviation.toFixed(1)}%p`}</small></span><ArrowRight size={18}/></button></div>
      </div>

      {recent.length > 0 && <section className="panel recent-assets home-recent"><PanelHeading title="최근 등록·갱신한 자산"><button className="home-text-button" onClick={() => onAssets()}>전체 내역<ArrowRight size={16}/></button></PanelHeading>{recent.map(asset => <button className="recent-asset" key={asset.id} onClick={() => onEdit(asset)}><span className="home-asset-icon">{asset.pocket === 'property' ? <House size={20}/> : <Wallet size={20}/>}</span><span><strong>{asset.name}</strong><small>{assetOwnerLabel(asset.owner)} · {asset.as_of ?? '기준일 미입력'} · {assetSourceLabel(asset)}</small></span><b>{display(asset.amount)}</b><span className="recent-edit">금액 갱신 <ArrowRight size={14}/></span></button>)}</section>}

      {!isDemo && snapshot.partner_missing && owner === 'together' && <button className="home-family" onClick={onAdd}><Users size={20}/><span>배우자 자산도 모아볼까요?<small>등록하면 부부 합계에 함께 담겨요.</small></span><ArrowRight size={18}/></button>}

      <details className="home-more"><summary>투자 원칙과 준비 현황<span>자세히 보기</span></summary><div className="home-more-content"><section className="panel"><PanelHeading title="흔들리지 않는, 우리의 규칙"/><StrategyStack strategies={props.strategies}/><button className="home-text-button" onClick={onStrategy}>전략 살펴보기<ArrowRight size={16}/></button></section><section className="panel"><PanelHeading title="은퇴 후의 한 달"/>{isDemo ? <><IncomeChart hidden={hidden}/><p className="home-small-note">화면 검수를 위한 고정 예시이며 실제 연금 전망이 아닙니다.</p></> : <><p className="home-small-note">연금 화면에서 수령액과 생활비 목표를 함께 살펴보세요.</p><button className="home-text-button" onClick={onPension}>은퇴 계획 살펴보기<ArrowRight size={16}/></button><button className="home-text-button" onClick={onProfile}>이름·가족·목표 설정<ArrowRight size={16}/></button></>}</section></div></details>
      <div className="home-checklist">{props.checklist}</div>
    </>}
  </div>
}
