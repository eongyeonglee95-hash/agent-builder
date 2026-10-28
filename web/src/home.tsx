import { ArrowRight, CirclePlus, Clock3, House, RefreshCw, Sprout, Users, Wallet } from 'lucide-react'
import { PanelHeading, StatCard } from './components'
import { assetOwnerLabel, assetSourceLabel, ownerLabels, money, type Asset, type Family, type Owner, type Snapshot } from './model'

export function HomeSummary({ snapshot, family, owner, hidden, loading, onHide, onOwner, onAdd, onAssets, onEdit, onProfile, onDemo }: {
  snapshot: Snapshot; family: Family | null; owner: Owner; hidden: boolean; loading: boolean;
  onOwner: (owner: Owner) => void; onHide: () => void; onAdd: () => void; onAssets: () => void; onEdit: (asset: Asset) => void; onProfile: () => void; onDemo: () => void
}) {
  const all = [...snapshot.assets, ...snapshot.debts]
  const old = all.filter(a => a.as_of && (Date.now() - new Date(`${a.as_of}T00:00:00`).getTime()) / 86_400_000 >= 30)
  const recent = [...all].sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).slice(0, 4)
  const display = (value: number) => hidden ? '••••••' : money(value)
  const scope = owner === 'together' ? '우리 부부' : family?.[owner]?.name ?? (owner === 'me' ? '나' : '배우자')
  return <div className="home-summary"><div className="owner-switch" role="group" aria-label="자산 소유자 선택">{(Object.keys(ownerLabels) as Owner[]).map(key => <button key={key} onClick={() => onOwner(key)} className={owner === key ? 'active' : ''} aria-pressed={owner === key}>{ownerLabels[key]}</button>)}</div>
    <section className={`start-card ${snapshot.count ? 'has-assets' : ''}`}><div><span className="editorial-kicker">OUR NEXT CHAPTER</span><h1>{snapshot.count ? `${scope}의 오늘` : '자산 하나부터 시작해요.'}</h1><p>{snapshot.count ? '등록한 숫자를 확인하고, 바뀐 금액만 갱신해요.' : '가족 정보와 은퇴 목표는 나중에 채워도 괜찮아요.\n지금 알고 있는 금액 하나면 충분해요.'}</p><button className="primary-button" onClick={onAdd} disabled={loading}><CirclePlus size={16}/>자산 등록<ArrowRight size={15}/></button>{!snapshot.count && <button className="start-example" onClick={onDemo}>예시로 둘러보기</button>}</div><div className="start-illustration" aria-hidden="true"><span/><Wallet size={46}/><Sprout size={28}/></div></section>
    {snapshot.count > 0 && <>
      <div className="home-data-caption"><span><Clock3 size={13}/>등록 자료 기준 · 자동 시세 연결 전</span><span>등록된 계좌·자산 {snapshot.count}개</span></div>
      <div className="stats-grid"><StatCard title="현재 등록한 자산" value={snapshot.total} note={`부채 ${display(snapshot.debt)} · 순자산 ${display(snapshot.net)}`} hidden={hidden} onHide={onHide} onClick={onAssets}/><StatCard title="노후 주머니" value={snapshot.retirement} note="연금에 등록한 금액" hidden={hidden} onClick={onAssets}/><StatCard title="현금 주머니" value={snapshot.cash} note="예금·주식 등에 등록한 금액" hidden={hidden} onClick={onAssets}/></div>
      <section className="next-action panel"><div className="soft-icon"><RefreshCw size={22}/></div><div><small>이번에 확인할 일</small><h2>{old.length ? `${old.length}개 자산의 금액을 확인해 주세요.` : '지난번과 금액이 달라졌나요?'}</h2><p>{old.length ? '마지막 기준일로부터 30일 이상 지난 자료입니다. 시세 변동이나 거래가 있었다면 갱신해 주세요.' : '납입·거래·상환이 있었다면 해당 자산의 금액과 기준일만 바꾸면 돼요.'}</p></div><button className="secondary-button" onClick={() => old.length ? onEdit(old[0]) : onAssets}>{old.length ? '오래된 금액 갱신' : '등록 내역 확인'}<ArrowRight size={14}/></button></section>
      <section className="panel recent-assets"><PanelHeading title="최근 등록·갱신한 자산"><button className="text-link" onClick={onAssets}>전체 내역 <ArrowRight size={13}/></button></PanelHeading>{recent.map(asset => <button className="recent-asset" key={asset.id} onClick={() => onEdit(asset)}><span className="soft-icon">{asset.pocket === 'property' ? <House size={17}/> : <Wallet size={17}/>}</span><span><strong>{asset.name}</strong><small>{assetOwnerLabel(asset.owner)} · {asset.as_of} 기준 · {assetSourceLabel(asset)}</small></span><b>{display(asset.amount)}</b><span className="recent-edit">금액 갱신 <ArrowRight size={12}/></span></button>)}</section>
      <details className="optional-fields home-progress"><summary>우리 자료, 어디까지 등록했나요? <span>상태 확인</span></summary><div className="home-progress-items"><p><CheckDot ok={!snapshot.partner_missing}/>{snapshot.partner_missing ? '배우자 자산은 아직 미등록입니다. 현재 합계에 포함되어 있지 않아요.' : '배우자 또는 공동 소유 자산이 등록되어 있어요.'}</p><p><CheckDot ok={!snapshot.goal_missing}/>{snapshot.goal_missing ? '은퇴 목표는 아직 미정입니다. 자산 등록에는 필요하지 않아요.' : '입력한 은퇴 목표가 있어요. 가능 시점 계산과는 구분해요.'}</p><button className="text-link" onClick={onProfile}><Users size={14}/>이름·가족·목표 설정 <ArrowRight size={13}/></button></div></details>
    </>}
    {!snapshot.count && !loading && <div className="start-steps"><span><b>1</b>종류와 금액 입력</span><i/><span><b>2</b>입력 내용 확인</span><i/><span><b>3</b>홈에서 결과 확인</span></div>}
  </div>
}
function CheckDot({ ok }: { ok: boolean }) { return <span className={`check-dot ${ok ? 'ok' : ''}`} aria-hidden="true"/> }
