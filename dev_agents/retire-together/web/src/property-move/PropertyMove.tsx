import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, House, MapPin, Plus, SlidersHorizontal, Target, X } from 'lucide-react'
import { Modal } from '../components'
import { api } from '../local-data'
import { money, type Family, type Owner } from '../model'
import { DeleteHome, HomeMarket, HomeWizard, KeySetup, sourceLabel, TENURE, type Home, type HomeList } from '../property-entry'
import { CandidateForm, FundsForm, LIVING_FIELDS } from './Forms'
import { TradePrice, TradeReport, usePriceCheck, useTrades } from './Market'
import { AnalysisHero } from './AnalysisHero'
import { HomeSaleSummary, PublicListings, usePublicListings } from './HomeListings'
import { dateToday, emptyLiving, type Budget, type Candidate, type Living, type MovePlan, type MoveState, type TrackEntry } from './types'
import './property-move.css'

type Props = { owner: Owner; family: Family | null; hidden: boolean; onChanged: () => void; onDemo: () => void }
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

function HomeLine({ home: h, hidden, family, owner, onEdit, onMarket }: { home: Home; hidden: boolean; family: Family | null; owner: Owner; onEdit: () => void; onMarket: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const dt = h.detail, m = h.metrics
  const market = useTrades(dt?.address, h.asset.name, dt?.area_m2)
  const listings = usePublicListings(dt?.address, h.asset.name, dt?.area_m2)
  const asking = listings.data?.summary ?? h.asking
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
      <div className="property-move-price-cell"><span>최근 실거래 · 집 전체</span><TradePrice market={market} hidden={hidden}/>{market.trades[0] && market.trades[0].name.replaceAll(' ', '') !== h.asset.name.replaceAll(' ', '') && <small>거래 신고명 · {market.trades[0].name}</small>}</div>
      <div className="property-move-price-cell"><span>현재 매도 호가 · 집 전체</span><strong>{asking ? `${show(asking.low)}${asking.high !== asking.low && !hidden ? ` ~ ${show(asking.high)}` : ''}` : listings.loading ? '조회 중…' : '—'}</strong><small>{listings.data?.summary ? `공개 매물 광고 ${asking!.count}건${listings.data.partial ? ' · 일부 조회' : ''}` : h.asking ? `직접 기록 ${h.asking.count}건 · ${askingDate ?? '확인일 미입력'}` : listings.error ? '공개 매물 조회 실패' : '확인한 매물 없음'}</small></div>
      <div className="property-move-price-cell property-move-equity-cell"><span>{owner === 'together' ? '부동산 순자산' : '선택한 소유자 순자산'}</span><strong>{show(m.equity_mine)}</strong><small>대출·반환 보증금 차감</small></div>
      <button className="property-move-icon-button" aria-label={`${h.asset.name} 상세 ${expanded ? '접기' : '보기'}`} aria-expanded={expanded} onClick={() => setExpanded(v => !v)}><ChevronDown size={18} className={expanded ? 'rotated' : ''}/></button>
    </div>
    <PublicListings market={listings} hidden={hidden} onManual={onMarket}/>
    {expanded && <div className="property-move-home-detail">
      <div className="property-move-home-facts"><div className="property-move-section-head"><h3>우리 집 거래 정보</h3><button className="property-move-link" onClick={onEdit}>집 정보 수정 <ChevronRight size={13}/></button></div><p className="property-move-note"><MapPin size={13}/>{dt?.address?.road || '주소를 등록하면 실거래가를 연결할 수 있어요.'}{dt ? ` · ${TENURE[dt.tenure]}` : ''}</p>
        <div className="property-move-value-comparison"><div><span>내 매입가 · 전체</span><strong>{show(dt?.purchase_price ?? null)}</strong><i style={{ height: !hidden && dt?.purchase_price ? `${Math.max(5, dt.purchase_price / Math.max(dt.purchase_price, h.full_value, 1) * 76)}px` : '6px' }}/></div><div><span>등록 시세 · 전체</span><strong>{show(h.full_value)}</strong><i style={{ height: !hidden ? `${Math.max(5, h.full_value / Math.max(dt?.purchase_price || 0, h.full_value, 1) * 76)}px` : '6px' }}/></div></div>
        <dl className="property-move-fact-list"><div><dt>매입가 대비 변화 · 전체</dt><dd>{gainKnown ? `${!hidden && m.gain! > 0 ? '+' : ''}${show(m.gain)}${!hidden && m.gain_rate !== null ? ` (${(m.gain_rate * 100).toFixed(1)}%)` : ''}` : '시세·매입가 확인 필요'}</dd></div><div><dt>연결 대출 {owner !== 'together' && '· 선택 지분'}</dt><dd>{show(m.loans_mine)}</dd></div><div><dt>돌려줄 보증금</dt><dd>{show(m.deposit_mine)}</dd></div><div><dt>등록 시세 기준일</dt><dd>{h.asset.as_of}</dd></div></dl>
        <button className="property-move-button" onClick={onMarket}>실거래 반영·호가 관리 <ArrowRight size={14}/></button><p className="property-move-note">순자산은 매도세금·비용 차감 전입니다. 아래 자금 계획에서 비용을 반영하세요.</p>
      </div><div><TradeReport market={market} hidden={hidden} purchase={dt?.purchase_price}/>{market.configured === false && <KeySetup onDone={market.retry}/>}</div>
    </div>}
  </article>
}

function PriceAnalysis({ candidate: c, hidden }: { candidate: Candidate; hidden: boolean }) {
  const [months, setMonths] = useState(12)
  const check = usePriceCheck(c.address, c.name, c.area_m2, c.asking_low, months)
  const a = check.data?.analysis
  const show = (n: number | null | undefined) => display(n, hidden)
  const pct = (n: number | null | undefined) => n == null || hidden ? '' : ` (${n > 0 ? '+' : ''}${n}%)`
  return <div className="property-move-analysis">
    <div className="property-move-section-head"><div><h3>가격 · 호가는 과거 거래와 어디쯤일까</h3><p>국토교통부 실거래 · 같은 단지, 전용면적 ±2㎡ · 해제 거래 제외. 적정·고평가 판단은 하지 않아요.</p></div>
      <div className="property-move-analysis-period" role="group" aria-label="조회 기간">{[12, 24, 36].map(m => <button key={m} type="button" aria-pressed={months === m} onClick={() => setMonths(m)}>{m}개월</button>)}</div></div>
    {!check.ready ? <p className="property-move-empty-copy">후보 수정에서 주소와 전용면적을 저장하면 같은 단지의 거래를 비교할 수 있어요.</p>
      : check.loading && !check.data ? <p className="property-move-empty-copy">실거래를 조회하고 있어요. 기간이 길면 시간이 걸려요.</p>
      : check.error ? <p className="property-move-notice" role="alert">{check.error} <button type="button" className="property-move-link" onClick={check.retry}>다시 조회</button></p>
      : check.data && !check.data.configured ? <p className="property-move-empty-copy">실거래 연결 설정 후 비교할 수 있어요. 우리 집 줄의 상세에서 인증키를 넣어 주세요.</p>
      : a && a.count === 0 ? <p className="property-move-empty-copy">최근 {months}개월 이 단지·면적의 거래가 없어요.</p>
      : a && <>
        <div className="property-move-analysis-grid">
          <div><span>현재 호가</span><strong>{c.asking_low !== null ? `${show(c.asking_low)}${c.asking_high !== null && c.asking_high !== c.asking_low && !hidden ? ` ~ ${show(c.asking_high)}` : ''}` : '미기록'}</strong><small>{c.asking_date ? `직접 기록 · ${c.asking_date}` : '아래 추적에서 호가를 적으면 비교해요'}</small></div>
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
    <div className="property-move-section-head"><div><h3>거주 정보 · 직접 확인한 것</h3><p>학군·출퇴근·생활·단점. 자동 조회나 점수는 없어요. 확인한 날과 출처를 같이 적어두면 좋아요.</p></div>
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
    <div className="property-move-section-head"><div><h3>추적 기록</h3><p>기록할 때마다 목표 집 가격 · 우리 집 · 격차 · 더 필요한 돈이 한 줄로 남아요. 하루에 한 줄.</p></div>
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
    </table></div> : <p className="property-move-empty-copy">아직 기록이 없어요. 위 버튼을 누르면 지금 보이는 가격으로 첫 줄이 남고, 계획 매수가를 바꿔 저장할 때도 자동으로 쌓여요.</p>}
    <p className="property-move-note">격차 = 목표 집 가격 − 팔고 갈 집 평가액(집 전체). 더 필요한 돈은 비용·대출·모아둔 돈까지 넣은 자금 계획 기준이에요.</p>
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
      <div className="property-move-price-cell"><span>현재 호가</span><strong>{c.asking_low !== null ? `${show(c.asking_low)}${c.asking_high !== null && c.asking_high !== c.asking_low && !hidden ? ` ~ ${show(c.asking_high)}` : ''}` : '미기록'}</strong><small>{c.asking_date ? `직접 기록 · ${c.asking_date}` : '아래 추적에서 기록'}</small></div>
      <div className="property-move-price-cell property-move-diff-cell"><span>우리 집과 격차</span><strong>{signed(budget?.price_gap, hidden)}</strong><small>{delta != null && prev ? hidden ? '••••' : delta === 0 ? `${prev.day} 기록과 같음` : `${prev.day}보다 ${signed(delta, false)} ${delta > 0 ? '벌어짐' : '좁혀짐'}` : track.length ? `기록 ${track.length}건` : budget?.price_gap != null ? '목표 집 가격 − 팔 집 평가액' : '팔 집·계획 매수가 입력 필요'}</small></div>
      <div className="property-move-price-cell property-move-gap-cell"><span>지금 더 필요한 돈</span><strong>{show(budget?.gap)}</strong><small>{budget?.gap == null ? '자금 계획 입력 필요' : budget.gap === 0 ? '지금 자금으로 닿아요' : budget.costs_complete ? '입력한 비용 포함' : '비용 미입력분 제외'}</small></div>
      <div className="property-move-price-cell property-move-future-cell"><span>목표 시점에도 더 필요</span><strong>{budget?.months == null ? '—' : show(budget.future_gap)}</strong><small>{budget?.months == null ? '이사 시점 미입력' : budget.future_gap === 0 ? `${budget.months}개월 뒤 닿아요` : budget.required_monthly != null ? `맞추려면 월 ${show(budget.required_monthly)}` : '목표 월 도래'}</small></div>
      <button className="property-move-icon-button" aria-label={`${c.name} 분석 ${open ? '접기' : '보기'}`} aria-expanded={open} onClick={() => setOpen(v => !v)}><ChevronDown size={18} className={open ? 'rotated' : ''}/></button>
    </div>
    {open && <div className="property-move-detail"><PriceAnalysis candidate={c} hidden={hidden}/><TrackPanel candidate={c} track={track} pick={pickPrice(c, market.trades[0])} hidden={hidden} busy={busy} onTrack={onTrack} onAsking={onAsking} onUntrack={onUntrack}/><LivingNotes key={JSON.stringify(c.living)} candidate={c} busy={busy} onSave={onLiving}/></div>}
  </article>
}

export function PropertyMove({ owner, family, hidden, onChanged, onDemo }: Props) {
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
    Promise.all([api<HomeList>(`/property?owner=${owner}`, 'GET', undefined, controller.signal), api<MoveState>(`/property-move?owner=${owner}`, 'GET', undefined, controller.signal)])
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
  const selectedHomes = homes.homes.filter(h => p.source_home_ids.includes(h.asset.id))
  const budgetOf = (id: string) => data.comparisons.find(b => b.id === id)
  const candidates = [...p.candidates].sort((a, b) => sort === 'price' ? (a.price ?? Infinity) - (b.price ?? Infinity) : (budgetOf(a.id)?.gap ?? Infinity) - (budgetOf(b.id)?.gap ?? Infinity))
  const priced = data.comparisons.filter(b => b.gap != null)
  const reachNow = priced.filter(b => b.gap === 0).length, reachLater = priced.filter(b => b.future_gap === 0).length
  return <div className="property-move">
    {error && <div className="property-move-error" role="alert">{error} <button className="property-move-link" onClick={refresh}>다시 불러오기</button></div>}
    <AnalysisHero data={data} hidden={hidden} onEdit={candidate => setDialog({ type: 'candidate', candidate })} onAdd={() => setDialog({ type: 'candidate' })} onDetails={id => setDetailsRequest(old => ({ id, sequence: (old?.sequence ?? 0) + 1 }))}/>
    <section className="property-move-funds-card" aria-label="갈아타기 자금">
      <div className="property-move-funds-own"><span>준비한 자기자금</span><strong>{show(f.own_funds)}</strong><small>{!selectedHomes.length && !homes.homes.length ? '우리 집을 등록하면 매도 후 자금을 계산해요' : !selectedHomes.length ? '팔고 갈 집 선택 필요 · 첫 집이면 모아둔 돈만' : p.cash === null ? `매도 후 ${show(f.sale_net)} · 모아둔 돈 입력 필요` : `매도 후 ${show(f.sale_net)} + 모아둔 돈 ${show(p.cash)}`}{p.new_loan > 0 ? ` · 대출 가정 ${show(p.new_loan)} 별도` : ''}</small></div>
      <div className="property-move-funds-saving"><span>앞으로 모을 돈</span><strong>{p.target_month && f.months != null ? show(f.future_savings) : '—'}</strong><small>{p.target_month && f.months != null ? `매달 ${show(p.monthly_saving)} · ${p.target_month.replace('-', '.')}까지 ${f.months}개월` : '이사 시점·매달 모을 돈 미입력'}</small></div>
      <div className="property-move-funds-reach"><span>후보 {p.candidates.length}곳</span><strong>{!priced.length ? '—' : `지금 닿는 곳 ${reachNow}곳`}</strong><small>{!p.candidates.length ? '비교할 아파트를 더해보세요' : !priced.length ? '자금 계획을 입력하면 비교해요' : p.target_month ? `목표 시점엔 ${reachLater}곳` : '이사 시점을 정하면 그때 닿는 곳도 보여요'}</small></div>
      <div className="property-move-funds-actions"><button className="property-move-button primary" onClick={() => homes.homes.length ? setDialog({ type: 'funds' }) : setDialog({ type: 'home', home: null })}><SlidersHorizontal size={15}/>{homes.homes.length ? '자금·시점 설정' : '우리 집부터 등록'}</button><small>{selectedHomes.length ? `팔고 갈 집 · ${selectedHomes[0].asset.name}${selectedHomes.length > 1 ? ` 외 ${selectedHomes.length - 1}채` : ''}` : '연금은 포함하지 않아요'}{f.sale_value > 0 && p.sale_costs === null ? ' · 매도세금 미입력' : ''}</small></div>
    </section>
    {(data.missing_home_ids.length > 0 || data.valuation_needs_review.length > 0) && <p className="property-move-notice">{data.missing_home_ids.length ? '매도할 집이 삭제되었어요. 자금 계획에서 다시 선택해 주세요.' : '선택한 집에 확인이 필요한 시세가 있어요. 실거래 또는 직접 확인한 시세로 갱신해 주세요.'}</p>}
    <section className="property-move-section" id="property-move-homes"><div className="property-move-section-head"><div><span className="property-move-kicker">01 · OUR HOME TODAY</span><h2>우리 집을 모두 팔면</h2><p>매도금액 합계와 대출·보증금을 뺀 금액, 지금 나온 매물을 함께 봐요.</p></div><button className="property-move-button" onClick={() => setDialog({ type: 'home', home: null })}><Plus size={15}/>{homes.homes.length ? '집 추가' : '우리 집 등록'}</button></div>
      <HomeSaleSummary homes={homes} hidden={hidden} owner={owner}/>
      <div className="property-move-home-list">{homes.homes.length ? homes.homes.map(h => <HomeLine key={h.asset.id} home={h} hidden={hidden} owner={owner} family={family} onEdit={() => setDialog({ type: 'home', home: h })} onMarket={() => setDialog({ type: 'market', home: h })}/>) : <div className="property-move-empty"><House size={27}/><div><strong>우리 집의 첫 기록을 남겨요.</strong><p>주소·매입가·명의를 등록하면 실거래와 대출을 함께 볼 수 있어요.</p></div></div>}</div>
    </section>
    <section className="property-move-section" id="property-move-compare"><div className="property-move-section-head"><div><span className="property-move-kicker">02 · WHERE TO NEXT</span><h2>어디로 갈까요?</h2><p>후보마다 우리 집과의 격차와 더 필요한 돈을 같은 자금으로 봐요. 줄을 펼치면 가격 분석·추적 기록·거주 정보가 나와요.</p></div><button className="property-move-button" disabled={p.candidates.length >= 50} onClick={() => setDialog({ type: 'candidate' })}><Plus size={15}/>비교할 아파트 추가</button></div>
      {p.candidates.length > 1 && <div className="property-move-compare-toolbar"><span>후보 {p.candidates.length}곳 · 같은 자금으로 비교</span><select aria-label="후보 정렬" value={sort} onChange={e => setSort(e.target.value)}><option value="gap">더 필요한 돈 적은 순</option><option value="price">낮은 가격순</option></select></div>}
      <div className="property-move-candidates">{candidates.map(c => <CandidateLine key={c.id} candidate={c} budget={budgetOf(c.id)} track={data.track[c.id] ?? []} hidden={hidden} busy={busy} revealKey={detailsRequest?.id === c.id ? detailsRequest.sequence : 0} onEdit={() => setDialog({ type: 'candidate', candidate: c })} onTrack={(pick, note) => trackNow(c.id, pick, note)} onUntrack={day => untrack(c.id, day)} onLiving={living => save({ ...p, candidates: p.candidates.map(old => old.id === c.id ? { ...old, living } : old), target_id: null })} onAsking={async won => { await save({ ...p, candidates: p.candidates.map(old => old.id === c.id ? { ...old, asking_low: won, asking_high: won, asking_date: dateToday() } : old), target_id: null }); await trackNow(c.id, { price: won, price_basis: 'asking', price_date: dateToday() }, '') }}/>)}</div>
      {!candidates.length && <div className="property-move-empty"><Target size={28}/><div><strong>마음에 둔 아파트부터 하나씩.</strong><p>후보를 더하면 같은 자금으로 더 필요한 돈을 나란히 비교하고, 줄마다 격차를 추적해요.</p></div></div>}
      <p className="property-move-note">더 필요한 돈은 등록한 후보의 계획 매수가와 자금 계획 기준입니다. 호가는 직접 확인한 기록이며 자동 갱신되지 않아요.</p>
    </section>
    <button className="property-move-link property-move-demo-link" onClick={onDemo}>가상 예시 화면 보기 <ArrowRight size={13}/></button>
    {dialog && <Modal title={dialog.type === 'candidate' ? dialog.candidate ? '비교 아파트 수정' : '비교할 아파트 추가' : dialog.type === 'funds' ? '갈아타기 자금 계획' : dialog.type === 'market' ? `${dialog.home?.asset.name} 시세·호가` : dialog.type === 'delete' ? '집 삭제' : dialog.home ? '집 정보' : '우리 집 등록'} onClose={() => setDialog(null)}>
      {dialog.type === 'candidate' ? <CandidateForm initial={dialog.candidate} onSave={async c => { const exists = p.candidates.some(old => old.id === c.id); await save({ ...p, candidates: exists ? p.candidates.map(old => old.id === c.id ? c : old) : [...p.candidates, c], target_id: null }) }} onDelete={dialog.candidate ? async () => { const rest = p.candidates.filter(c => c.id !== dialog.candidate?.id); await save({ ...p, candidates: rest, target_id: null }) } : undefined}/>
        : dialog.type === 'funds' ? <FundsForm plan={p} homes={homes} cashReference={data.cash_reference} onSave={save}/>
        : dialog.type === 'delete' && dialog.home ? <DeleteHome home={dialog.home} onDone={homeSaved} onCancel={() => setDialog({ type: 'home', home: dialog.home })}/>
        : dialog.type === 'market' && dialog.home ? <HomeMarket key={dialog.home.asset.id} home={dialog.home} onChanged={h => { setDialog({ type: 'market', home: h }); changed() }} onUpdateValue={() => setDialog({ type: 'home', home: dialog.home, start: 'value' })}/>
        : dialog.type === 'home' && <HomeWizard home={dialog.home} list={homes} family={family} owner={owner} start={dialog.start} onSaved={homeSaved} onDelete={dialog.home ? () => setDialog({ type: 'delete', home: dialog.home }) : undefined}/>}
    </Modal>}
  </div>
}
