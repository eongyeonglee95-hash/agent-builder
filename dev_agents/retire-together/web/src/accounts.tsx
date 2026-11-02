import { useState } from 'react'
import { Check, ChevronRight, Info, Plus, RefreshCw } from 'lucide-react'
import { PanelHeading } from './components'
import { api } from './local-data'
import { assetOwnerLabel, assetSourceLabel, money, type AccountGroup, type Asset } from './model'

export function assetInput(asset: Asset) {
  return { name: asset.name, account: asset.account, owner: asset.owner, pocket: asset.pocket, assetClass: asset.assetClass,
    amount: asset.full_amount ?? asset.amount, as_of: asset.as_of, parent_id: asset.parent_id ?? null,
    valuation_source: asset.valuation_source ?? 'total', share_percent: asset.share_percent ?? null }
}
export function AccountManager({ groups, hidden, onAddDetail, onSelect, onRefresh }: {
  groups: AccountGroup[]; hidden: boolean; onAddDetail: (parent: Asset) => void; onSelect: (asset: Asset) => void; onRefresh: () => void
}) {
  const display = (amount: number) => hidden ? '••••••' : money(amount)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  if (!groups.length) return null
  async function source(group: AccountGroup, next: 'total' | 'details') {
    setBusy(group.account.id); setError('')
    try { await api(`/assets/${group.account.id}`, 'PUT', { ...assetInput(group.account), valuation_source: next, version: group.account.version }); onRefresh() }
    catch (e) { setError(e instanceof Error ? e.message : '합산 기준을 바꾸지 못했습니다.') }
    finally { setBusy('') }
  }
  return <section className="panel account-manager"><PanelHeading title="한 계좌는 한 번만 합산해요" detail="계좌 총액과 안에 담긴 세부 자산을 연결해 관리할 수 있어요."/>
    {error && <div className="form-error" role="alert"><Info size={16}/>{error}<button onClick={onRefresh}>새로고침</button></div>}
    {groups.map(group => <details className="account-group" key={group.account.id}><summary><span><strong>{group.account.account}</strong><small>{assetOwnerLabel(group.account.owner)} · {group.account.as_of} 확인</small></span><span className="account-source-tag">{group.source === 'details' ? '세부 합계' : '계좌 총액'} 사용</span><ChevronRight size={16}/></summary><div className="account-group-body"><div className="source-options" role="group" aria-label={`${group.account.account} 합산 기준`}>
      <button disabled={!!busy} aria-pressed={group.source === 'total'} className={group.source === 'total' ? 'selected' : ''} onClick={() => source(group, 'total')}><span>{group.source === 'total' && <Check size={13}/>}계좌 총액</span><strong>{display(group.account.amount)}</strong><small>{group.account.as_of} 기준</small></button>
      <button disabled={!!busy || !group.details.length} aria-pressed={group.source === 'details'} className={group.source === 'details' ? 'selected' : ''} onClick={() => source(group, 'details')}><span>{group.source === 'details' && <Check size={13}/>}세부 자산 합계</span><strong>{group.details.length ? display(group.details_total) : '아직 미입력'}</strong><small>{group.details.length}개 세부 자산</small></button>
    </div>{group.details.length > 0 && <p className="source-difference">계좌 총액과의 차이: {group.difference > 0 ? '+' : ''}{display(group.difference)} · 선택한 한 기준만 홈에 반영됩니다.</p>}<div className="account-detail-list">{group.details.map(asset => <button key={asset.id} onClick={() => onSelect(asset)}><span>{asset.name}<small>{asset.as_of} 기준 · {assetSourceLabel(asset)}</small></span><strong>{display(asset.amount)}</strong><ChevronRight size={14}/></button>)}</div><div className="account-actions"><button className="secondary-button" onClick={() => onSelect(group.account)}><RefreshCw size={14}/>계좌 금액 갱신</button><button className="secondary-button" onClick={() => onAddDetail(group.account)}><Plus size={14}/>세부 자산 추가</button></div>{busy === group.account.id && <p role="status">합산 기준을 저장하고 있어요…</p>}</div></details>)}
  </section>
}
