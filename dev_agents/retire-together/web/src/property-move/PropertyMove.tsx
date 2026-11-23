import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronRight, House, Plus, SlidersHorizontal, Target, X } from 'lucide-react'
import { Modal } from '../components'
import { Button } from '../components/ui/button'
import { ObservationRow } from '../components/ui/observation-row'
import { day } from '../lib/format'
import { api } from '../local-data'
import { money, type Family, type Owner } from '../model'
import { DeleteHome, HomeMarket, HomeWizard, KeySetup, sourceLabel, TENURE, type Home, type HomeList } from '../property-entry'
import { CandidateForm, FundsForm, LIVING_FIELDS } from './Forms'
import { TradePrice, TradeReport, usePriceCheck, useTrades } from './Market'
import { AnalysisHero } from './AnalysisHero'
import { HomeListingSummary, usePublicListings } from './HomeListings'
import { dateToday, emptyLiving, type Budget, type Candidate, type Living, type MovePlan, type MoveState, type TrackEntry } from './types'
import './property-move.css'
import { CapitalStrip } from './ResearchBoard'
import { Discovery, type DiscoveryResult } from './Discovery'
import { PirForm } from './Pir'

type Props = { owner: Owner; family: Family | null; hidden: boolean; onChanged: () => void }
type Dialog = { type: 'home' | 'market' | 'delete'; home: Home | null; start?: 'value' } | { type: 'candidate'; candidate?: Candidate } | { type: 'funds' }
const display = (n: number | null | undefined, hidden: boolean) => hidden ? '••••' : n == null ? '—' : money(n)
const basis = { manual: '직접 입력', trade: '선택한 실거래', asking: '기록한 호가' }
const basisShort = { manual: '계획가', trade: '실거래', asking: '호가' }
const signed = (n: number | null | undefined, hidden: boolean) => hidden ? '••••' : n == null ? '—' : n === 0 ? '0원' : `${n < 0 ? '−' : '+'}${money(Math.abs(n))}`
// Older saved plans predate living notes; complete their view model without writing to the ledger.
const normalizeState = (data: MoveState): MoveState => ({ ...data, plan: { ...data.plan, candidates: data.plan.candidates.map(c => ({ ...c, living: { ...emptyLiving(), ...c.living } })) } })
// 추적 한 줄의 기준 가격: 화면이 지금 보여주는 가격 그대로 — 실거래가 있으면 실거래, 없으면 기록한 호가, 그것도 없으면 계획 매수가.
export type TrackPick = { price: number; price_basis: 'manual' | 'trade' | 'asking'; price_date: string | null }
const pickPrice = (c: Candidate, latest?: { price: number; date: string }): TrackPick | null =>
  latest ? { price: latest.price, price_basis: 'trade', price_date: latest.date } : c.asking_low !== null ? { price: c.asking_low, price_basis: 'asking', price_date: c.asking_date } : c.price !== null ? { price: c.price, price_basis: 'manual', price_date: c.price_date } : null

function HomeLine({ home: h, hidden, family, owner, onEdit, onMarket, baseline, onBaseline, discoveryBusy }: { baseline: boolean; onBaseline: () => void; discoveryBusy: boolean; home: Home; hidden: boolean; family: Family | null; owner: Owner; onEdit: () => void; onMarket: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState('listings')
  const dt = h.detail, m = h.metrics
  const market = useTrades(dt?.address, h.asset.name, dt?.area_m2)
  const listings = usePublicListings(dt?.address, h.asset.name, dt?.area_m2)
  const asking = listings.data?.summary ?? h.asking
  const show = (n: number | null) => display(n, hidden)
  const stale = (Date.now() - Date.parse(h.asset.as_of)) / 86_400_000 > 90
  const latest = market.trades[0]
  return <ObservationRow
    title={<div><label className="home-baseline-choice"><input type="radio" name="discovery-baseline" aria-label={`${h.asset.name} 비교 기준`} checked={baseline} disabled={discoveryBusy} onChange={onBaseline}/>비교 기준</label><button className="flex w-full items-center justify-between gap-2 text-left" aria-label={`${h.asset.name} 상세 ${expanded ? '접기' : '보기'}`} aria-expanded={expanded} aria-controls={`home-detail-${h.asset.id}`} onClick={() => setExpanded(v => !v)}>{h.asset.name}<ChevronDown className={`size-4 shrink-0 ${expanded ? 'rotate-180' : ''}`}/></button></div>}
    subtitle={<>{dt?.area_m2 ? `전용 ${dt.area_m2}㎡` : '면적 미입력'} · {h.asset.owner === 'joint' ? `공동 · 나 ${h.asset.share_percent}%` : h.asset.owner === 'me' ? family?.me.name || '나' : family?.partner?.name || '배우자'}</>}
    metrics={[
      { label: '등록 시세', value: dt?.value_source?.kind === 'none' ? '확인 필요' : show(h.full_value), detail: `${day(h.asset.as_of)}${stale ? ' · 갱신 필요' : ''}` },
      { label: '최근 실거래', value: latest ? show(latest.price) : market.loading ? '조회 중' : '—', detail: latest ? `${day(latest.date)} · ${latest.floor ?? '—'}층` : market.error ? '조회 실패' : undefined },
      { label: 'KB 일반평균가', value: dt?.kb_quote ? show(dt.kb_quote.average) : '—', detail: dt?.kb_quote ? `${day(dt.kb_quote.as_of)} · 직접 기록` : undefined },
      { label: '매매 호가', value: asking ? show(asking.low) : listings.loading ? '조회 중' : '—', detail: listings.data?.summary ? `최저 · 광고 ${asking!.count}건${listings.data.stale ? ' · 이전 자료' : ''}` : h.asking ? '직접 기록' : listings.error ? '조회 실패' : undefined },
      { label: owner === 'together' ? '순자산' : '선택 지분 순자산', value: show(m.equity_mine), detail: '등록 시세 기준' },
    ]}>
    {expanded && <div id={`home-detail-${h.asset.id}`} className="mt-4 space-y-4 border-t border-grey-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1" role="group" aria-label={`${h.asset.name} 상세 보기`}>{[{ id: 'listings', label: '매물' }, { id: 'history', label: '거래 기록' }, { id: 'info', label: '집 정보' }].map(item => <Button key={item.id} size="sm" variant={tab === item.id ? 'secondary' : 'ghost'} aria-pressed={tab === item.id} onClick={() => setTab(item.id)}>{item.label}</Button>)}</div>
        <Button size="sm" variant="outline" onClick={onEdit}>정보 수정</Button>
      </div>
      {tab === 'listings' && <HomeListingSummary sale={listings} address={dt?.address} name={h.asset.name} area={dt?.area_m2} hidden={hidden} onManual={onMarket}/>}
      {tab === 'history' && <><TradeReport market={market} hidden={hidden} purchase={dt?.purchase_price}/>{market.configured === false && <KeySetup onDone={market.retry}/>}<Button size="sm" variant="outline" onClick={onMarket}>시세·호가 관리</Button></>}
      {tab === 'info' && <div className="space-y-4">
        <p className="text-xs text-grey-600">{dt?.address?.road || '주소 미등록'}{dt ? ` · ${TENURE[dt.tenure]}` : ''}</p>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">{[
          ['매입가 · 전체', show(dt?.purchase_price ?? null)], ['대출', show(m.loans_mine)],
          ['반환 보증금', show(m.deposit_mine)], ['시세 기준', sourceLabel(dt?.value_source)],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-grey-600">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}</dl>
        <Button size="sm" variant="outline" onClick={onMarket}>시세·호가 관리</Button>
      </div>}
    </div>}
  </ObservationRow>
}

function PriceAnalysis({ candidate: c, hidden }: { candidate: Candidate; hidden: boolean }) {
  const [months, setMonths] = useState(12)
  const check = usePriceCheck(c.address, c.name, c.area_m2, c.asking_low, months)
  const a = check.data?.analysis
  const show = (n: number | null | undefined) => display(n, hidden)
  const pct = (n: number | null | undefined) => n == null || hidden ? '' : ` (${n > 0 ? '+' : ''}${n}%)`
  return <div className="property-move-analysis">
    <div className="property-move-section-head"><div><h3>가격 비교</h3><p>국토부 · 전용 ±2㎡ · 해제 거래 제외</p></div>
      <div className="property-move-analysis-period" role="group" aria-label="조회 기간">{[12, 24, 36].map(m => <button key={m} type="button" aria-pressed={months === m} onClick={() => setMonths(m)}>{m}개월</button>)}</div></div>
    {!check.ready ? <p className="property-move-empty-copy">후보 수정에서 주소와 전용면적을 저장하면 같은 단지의 거래를 비교할 수 있어요.</p>
      : check.loading && !check.data ? <p className="property-move-empty-copy">실거래를 조회하고 있어요. 기간이 길면 시간이 걸려요.</p>
      : check.error ? <p className="property-move-notice" role="alert">{check.error} <button type="button" className="property-move-link" onClick={check.retry}>다시 조회</button></p>
      : check.data && !check.data.configured ? <p className="property-move-empty-copy">실거래 연결 설정 후 비교할 수 있어요. 우리 집 줄의 상세에서 인증키를 넣어 주세요.</p>
      : a && a.count === 0 ? <p className="property-move-empty-copy">최근 {months}개월 이 단지·면적의 거래가 없어요.</p>
      : a && <>
        <div className="property-move-analysis-grid">
          <div><span>현재 호가</span><strong>{c.asking_low !== null ? `${show(c.asking_low)}${c.asking_high !== null && c.asking_high !== c.asking_low && !hidden ? ` ~ ${show(c.asking_high)}` : ''}` : '미기록'}</strong><small>{c.asking_date ? `직접 기록 · ${c.asking_date}` : ''}</small></div>
          <div><span>최근 거래</span><strong>{show(a.latest)}</strong><small>{a.latest_date}{c.asking_low !== null && a.premium_latest != null ? ` · 호가가 ${signed(a.premium_latest, hidden)}${pct(a.premium_latest_pct)}` : ''}</small></div>
          <div><span>{months}개월 중간값</span><strong>{show(a.median)}</strong><small>{a.count}건{c.asking_low !== null && a.premium_median != null ? ` · 호가가 ${signed(a.premium_median, hidden)}${pct(a.premium_median_pct)}` : ''}</small></div>
          <div><span>최저 ~ 최고</span><strong>{hidden ? '••••' : `${money(a.low!)} ~ ${money(a.high!)}`}</strong><small>{a.first_date} ~ {a.last_date}</small></div>
        </div>
        <TradeReport market={{ loading: check.loading, configured: true, trades: check.data!.trades, ready: true, retry: check.retry }} hidden={hidden}/>
      </>}
  </div>
}

function LivingNotes({ candidate: c, busy, onSave }: { candidate: Candidate; busy: boolean; onSave: (living: Living) => Promise<void> }) {
  const [d, setD] = useState(c.living)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(d) !== JSON.stringify(c.living)
  const links = [['학구도안내서비스', 'https://schoolzone.edumac.kr'], ['네이버 부동산', `https://m.land.naver.com/search/result/${encodeURIComponent(c.name)}`], ['국토부 실거래가', 'https://rt.molit.go.kr']]
  return <form className="property-move-living" onSubmit={async e => { e.preventDefault(); setError(''); try { await onSave(d) } catch (err) { setError((err as Error).message) } }}>
    <div className="property-move-section-head"><div><h3>거주 메모</h3></div>
      <div className="property-move-living-links">{links.map(([label, href]) => <a key={label} className="property-move-link" href={href} target="_blank" rel="noreferrer">{label} ↗</a>)}</div></div>
    <div className="property-move-living-grid">{LIVING_FIELDS.map(([key, label, hint]) => <label key={key}><span>{label}</span><textarea rows={2} maxLength={300} placeholder={hint} value={d[key]} disabled={busy} onChange={e => setD(old => ({ ...old, [key]: e.target.value }))}/></label>)}</div>
    {error && <p className="property-move-error" role="alert">{error}</p>}
    {dirty && <div className="property-move-form-actions"><button type="button" className="property-move-link" disabled={busy} onClick={() => setD(c.living)}>되돌리기</button><button className="property-move-button primary" disabled={busy}>거주 정보 저장</button></div>}
  </form>
}

function TrackPanel({ candidate: c, track, pick, hidden, busy, onTrack, onAsking, onUntrack }: { candidate: Candidate; track: TrackEntry[]; pick: TrackPick | null; hidden: boolean; busy: boolean; onTrack: (p: TrackPick, note: string) => Promise<void>; onAsking: (won: number) => Promise<void>; onUntrack: (day: string) => Promise<void> }) {
  const [asking, setAsking] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const show = (n: number | null | undefined) => display(n, hidden)
  const run = async (fn: () => Promise<void>) => { setError(''); try { await fn() } catch (e) { setError((e as Error).message) } }
  function submitAsking(e: FormEvent) { e.preventDefault(); const won = Math.round(Number(asking.replace(/[^\d.]/g, '')) * 10_000); if (!won) { setError('호가를 만원 단위로 적어 주세요.'); return } run(async () => { await onAsking(won); setAsking('') }) }
  return <div className="property-move-track">
    <div className="property-move-section-head"><div><h3>추적 기록</h3></div>
      <div className="property-move-track-actions">
        <form className="property-move-track-asking" onSubmit={submitAsking}><input aria-label={`${c.name} 호가 (만원)`} inputMode="numeric" placeholder="확인한 호가" value={asking} disabled={busy} onChange={e => setAsking(e.target.value)}/><span>만원</span><button type="submit" className="property-move-button" disabled={busy || !asking}>호가로 기록</button></form>
        <button type="button" className="property-move-button primary" disabled={busy || !pick} onClick={() => pick && run(() => onTrack(pick, note))}>오늘 기록{pick ? ` · ${basisShort[pick.price_basis]} ${hidden ? '••••' : money(pick.price)}` : ''}</button>
      </div>
    </div>
    <label className="property-move-track-note"><span>메모</span><input maxLength={100} placeholder="예: 12층 매물 확인, 급매" value={note} disabled={busy} onChange={e => setNote(e.target.value)}/></label>
    {error && <p className="property-move-error" role="alert">{error}</p>}
    {track.length ? <div className="property-move-track-scroll"><table className="property-move-track-table" aria-label={`${c.name} 추적 기록`}>
      <thead><tr><th>기준일</th><th>기준</th><th>목표 집</th><th>우리 집</th><th>격차</th><th>더 필요한 돈</th><th>메모</th><th><span className="sr-only">삭제</span></th></tr></thead>
      <tbody>{track.map((e, i) => { const prev = track.slice(i + 1).find(old => old.price_basis === e.price_basis); const delta = prev ? e.gap - prev.gap : null; return <tr key={e.day}>
        <td>{e.day}</td><td>{basisShort[e.price_basis]}{e.price_date && e.price_basis !== 'manual' ? <small>{e.price_date}</small> : null}</td><td>{show(e.price)}</td><td>{show(e.home_value)}</td>
        <td className={delta == null || hidden ? '' : delta > 0 ? 'is-wider' : delta < 0 ? 'is-closer' : ''}>{signed(e.gap, hidden)}{delta != null && <small>{delta === 0 ? '그대로' : `${signed(delta, hidden)}${hidden ? '' : delta > 0 ? ' 벌어짐' : ' 좁혀짐'}`}</small>}</td>
        <td>{show(e.needed)}{!e.costs_complete && <small>비용 미입력분 제외</small>}</td><td className="property-move-track-memo">{e.note}</td>
        <td><button type="button" className="property-move-icon-button" aria-label={`${e.day} 기록 삭제`} disabled={busy} onClick={() => run(() => onUntrack(e.day))}><X size={14}/></button></td>
      </tr> })}</tbody>
    </table></div> : <p className="property-move-empty-copy">저장한 기록이 없습니다.</p>}

  </div>
}

function CandidateLine({ candidate: c, budget, track, hidden, busy, revealKey, onEdit, onTrack, onAsking, onUntrack, onLiving }: { candidate: Candidate; budget?: Budget; track: TrackEntry[]; hidden: boolean; busy: boolean; revealKey: number; onEdit: () => void; onTrack: (p: TrackPick, note: string) => Promise<void>; onAsking: (won: number) => Promise<void>; onUntrack: (day: string) => Promise<void>; onLiving: (living: Living) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLElement>(null)
  useEffect(() => { if (revealKey) setOpen(true) }, [revealKey])
  useEffect(() => {
    if (!revealKey || !open) return
    const frame = requestAnimationFrame(() => {
      const panel = containerRef.current?.querySelector<HTMLElement>('.property-move-track')
      panel?.scrollIntoView({ block: 'start', behavior: 'instant' })
      panel?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [revealKey, open])
  const market = useTrades(c.address, c.name, c.area_m2)
  const show = (n: number | null | undefined) => display(n, hidden)
  const latest = track[0], prev = track.slice(1).find(e => e.price_basis === latest?.price_basis)
  const delta = latest && prev ? latest.gap - prev.gap : null
  return <article ref={containerRef} className={`property-move-candidate-line${open ? ' is-open' : ''}`}>
    <div className="property-move-candidate-row">
      <button className="property-move-candidate-name" onClick={onEdit}><strong>{c.name}<ChevronRight size={13}/></strong><small>{c.area_m2 ? `전용 ${c.area_m2}㎡` : '면적 미입력'} · 계획 매수가 {show(c.price)}{c.price !== null ? ` · ${basis[c.price_basis]}` : ''}</small>{c.memo && <small>{c.memo}</small>}</button>
      <div className="property-move-price-cell"><span>최근 실거래</span><TradePrice market={market} hidden={hidden}/></div>
      <div className="property-move-price-cell"><span>현재 호가</span><strong>{c.asking_low !== null ? `${show(c.asking_low)}${c.asking_high !== null && c.asking_high !== c.asking_low && !hidden ? ` ~ ${show(c.asking_high)}` : ''}` : '미기록'}</strong><small>{c.asking_date ? `직접 기록 · ${c.asking_date}` : ''}</small></div>
      <div className="property-move-price-cell property-move-diff-cell"><span>우리 집과 격차</span><strong>{signed(budget?.price_gap, hidden)}</strong><small>{delta != null && prev ? hidden ? '••••' : delta === 0 ? `${prev.day} 기록과 같음` : `${prev.day}보다 ${signed(delta, false)} ${delta > 0 ? '벌어짐' : '좁혀짐'}` : track.length ? `기록 ${track.length}건` : budget?.price_gap != null ? '목표 집 가격 − 팔 집 평가액' : ''}</small></div>
      <div className="property-move-price-cell property-move-gap-cell"><span>현재 부족액</span><strong>{show(budget?.gap)}</strong><small>{budget?.gap == null ? '' : budget.gap === 0 ? '지금 자금으로 닿아요' : budget.costs_complete ? '입력한 비용 포함' : '비용 미입력분 제외'}</small></div>
      {budget?.months != null && <div className="property-move-price-cell property-move-future-cell"><span>이사 시점 부족액</span><strong>{budget?.months == null ? '—' : show(budget.future_gap)}</strong><small>{budget?.months == null ? '' : budget.future_gap === 0 ? `${budget.months}개월 뒤 닿아요` : budget.required_monthly != null ? `맞추려면 월 ${show(budget.required_monthly)}` : '목표 월 도래'}</small></div>}
      <button className="property-move-icon-button" aria-label={`${c.name} 분석 ${open ? '접기' : '보기'}`} aria-expanded={open} onClick={() => setOpen(v => !v)}><ChevronDown size={18} className={open ? 'rotated' : ''}/></button>
    </div>
    {open && <div className="property-move-detail"><PriceAnalysis candidate={c} hidden={hidden}/><TrackPanel candidate={c} track={track} pick={pickPrice(c, market.trades[0])} hidden={hidden} busy={busy} onTrack={onTrack} onAsking={onAsking} onUntrack={onUntrack}/><LivingNotes key={JSON.stringify(c.living)} candidate={c} busy={busy} onSave={onLiving}/></div>}
  </article>
}

export function PropertyMove({ owner, family, hidden, onChanged, view = 'move' }: Props & { view?: 'move' | 'plan' }) {
  const [discoveryBaseId, setDiscoveryBaseId] = useState('')
  const [discoveryBusy, setDiscoveryBusy] = useState(false)
  const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null)
  const [editIncome, setEditIncome] = useState(false)
  const [homes, setHomes] = useState<HomeList | null>(null)
  const [data, setData] = useState<MoveState | null>(null)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [rev, setRev] = useState(0)
  const [busy, setBusy] = useState(false)
  const [sort, setSort] = useState('gap')
  const [detailsRequest, setDetailsRequest] = useState<{ id: string; sequence: number } | null>(null)
  const requestVersion = useRef(0)
  const refresh = useCallback(() => setRev(v => v + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    const request = ++requestVersion.current
    setError('')
    api<MoveState & { homes?: HomeList }>(`/property-move?owner=${owner}&include_homes=true`, 'GET', undefined, controller.signal)
      .then(async d => {
        // Older API servers may not yet include the home list.
        const h = d.homes ?? await api<HomeList>(`/property?owner=${owner}`, 'GET', undefined, controller.signal)
        return [h, d] as const
      })
      .then(([h, d]) => { if (!controller.signal.aborted && request === requestVersion.current) { setHomes(h); setData(normalizeState(d)) } })
      .catch(e => { if (!controller.signal.aborted && request === requestVersion.current) setError(e.message) })
    return () => controller.abort()
  }, [owner, rev])
  async function save(plan: MovePlan) { const next = await api<MoveState>(`/property-move?owner=${owner}`, 'PUT', plan); requestVersion.current++; setData(normalizeState(next)); setDialog(null) }
  async function trackNow(candidateId: string, pick: TrackPick, note: string) { setBusy(true); try { const next = await api<MoveState>(`/property-move/track?owner=${owner}`, 'POST', { candidate_id: candidateId, ...pick, note }); requestVersion.current++; setData(normalizeState(next)) } finally { setBusy(false) } }
  async function untrack(candidateId: string, day: string) { setBusy(true); try { const next = await api<MoveState>(`/property-move/track/${candidateId}/${day}?owner=${owner}`, 'DELETE'); requestVersion.current++; setData(normalizeState(next)) } finally { setBusy(false) } }
  function changed() { refresh(); onChanged() }
  function homeSaved() { setDialog(null); changed() }
  const show = (n: number | null | undefined) => display(n, hidden)
  if (!homes || !data) return <section className="property-move property-move-loading" role="status">{error ? <><p>{error}</p><button className="property-move-button" onClick={refresh}>다시 불러오기</button></> : '우리 집과 갈아타기 계획을 불러오고 있어요.'}</section>
  const p = data.plan, f = data.funds
  const discoveryBase = homes.homes.find(h=>h.asset.id===discoveryBaseId)??homes.homes.find(h=>h.detail?.tenure==='live')??homes.homes[0]
  const selectedHomes = homes.homes.filter(h => p.source_home_ids.includes(h.asset.id))
  const budgetOf = (id: string) => data.comparisons.find(b => b.id === id)
  const candidates = [...p.candidates].sort((a, b) => sort === 'price' ? (a.price ?? Infinity) - (b.price ?? Infinity) : (budgetOf(a.id)?.gap ?? Infinity) - (budgetOf(b.id)?.gap ?? Infinity))
  const priced = data.comparisons.filter(b => b.gap != null)
  const reachNow = priced.filter(b => b.gap === 0).length, reachLater = priced.filter(b => b.future_gap === 0).length
  return <div className={`property-move${view === 'move' ? ' research-home' : ''}`}>
    {error && <div className="property-move-error" role="alert">{error} <button className="property-move-link" onClick={refresh}>다시 불러오기</button></div>}
    {view === 'move' && <CapitalStrip capital={data.capital} hidden={hidden} onManage={() => setDialog({ type: 'funds' })}/>}
    {view === 'plan' && <section className="property-move-funds-card" aria-label="갈아타기 자금">
      <div className="property-move-funds-own"><span>준비한 자기자금</span><strong>{show(f.own_funds)}</strong><small>{!selectedHomes.length && !homes.homes.length ? '우리 집을 등록하면 매도 후 자금을 계산해요' : !selectedHomes.length ? '팔고 갈 집 선택 필요 · 첫 집이면 모아둔 돈만' : p.cash === null ? `매도 후 ${show(f.sale_net)} · 모아둔 돈 입력 필요` : `매도 후 ${show(f.sale_net)} + 모아둔 돈 ${show(p.cash)}`}{p.new_loan > 0 ? ` · 대출 가정 ${show(p.new_loan)} 별도` : ''}</small></div>
      {p.target_month && <div className="property-move-funds-saving"><span>앞으로 모을 돈</span><strong>{p.target_month && f.months != null ? show(f.future_savings) : '—'}</strong><small>{p.target_month && f.months != null ? `매달 ${show(p.monthly_saving)} · ${p.target_month.replace('-', '.')}까지 ${f.months}개월` : '이사 시점·매달 모을 돈 미입력'}</small></div>}
      {priced.length > 0 && <div className="property-move-funds-reach"><span>자금 범위 내 후보</span><strong>{reachNow}곳</strong>{p.target_month && <small>목표 시점 {reachLater}곳</small>}</div>}
      <div className="property-move-funds-actions"><button className="property-move-button primary" onClick={() => homes.homes.length ? setDialog({ type: 'funds' }) : setDialog({ type: 'home', home: null })}><SlidersHorizontal size={15}/>{homes.homes.length ? '자금·시점 설정' : '우리 집부터 등록'}</button><small>{selectedHomes.length ? `팔고 갈 집 · ${selectedHomes[0].asset.name}${selectedHomes.length > 1 ? ` 외 ${selectedHomes.length - 1}채` : ''}` : '연금은 포함하지 않아요'}{f.sale_value > 0 && p.sale_costs === null ? ' · 매도세금 미입력' : ''}</small></div>
    </section>}
    {view === 'plan' && (data.missing_home_ids.length > 0 || data.valuation_needs_review.length > 0) && <p className="property-move-notice">{data.missing_home_ids.length ? '매도할 집이 삭제되었어요. 자금 계획에서 다시 선택해 주세요.' : '선택한 집에 확인이 필요한 시세가 있어요. 실거래 또는 직접 확인한 시세로 갱신해 주세요.'}</p>}
    {view === 'move' && <section className="property-move-section" id="property-move-homes"><div className="property-move-section-head"><div><h2>우리 집</h2></div><Button variant="outline" size="sm" onClick={() => setDialog({ type: 'home', home: null })}><Plus/>{homes.homes.length ? '집 추가' : '우리 집 등록'}</Button></div>
      <div className="property-move-home-list">{homes.homes.length ? homes.homes.map(h => <HomeLine key={h.asset.id} baseline={h.asset.id===discoveryBase?.asset.id} discoveryBusy={discoveryBusy} onBaseline={()=>{setDiscoveryBaseId(h.asset.id);setDiscovery(null)}} home={h} hidden={hidden} owner={owner} family={family} onEdit={() => setDialog({ type: 'home', home: h })} onMarket={() => setDialog({ type: 'market', home: h })}/>) : <div className="property-move-empty"><House size={27}/><div><strong>등록한 집이 없습니다.</strong></div></div>}</div>


    </section>}
    {view === 'move' && <section className="property-move-section">
      <Discovery baseId={discoveryBase?.asset.id??''} onBusyChange={setDiscoveryBusy} owner={owner} hidden={hidden} homes={homes.homes} incomeReady={!!data.pir?.income} criteriaEditing={editIncome} incomeControls={<div className="candidate-income" aria-label="연봉과 PIR 기준">
        <div className="candidate-income-summary"><span>부부 연봉 <strong>{data.pir?.income==null?'미입력':show(data.pir.income)}</strong></span><span>PIR {data.pir?.lower??p.pir?.lower??'—'}–{data.pir?.upper??p.pir?.upper??'—'}배</span>{data.pir?.price_min!=null&&data.pir?.price_max!=null&&<span>소득 기준 집값 <strong>{show(data.pir.price_min)}–{show(data.pir.price_max)}</strong></span>}<Button variant="outline" size="sm" disabled={discoveryBusy} aria-expanded={editIncome} aria-controls="home-pir-editor" onClick={()=>setEditIncome(v=>!v)}>{editIncome?'접기':data.pir?.income==null?'연봉 입력':'연봉·PIR 수정'}</Button></div>
        {editIncome&&<div id="home-pir-editor"><PirForm initial={p.pir??{annual_me:null,annual_partner:null,lower:10,upper:15}} onSave={async pir=>{await save({...p,pir});setDiscovery(null);setEditIncome(false)}}/><p className="research-caption">PIR은 집값 ÷ 부부 세전 연봉입니다. 보유 순자산은 추가 필요 자금에 반영하며, 이 가격 범위 안에서 기준 집보다 비싼 단지만 찾습니다.</p></div>}
      </div>} saved={p.candidates} result={discovery} setResult={setDiscovery} onAdd={async candidates=>{const all=[...p.candidates];for(const c of candidates){if(!all.some(old=>old.id===c.id||(old.name===c.name&&old.address?.jibun===c.address?.jibun&&Math.floor(old.area_m2??0)===Math.floor(c.area_m2??0))))all.push(c)}if(all.length>50)throw new Error(`관심 평형은 최대 50개까지 등록할 수 있어요. 현재 ${p.candidates.length}개입니다.`);await save({...p,candidates:all})}}/>
    </section>}
    {view === 'plan' && <><section className="property-move-section" id="property-move-compare"><div className="property-move-section-head"><div><h2>후보 비교</h2></div><button className="property-move-button" disabled={p.candidates.length >= 50} onClick={() => setDialog({ type: 'candidate' })}><Plus size={15}/>비교할 아파트 추가</button></div>
      {p.candidates.length > 1 && <div className="property-move-compare-toolbar"><select aria-label="후보 정렬" value={sort} onChange={e => setSort(e.target.value)}><option value="gap">더 필요한 돈 적은 순</option><option value="price">낮은 가격순</option></select></div>}
      <div className="property-move-candidates">{candidates.map(c => <CandidateLine key={c.id} candidate={c} budget={budgetOf(c.id)} track={data.track[c.id] ?? []} hidden={hidden} busy={busy} revealKey={detailsRequest?.id === c.id ? detailsRequest.sequence : 0} onEdit={() => setDialog({ type: 'candidate', candidate: c })} onTrack={(pick, note) => trackNow(c.id, pick, note)} onUntrack={day => untrack(c.id, day)} onLiving={living => save({ ...p, candidates: p.candidates.map(old => old.id === c.id ? { ...old, living } : old), target_id: null })} onAsking={async won => { await save({ ...p, candidates: p.candidates.map(old => old.id === c.id ? { ...old, asking_low: won, asking_high: won, asking_date: dateToday() } : old), target_id: null }); await trackNow(c.id, { price: won, price_basis: 'asking', price_date: dateToday() }, '') }}/>)}</div>
      {!candidates.length && <div className="property-move-empty"><Target size={28}/><div><strong>등록한 후보가 없습니다.</strong></div></div>}
      <p className="property-move-note">계획 매수가 기준 · 호가는 직접 기록</p>
    </section>
    <details className="property-move-section"><summary>가격 기록 더보기</summary><AnalysisHero data={data} hidden={hidden} onEdit={candidate => setDialog({ type: 'candidate', candidate })} onAdd={() => setDialog({ type: 'candidate' })} onDetails={id => setDetailsRequest(old => ({ id, sequence: (old?.sequence ?? 0) + 1 }))}/></details></>}
    {dialog && <Modal title={dialog.type === 'candidate' ? dialog.candidate ? '비교 아파트 수정' : '비교할 아파트 추가' : dialog.type === 'funds' ? '갈아타기 자금 계획' : dialog.type === 'market' ? `${dialog.home?.asset.name} 시세·호가` : dialog.type === 'delete' ? '집 삭제' : dialog.home ? '집 정보' : '우리 집 등록'} onClose={() => setDialog(null)}>
      {dialog.type === 'candidate' ? <CandidateForm initial={dialog.candidate} onSave={async additions => { const next = [...p.candidates.filter(old => old.id !== dialog.candidate?.id), ...additions]; if (next.length > 50) throw new Error('관심 평형은 최대 50개까지 등록할 수 있어요.'); await save({ ...p, candidates: next, target_id: null }) }} onDelete={dialog.candidate ? async () => { const rest = p.candidates.filter(c => c.id !== dialog.candidate?.id); await save({ ...p, candidates: rest, target_id: null }) } : undefined}/>
        : dialog.type === 'funds' ? <FundsForm plan={p} homes={homes} cashReference={data.cash_reference} onSave={save}/>
        : dialog.type === 'delete' && dialog.home ? <DeleteHome home={dialog.home} onDone={homeSaved} onCancel={() => setDialog({ type: 'home', home: dialog.home })}/>
        : dialog.type === 'market' && dialog.home ? <HomeMarket key={dialog.home.asset.id} home={dialog.home} onChanged={h => { setDialog({ type: 'market', home: h }); changed() }} onUpdateValue={() => setDialog({ type: 'home', home: dialog.home, start: 'value' })}/>
        : dialog.type === 'home' && <HomeWizard home={dialog.home} list={homes} family={family} owner={owner} start={dialog.start} onSaved={homeSaved} onDelete={dialog.home ? () => setDialog({ type: 'delete', home: dialog.home }) : undefined}/>}
    </Modal>}
  </div>
}
