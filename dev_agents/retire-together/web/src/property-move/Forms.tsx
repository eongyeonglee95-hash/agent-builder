import { useCallback, useState, type FormEvent } from 'react'
import { Check, Search } from 'lucide-react'
import { AddressSearch, KeySetup, sourceLabel, type Address, type HomeList } from '../property-entry'
import { money } from '../model'
import { TradeReport, useTrades } from './Market'
import { dateToday, emptyLiving, type Candidate, type MovePlan } from './types'

export function Amount({ label, value, onChange, hint }: { label: string; value: number | null; onChange: (n: number | null) => void; hint?: string }) {
  return <label className="property-move-field"><span>{label}</span><span className="property-move-amount-input"><input aria-label={label} inputMode="numeric" value={value === null ? '' : (value / 10_000).toLocaleString('ko-KR', { maximumFractionDigits: 4 })} placeholder="미입력" onChange={e => { const raw = e.target.value.replace(/[^\d.]/g, ''); if (!/^\d{0,11}(\.\d{0,4})?$/.test(raw)) return; onChange(raw === '' ? null : Math.round(Number(raw) * 10_000)) }}/><span>만원</span></span><small>{value !== null ? money(value) : hint ?? '모르면 비워 두세요. 0원과 구분해요.'}</small></label>
}

export const LIVING_FIELDS = [['school', '학군·통학', '예: ○○초 도보 5분, 중학교 배정 확인 필요'], ['commute', '출퇴근·교통', '예: 회사까지 지하철 35분, 2호선 도보 8분'], ['life', '생활·단지', '예: 2008년 입주 1,200세대, 관리비 25만, 마트 도보'], ['concerns', '단점·확인할 것', '예: 대로변 소음, 주차 1.1대, 수리 필요']] as const

export function CandidateForm({ initial, onSave, onDelete }: { initial?: Candidate; onSave: (c: Candidate) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [d, setD] = useState<Candidate>(() => initial ?? { id: crypto.randomUUID(), name: '', address: null, area_m2: null, price: null, price_basis: 'manual', price_date: null, asking_low: null, asking_high: null, asking_date: null, purchase_costs: null, memo: '', living: emptyLiving() })
  const [search, setSearch] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = <K extends keyof Candidate>(key: K, value: Candidate[K]) => setD(old => ({ ...old, [key]: value }))
  const pick = useCallback((address: Address) => { setD(old => ({ ...old, address, name: address.building || old.name })); setSearch(false) }, [])
  const market = useTrades(d.address, d.name, d.area_m2)
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!d.name.trim()) { setError('단지 이름을 입력해 주세요.'); return }
    if (d.price === 0 || (d.asking_high !== null && (d.asking_low === null || d.asking_high < d.asking_low))) { setError('계획 매수가와 최저·최고 호가를 확인해 주세요.'); return }
    setBusy(true)
    try { await onSave({ ...d, name: d.name.trim() }) } catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return <form className="property-move property-move-form" onSubmit={submit}>
    <p className="property-move-form-intro">살고 싶은 집을 모아두고, 같은 자금으로 비교해요.</p>
    <button type="button" className="property-move-address-button" onClick={() => setSearch(v => !v)}><Search size={17}/>{d.address ? d.address.road : '단지·주소 검색'}<span>검색</span></button>
    {search && <><AddressSearch onPick={pick}/><p className="property-move-note">주소 검색어는 카카오 우편번호 서비스로 전송돼요.</p></>}
    <div className="property-move-form-grid">
      <label className="property-move-field"><span>단지 이름</span><input required maxLength={100} value={d.name} onChange={e => set('name', e.target.value)} placeholder="희망하는 아파트"/></label>
      <label className="property-move-field"><span>전용면적 (㎡)</span><input type="number" min="1" max="2000" step="0.01" value={d.area_m2 ?? ''} onChange={e => set('area_m2', e.target.value ? Number(e.target.value) : null)} placeholder="예: 84.9"/></label>
    </div>
    <div className="property-move-form-grid">
      <Amount label="계획 매수가" value={d.price} onChange={price => setD(old => ({ ...old, price, price_basis: 'manual', price_date: price === null ? null : dateToday() }))} hint="이 가격에 산다고 가정해 비교해요."/>
      <Amount label="취득세·중개·이사비" value={d.purchase_costs} onChange={v => set('purchase_costs', v)} hint="직접 확인한 비용 합계 · 비우면 계산에서 제외"/>
    </div>
    <p className="property-move-note">계획 매수가 기준: {d.price_basis === 'trade' ? '선택한 실거래' : d.price_basis === 'asking' ? '기록한 호가' : '직접 입력'}{d.price_date ? ` · ${d.price_date}` : ''}</p>
    <details className="property-move-form-details"><summary>실거래 확인하고 가격에 반영</summary><TradeReport market={market} hidden={false} onPick={t => setD(old => ({ ...old, price: t.price, price_basis: 'trade', price_date: t.date }))}/>{market.configured === false && <KeySetup onDone={market.retry}/>}</details>
    <details className="property-move-form-details" open={!!initial?.asking_low || undefined}><summary>현재 호가 기록</summary>
      <p className="property-move-note">매물에서 확인한 금액을 기록해요. 실거래·계획 매수가와 별도로 보관합니다.</p>
      {d.name && <a className="property-move-link" href={`https://m.land.naver.com/search/result/${encodeURIComponent(d.name)}`} target="_blank" rel="noreferrer">네이버 부동산에서 매물 확인 ↗</a>}
      <div className="property-move-form-grid"><Amount label="최저 호가" value={d.asking_low} onChange={v => setD(old => ({ ...old, asking_low: v, asking_high: v === null ? null : old.asking_high, asking_date: v === null ? null : old.asking_date || dateToday() }))}/><Amount label="최고 호가" value={d.asking_high} onChange={v => set('asking_high', v)}/></div>
      {d.asking_low !== null && <><label className="property-move-field"><span>호가 확인일</span><input type="date" required value={d.asking_date ?? ''} max={dateToday()} onChange={e => set('asking_date', e.target.value || null)}/></label><button type="button" className="property-move-link" onClick={() => setD(old => ({ ...old, price: old.asking_low, price_basis: 'asking', price_date: old.asking_date }))}>최저 호가를 계획 매수가로 사용</button></>}
    </details>
    <details className="property-move-form-details" open={Object.values(d.living).some(Boolean) || undefined}><summary>거주 정보 · 학군·출퇴근·생활</summary>
      <p className="property-move-note">직접 확인한 내용을 적어요. 자동으로 조회하거나 점수를 매기지 않아요.</p>
      <div className="property-move-form-grid">{LIVING_FIELDS.map(([key, label, hint]) => <label className="property-move-field" key={key}><span>{label}</span><textarea rows={2} maxLength={300} placeholder={hint} value={d.living[key]} onChange={e => setD(old => ({ ...old, living: { ...old.living, [key]: e.target.value } }))}/></label>)}</div>
    </details>
    <label className="property-move-field"><span>비교 메모</span><textarea rows={2} maxLength={300} placeholder="예: 출퇴근 30분, 남향, 수리 필요" value={d.memo} onChange={e => set('memo', e.target.value)}/></label>
    {error && <p className="property-move-error" role="alert">{error}</p>}
    <div className="property-move-form-actions">{onDelete && <button type="button" className="property-move-link" disabled={busy} onClick={async () => { if (!confirmDelete) { setConfirmDelete(true); return } setBusy(true); try { await onDelete() } catch (e) { setError((e as Error).message); setBusy(false) } }}>{confirmDelete ? '이 후보 삭제 확인' : '후보 삭제'}</button>}<button className="property-move-button primary" disabled={busy}><Check size={15}/>{busy ? '저장 중…' : '후보 저장'}</button></div>
  </form>
}

export function FundsForm({ plan, homes, cashReference, onSave }: { plan: MovePlan; homes: HomeList; cashReference: number; onSave: (p: MovePlan) => Promise<void> }) {
  const [d, setD] = useState(plan)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof MovePlan>(key: K, value: MovePlan[K]) => setD(old => ({ ...old, [key]: value }))
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { await onSave(d) } catch (e) { setError((e as Error).message); setBusy(false) } }
  return <form className="property-move property-move-form" onSubmit={submit}>
    <p className="property-move-form-intro">이사에 쓸 자금만 골라요. 연금은 포함하지 않아요.</p>
    <fieldset className="property-move-home-choices"><legend>팔고 갈 집</legend><p className="property-move-note">선택한 집의 등록 시세에서 연결 대출과 반환 보증금을 빼요. 첫 집 마련이라면 선택 없이 진행하세요.</p>
      {homes.homes.map(h => <label key={h.asset.id}><input type="checkbox" checked={d.source_home_ids.includes(h.asset.id)} onChange={e => set('source_home_ids', e.target.checked ? [...d.source_home_ids, h.asset.id] : d.source_home_ids.filter(id => id !== h.asset.id))}/><span><b>{h.asset.name}</b><small>{sourceLabel(h.detail?.value_source)} · {h.asset.as_of}</small></span><strong>{money(h.metrics.equity_mine)}</strong></label>)}
      {d.source_home_ids.some(id => !homes.homes.some(h => h.asset.id === id)) && <button type="button" className="property-move-link" onClick={() => set('source_home_ids', d.source_home_ids.filter(id => homes.homes.some(h => h.asset.id === id)))}>삭제된 집을 계획에서 제외하기</button>}
    </fieldset>
    <Amount label="이사에 쓸 모아둔 돈" value={d.cash} onChange={v => set('cash', v)} hint="예금·주식 중 이사에 배정할 현재 금액 · 없으면 0 입력"/>
    <p className="property-move-note">등록한 현금 주머니 {money(cashReference)} 참고 · 이 중 사용할 금액만 입력하세요.</p>
    <div className="property-move-form-grid"><Amount label="매도세금·비용" value={d.sale_costs} onChange={v => set('sale_costs', v)} hint="양도세·매도 중개비 등 확인한 합계"/><Amount label="추가 대출 가정" value={d.new_loan} onChange={v => set('new_loan', v ?? 0)} hint="승인 가능한 대출액과 다를 수 있어요."/></div>
    <p className="property-move-note">세금은 자동 계산하지 않아요. 매도세금·비용을 비우면 해당 금액이 빠진 잠정 계획입니다. 추가 대출은 자기자금과 구분해요.</p>
    <div className="property-move-form-grid"><label className="property-move-field"><span>이사 목표 시점</span><input type="month" min={dateToday().slice(0, 7)} max="2199-12" value={d.target_month ?? ''} onChange={e => set('target_month', e.target.value || null)}/></label><Amount label="매달 더 모을 돈" value={d.monthly_saving} onChange={v => set('monthly_saving', v ?? 0)}/></div>
    {error && <p className="property-move-error" role="alert">{error}</p>}
    <div className="property-move-form-actions"><button className="property-move-button primary" disabled={busy}><Check size={15}/>{busy ? '저장 중…' : '자금 계획 저장'}</button></div>
  </form>
}
