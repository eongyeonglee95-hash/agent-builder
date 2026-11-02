import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronRight, House, MapPin, Plus, SlidersHorizontal, Target, Wallet } from 'lucide-react'
import { Modal } from '../components'
import { api } from '../local-data'
import { money, type Family, type Owner } from '../model'
import { DeleteHome, HomeMarket, HomeWizard, KeySetup, sourceLabel, TENURE, type Home, type HomeList } from '../property-entry'
import { Buildings } from './Buildings'
import { CandidateForm, FundsForm } from './Forms'
import { TradePrice, TradeReport, useTrades } from './Market'
import type { Budget, Candidate, MovePlan, MoveState } from './types'
import './property-move.css'

type Props = { owner: Owner; family: Family | null; hidden: boolean; onChanged: () => void; onDemo: () => void }
type Dialog = { type: 'home' | 'market' | 'delete'; home: Home | null; start?: 'value' } | { type: 'candidate'; candidate?: Candidate } | { type: 'funds' }
const display = (n: number | null | undefined, hidden: boolean) => hidden ? '••••' : n == null ? '—' : money(n)
const basis = { manual: '직접 입력', trade: '선택한 실거래', asking: '기록한 호가' }

function HomeLine({ home: h, hidden, family, owner, onEdit, onMarket }: { home: Home; hidden: boolean; family: Family | null; owner: Owner; onEdit: () => void; onMarket: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const dt = h.detail, m = h.metrics
  const market = useTrades(dt?.address, h.asset.name, dt?.area_m2)
  const show = (n: number | null) => display(n, hidden)
  const askingDate = dt?.listings?.map(l => l.checked_on).sort().at(-1)
  const stale = (Date.now() - Date.parse(h.asset.as_of)) / 86_400_000 > 90
  const gainKnown = dt?.value_source?.kind !== 'purchase' && dt?.value_source?.kind !== 'none' && m.gain !== null
  return <article className="property-move-home-item">
    <div className="property-move-home-line">
      <button className="property-move-home-identity" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
        <span className="property-move-home-symbol"><House size={22}/></span><span><strong>{h.asset.name}</strong><small>{dt?.area_m2 ? `전용 ${dt.area_m2}㎡` : '면적 미입력'} · {h.asset.owner === 'joint' ? `공동 · 나 ${h.asset.share_percent}%` : h.asset.owner === 'me' ? family?.me.name || '나' : family?.partner?.name || '배우자'}</small></span>
      </button>
      <div className="property-move-price-cell"><span>등록 시세 · 집 전체</span><strong>{dt?.value_source?.kind === 'none' ? '확인 필요' : show(h.full_value)}</strong><small>{sourceLabel(dt?.value_source)}{stale && ' · 90일 경과'}</small></div>
      <div className="property-move-price-cell"><span>최근 실거래 · 집 전체</span><TradePrice market={market} hidden={hidden}/></div>
      <button className="property-move-price-cell property-move-price-button" onClick={onMarket}><span>현재 호가 <ChevronRight size={12}/></span><strong>{h.asking ? `${show(h.asking.low)}${h.asking.high !== h.asking.low && !hidden ? ` ~ ${show(h.asking.high)}` : ''}` : '호가 기록'}</strong><small>{h.asking ? `직접 기록 ${h.asking.count}건 · ${askingDate ?? '확인일 미입력'}` : '확인한 매물 가격을 더해요'}</small></button>
      <div className="property-move-price-cell property-move-equity-cell"><span>{owner === 'together' ? '부동산 순자산' : '선택한 소유자 순자산'}</span><strong>{show(m.equity_mine)}</strong><small>대출·반환 보증금 차감</small></div>
      <button className="property-move-icon-button" aria-label={`${h.asset.name} 상세 ${expanded ? '접기' : '보기'}`} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}><ChevronDown size={18} className={expanded ? 'rotated' : ''}/></button>
    </div>
    {expanded && <div className="property-move-home-detail">
      <div className="property-move-home-facts"><div className="property-move-section-head"><h3>우리 집 거래 정보</h3><button className="property-move-link" onClick={onEdit}>집 정보 수정 <ChevronRight size={13}/></button></div><p className="property-move-note"><MapPin size={13}/>{dt?.address?.road || '주소를 등록하면 실거래가를 연결할 수 있어요.'}{dt ? ` · ${TENURE[dt.tenure]}` : ''}</p>
        <div className="property-move-value-comparison"><div><span>내 매입가 · 전체</span><strong>{show(dt?.purchase_price ?? null)}</strong><i style={{ height: !hidden && dt?.purchase_price ? `${Math.max(5, dt.purchase_price / Math.max(dt.purchase_price, h.full_value, 1) * 76)}px` : '6px' }}/></div><div><span>등록 시세 · 전체</span><strong>{show(h.full_value)}</strong><i style={{ height: !hidden ? `${Math.max(5, h.full_value / Math.max(dt?.purchase_price || 0, h.full_value, 1) * 76)}px` : '6px' }}/></div></div>
        <dl className="property-move-fact-list"><div><dt>매입가 대비 변화 · 전체</dt><dd>{gainKnown ? `${!hidden && m.gain! > 0 ? '+' : ''}${show(m.gain)}${!hidden && m.gain_rate !== null ? ` (${(m.gain_rate * 100).toFixed(1)}%)` : ''}` : '시세·매입가 확인 필요'}</dd></div><div><dt>연결 대출 {owner !== 'together' && '· 선택 지분'}</dt><dd>{show(m.loans_mine)}</dd></div><div><dt>돌려줄 보증금</dt><dd>{show(m.deposit_mine)}</dd></div><div><dt>등록 시세 기준일</dt><dd>{h.asset.as_of}</dd></div></dl>
        <button className="property-move-button" onClick={onMarket}>실거래 반영·호가 관리 <ArrowRight size={14}/></button><p className="property-move-note">순자산은 매도세금·비용 차감 전입니다. 아래 자금 계획에서 비용을 반영하세요.</p>
      </div><div><TradeReport market={market} hidden={hidden} purchase={dt?.purchase_price}/>{market.configured === false && <KeySetup onDone={market.retry}/>}</div>
    </div>}
  </article>
}

function CandidateLine({ candidate: c, budget, target, targetPrice, hidden, busy, onTarget, onEdit }: { candidate: Candidate; budget?: Budget; target: boolean; targetPrice: number | null; hidden: boolean; busy: boolean; onTarget: () => void; onEdit: () => void }) {
  const market = useTrades(c.address, c.name, c.area_m2)
  const show = (n: number | null | undefined) => display(n, hidden)
  const difference = c.price !== null && targetPrice !== null ? c.price - targetPrice : null
  return <article className={`property-move-candidate-line ${target ? 'selected' : ''}`}>
    <button className="property-move-candidate-name" onClick={onEdit}><span className="property-move-candidate-label">{target ? <><Target size={12}/>현재 목표</> : <><House size={12}/>비교 후보</>}</span><strong>{c.name}<ChevronRight size={13}/></strong><small>{c.area_m2 ? `전용 ${c.area_m2}㎡` : '면적 미입력'}{c.address?.road ? ` · ${c.address.road}` : ''}</small>{c.memo && <small>{c.memo}</small>}</button>
    <div className="property-move-price-cell"><span>계획 매수가</span><strong>{show(c.price)}</strong><small>{basis[c.price_basis]}{c.price_date ? ` · ${c.price_date}` : ''}</small></div>
    <div className="property-move-price-cell"><span>최근 실거래</span><TradePrice market={market} hidden={hidden}/></div>
    <div className="property-move-price-cell"><span>현재 호가</span><strong>{c.asking_low !== null ? `${show(c.asking_low)}${c.asking_high !== null && c.asking_high !== c.asking_low && !hidden ? ` ~ ${show(c.asking_high)}` : ''}` : '미기록'}</strong><small>{c.asking_date ? `직접 기록 · ${c.asking_date}` : '후보 수정에서 기록'}</small></div>
    <div className="property-move-price-cell property-move-gap-cell"><span>지금 더 필요한 돈</span><strong>{show(budget?.gap)}</strong><small>{!target && difference !== null ? hidden ? '••••' : difference < 0 ? `목표보다 ${money(-difference)} 저렴` : difference > 0 ? `목표보다 ${money(difference)} 높음` : '목표와 같은 가격' : budget?.costs_complete ? '입력한 비용 포함' : '비용 미입력분 제외'}</small></div>
    <button className={`property-move-button ${target ? 'chosen' : ''}`} disabled={busy || target} onClick={onTarget} aria-label={`${c.name} ${target ? '현재 목표' : '목표로 선택'}`}>{target ? <><Check size={14}/>목표</> : '목표로'}</button>
  </article>
}

export function PropertyMove({ owner, family, hidden, onChanged, onDemo }: Props) {
  const [homes, setHomes] = useState<HomeList | null>(null)
  const [data, setData] = useState<MoveState | null>(null)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [rev, setRev] = useState(0)
  const [busy, setBusy] = useState(false)
  const [sort, setSort] = useState('target')
  const [cheaper, setCheaper] = useState(false)
  const requestVersion = useRef(0)
  const refresh = useCallback(() => setRev(v => v + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    const request = ++requestVersion.current
    setError('')
    Promise.all([api<HomeList>(`/property?owner=${owner}`, 'GET', undefined, controller.signal), api<MoveState>(`/property-move?owner=${owner}`, 'GET', undefined, controller.signal)])
      .then(([h, d]) => { if (!controller.signal.aborted && request === requestVersion.current) { setHomes(h); setData(d) } })
      .catch(e => { if (!controller.signal.aborted && request === requestVersion.current) setError(e.message) })
    return () => controller.abort()
  }, [owner, rev])
  async function save(plan: MovePlan) { const next = await api<MoveState>(`/property-move?owner=${owner}`, 'PUT', plan); requestVersion.current++; setData(next); setDialog(null) }
  function changed() { refresh(); onChanged() }
  function homeSaved() { setDialog(null); changed() }
  const show = (n: number | null | undefined) => display(n, hidden)
  if (!homes || !data) return <section className="property-move property-move-loading" role="status">{error ? <><p>{error}</p><button className="property-move-button" onClick={refresh}>다시 불러오기</button></> : '우리 집과 갈아타기 계획을 불러오고 있어요.'}</section>
  const p = data.plan, target = p.candidates.find(c => c.id === p.target_id)
  const budget = data.comparisons.find(b => b.id === p.target_id)
  const selectedHomes = homes.homes.filter(h => p.source_home_ids.includes(h.asset.id))
  const candidates = p.candidates.filter(c => !cheaper || c.price !== null && target?.price != null && c.price < target.price).sort((a, b) => sort === 'price' ? (a.price ?? Infinity) - (b.price ?? Infinity) : Number(b.id === p.target_id) - Number(a.id === p.target_id))
  return <div className="property-move">
    <nav className="property-move-section-nav" aria-label="부동산 화면 섹션"><a href="#property-move-journey" onClick={e => { e.preventDefault(); document.getElementById('property-move-journey')?.scrollIntoView({ behavior: 'smooth' }) }}>갈아타기 계획</a><a href="#property-move-homes" onClick={e => { e.preventDefault(); document.getElementById('property-move-homes')?.scrollIntoView({ behavior: 'smooth' }) }}>내 부동산</a><a href="#property-move-compare" onClick={e => { e.preventDefault(); document.getElementById('property-move-compare')?.scrollIntoView({ behavior: 'smooth' }) }}>단지 비교</a><span>{owner === 'together' ? '우리 함께' : owner === 'me' ? family?.me.name || '나' : family?.partner?.name || '배우자'}의 갈아타기 노트</span></nav>
    {error && <div className="property-move-error" role="alert">{error} <button className="property-move-link" onClick={refresh}>다시 불러오기</button></div>}
    <section className="property-move-hero" id="property-move-journey">
      <div className="property-move-journey-card"><div className="property-move-section-head"><div><span className="property-move-kicker">OUR NEXT ADDRESS</span><h2>지금의 집에서, 다음의 일상으로.</h2></div><span className="property-move-pill">{p.target_month ? `${p.target_month.replace('-', '.')} 목표` : '우리의 갈아타기'}</span></div>
        <div className="property-move-journey-scene"><div><Buildings/><div className="property-move-building-caption"><small>지금 집</small><button onClick={() => homes.homes.length ? setDialog({ type: 'funds' }) : setDialog({ type: 'home', home: null })}>{selectedHomes.length ? `${selectedHomes[0].asset.name}${selectedHomes.length > 1 ? ` 외 ${selectedHomes.length - 1}채` : ''}` : homes.homes.length ? '팔고 갈 집 선택' : '우리 집부터 등록'}<ChevronRight size={13}/></button><span>{selectedHomes.length ? `매도 후 ${show(data.funds.sale_net)}` : '집과 연결 대출을 함께 관리해요'}</span></div></div><div className="property-move-journey-arrow"><span/><ArrowRight size={23}/><span/></div><div className={!target ? 'property-move-target-empty' : ''}><Buildings target/><div className="property-move-building-caption"><small>목표 집</small><button onClick={() => setDialog({ type: 'candidate', candidate: target })}>{target?.name || '어떤 집으로 갈까요?'}<ChevronRight size={13}/></button><span>{target?.price ? `계획 매수가 ${show(target.price)}` : '원하는 단지와 평형을 담아보세요'}</span></div></div></div>
        <div className="property-move-journey-footer"><span><i/>내 집과 모아둔 돈을 하나의 계획으로.</span><button className="property-move-link" onClick={() => setDialog({ type: 'funds' })}>자금 계획 <ArrowRight size={13}/></button></div>
      </div>
      <aside className="property-move-summary" aria-label="갈아타기 준비 현황"><span className="property-move-summary-label"><i/>준비한 자기자금</span><strong className="property-move-summary-amount">{show(data.funds.own_funds)}</strong><p className="property-move-summary-definition">집 매도 후 자금 + 이사에 쓸 모아둔 돈</p>
        <div className="property-move-progress" role="progressbar" aria-label="자기자금 준비율" aria-valuemin={0} aria-valuemax={100} aria-valuenow={hidden ? undefined : budget?.coverage ?? undefined}><i style={{ width: hidden ? '0%' : `${budget?.coverage ?? 0}%` }}/></div><div className="property-move-progress-label"><span>총 필요 {show(budget?.total_needed)}</span><b>{hidden ? '••••' : budget?.coverage != null ? `${budget.coverage}% 준비` : '계획 입력 전'}</b></div>
        <div className="property-move-summary-gap"><span>{!target ? '다음 집을 골라요' : budget?.gap == null ? '자금 입력 필요' : budget.gap > 0 ? '더 필요한 돈' : '목표 금액 준비 완료'}</span><strong>{target && budget?.gap != null ? show(budget.gap) : target ? '자금 계획 입력' : '목표 아파트 추가'}</strong></div><p className="property-move-summary-assumptions">{p.new_loan > 0 ? `추가 대출 가정 ${show(p.new_loan)} 반영` : '추가 대출 없는 기준'}{budget && !budget.costs_complete ? ' · 미입력 비용 제외' : ''}</p>
        <button className="property-move-summary-button" onClick={() => setDialog(target ? { type: 'funds' } : { type: 'candidate' })}>{target ? '모아둔 돈·자금 계획 바꾸기' : '희망 아파트 등록하기'}<ArrowRight size={16}/></button><small>목표 가격은 집 전체 기준{owner !== 'together' ? ' · 준비 자금은 선택한 소유자 몫' : ''}</small>
      </aside>
    </section>
    {(data.missing_home_ids.length > 0 || data.valuation_needs_review.length > 0) && <p className="property-move-notice">{data.missing_home_ids.length ? '매도할 집이 삭제되었어요. 자금 계획에서 다시 선택해 주세요.' : '선택한 집에 확인이 필요한 시세가 있어요. 실거래 또는 직접 확인한 시세로 갱신해 주세요.'}</p>}
    <section className="property-move-section" id="property-move-homes"><div className="property-move-section-head"><div><span className="property-move-kicker">01 · OUR HOME TODAY</span><h2>우리 집, 지금 얼마일까요?</h2><p>등록 시세·실거래·호가를 나란히. 가격의 기준도 함께 확인해요.</p></div><button className="property-move-button" onClick={() => setDialog({ type: 'home', home: null })}><Plus size={15}/>{homes.homes.length ? '집 추가' : '우리 집 등록'}</button></div>
      <div className="property-move-home-list">{homes.homes.length ? homes.homes.map(h => <HomeLine key={h.asset.id} home={h} hidden={hidden} owner={owner} family={family} onEdit={() => setDialog({ type: 'home', home: h })} onMarket={() => setDialog({ type: 'market', home: h })}/>) : <div className="property-move-empty"><House size={27}/><div><strong>우리 집의 첫 기록을 남겨요.</strong><p>주소·매입가·명의를 등록하면 실거래와 대출을 함께 볼 수 있어요.</p></div></div>}</div>
    </section>
    <section className="property-move-section" id="property-move-compare"><div className="property-move-section-head"><div><span className="property-move-kicker">02 · ROOM TO COMPARE</span><h2>조금 더 가까운 다음 집은?</h2><p>관심 단지를 모아 가격과 부족한 자금을 같은 기준으로 비교해요.</p></div><button className="property-move-button" disabled={p.candidates.length >= 20} onClick={() => setDialog({ type: 'candidate' })}><Plus size={15}/>비교할 아파트 추가</button></div>
      {p.candidates.length > 0 && <div className="property-move-compare-toolbar"><span>관심 단지 {p.candidates.length}곳</span><label><input type="checkbox" checked={cheaper} disabled={!target?.price} onChange={e => setCheaper(e.target.checked)}/>목표보다 저렴한 집만</label><select aria-label="후보 정렬" value={sort} onChange={e => setSort(e.target.value)}><option value="target">목표 집 먼저</option><option value="price">낮은 가격순</option></select></div>}
      <div className="property-move-candidates">{candidates.map(c => <CandidateLine key={c.id} candidate={c} budget={data.comparisons.find(b => b.id === c.id)} target={c.id === p.target_id} targetPrice={target?.price ?? null} hidden={hidden} busy={busy} onEdit={() => setDialog({ type: 'candidate', candidate: c })} onTarget={async () => { setBusy(true); setError(''); try { await save({ ...p, target_id: c.id }); setCheaper(false) } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }}/>)}</div>
      {!candidates.length && <div className="property-move-empty"><Target size={28}/><div><strong>{cheaper ? '등록한 후보 중 더 저렴한 집이 없어요.' : '마음에 둔 아파트부터 하나씩.'}</strong><p>{cheaper ? '필터를 해제하거나 비교할 단지를 더해보세요.' : '희망 단지와 비교 후보를 저장하면, 목표를 바꿀 때마다 필요한 돈도 바뀝니다.'}</p></div></div>}
      <p className="property-move-note">가격 비교는 등록한 후보와 입력한 계획 매수가 기준입니다. 호가는 직접 확인한 기록이며 자동 갱신되지 않아요.</p>
    </section>
    <section className="property-move-section" id="property-move-funds"><div className="property-move-section-head"><div><span className="property-move-kicker">03 · ONE STEP CLOSER</span><h2>그 집까지, 우리의 속도로.</h2><p>지금 준비한 돈과 앞으로 모을 돈을 나누어 살펴봐요.</p></div><button className="property-move-button" onClick={() => setDialog({ type: 'funds' })}><SlidersHorizontal size={15}/>자금·시점 설정</button></div>
      <div className="property-move-funding"><div className="property-move-funding-lines"><div><span><House size={16}/>팔고 갈 집 · 등록 평가액</span><b>{show(data.funds.sale_value)}</b></div><div><span>연결 대출 / 돌려줄 보증금</span><b>− {show(data.funds.loans)} / {show(data.funds.deposit)}</b></div><div><span>매도세금·비용 <small>직접 입력</small></span><b>{p.sale_costs === null ? '미입력' : `− ${show(p.sale_costs)}`}</b></div><div><span><Wallet size={16}/>이사에 쓸 모아둔 돈</span><b>{p.cash === null ? '입력 필요' : `+ ${show(p.cash)}`}</b></div><div className="property-move-funding-total"><span>준비한 자기자금</span><strong>{show(data.funds.own_funds)}</strong></div>{p.new_loan > 0 && <div><span>추가 대출 가정 <small>자기자금과 별도</small></span><b>+ {show(p.new_loan)}</b></div>}<p className="property-move-note">목표 집 비용 {target?.purchase_costs == null ? '미입력' : show(target.purchase_costs)} · 연금 제외 · 세금 자동 산정 없음</p></div>
        <div className="property-move-saving"><span className="property-move-kicker">{p.target_month ? `${p.target_month.replace('-', '.')}까지 · ${data.funds.months}개월` : '이사 목표 시점을 정해보세요'}</span><h3>매달 {show(p.monthly_saving)}씩,<br/>앞으로 {show(data.funds.future_savings)}을 더 모으면</h3><div className="property-move-saving-result"><span>목표 시점에도 더 필요한 돈</span><strong>{show(budget?.future_gap)}</strong></div><p>{budget?.required_monthly != null ? `목표를 맞추려면 월 ${show(budget.required_monthly)} 저축 필요` : budget?.months === 0 ? '목표 월이 되었어요. 현재 부족액을 확인해 주세요.' : '목표 집·모아둔 돈·이사 시점을 입력하면 계산해요.'}</p><small>입력한 가격·저축액이 유지된다는 가정 · 수익률·물가 미반영</small></div>
      </div>
    </section>
    <button className="property-move-link property-move-demo-link" onClick={onDemo}>가상 예시 화면 보기 <ArrowRight size={13}/></button>
    {dialog && <Modal title={dialog.type === 'candidate' ? dialog.candidate ? '비교 아파트 수정' : '비교할 아파트 추가' : dialog.type === 'funds' ? '갈아타기 자금 계획' : dialog.type === 'market' ? `${dialog.home?.asset.name} 시세·호가` : dialog.type === 'delete' ? '집 삭제' : dialog.home ? '집 정보' : '우리 집 등록'} onClose={() => setDialog(null)}>
      {dialog.type === 'candidate' ? <CandidateForm initial={dialog.candidate} onSave={async c => { const exists = p.candidates.some(old => old.id === c.id); await save({ ...p, candidates: exists ? p.candidates.map(old => old.id === c.id ? c : old) : [...p.candidates, c], target_id: p.target_id ?? c.id }) }} onDelete={dialog.candidate ? async () => { const rest = p.candidates.filter(c => c.id !== dialog.candidate?.id); await save({ ...p, candidates: rest, target_id: p.target_id === dialog.candidate?.id ? rest[0]?.id ?? null : p.target_id }) } : undefined}/>
        : dialog.type === 'funds' ? <FundsForm plan={p} homes={homes} cashReference={data.cash_reference} onSave={save}/>
        : dialog.type === 'delete' && dialog.home ? <DeleteHome home={dialog.home} onDone={homeSaved} onCancel={() => setDialog({ type: 'home', home: dialog.home })}/>
        : dialog.type === 'market' && dialog.home ? <HomeMarket key={dialog.home.asset.id} home={dialog.home} onChanged={h => { setDialog({ type: 'market', home: h }); changed() }} onUpdateValue={() => setDialog({ type: 'home', home: dialog.home, start: 'value' })}/>
        : dialog.type === 'home' && <HomeWizard home={dialog.home} list={homes} family={family} owner={owner} start={dialog.start} onSaved={homeSaved} onDelete={dialog.home ? () => setDialog({ type: 'delete', home: dialog.home }) : undefined}/>}
    </Modal>}
  </div>
}
