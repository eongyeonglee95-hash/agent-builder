// PROPERTY-02 집 등록·수정 — 한 화면에 질문 하나씩 (주소 → 명의 → 산 가격 → 시세 → 거주 형태 → 대출 → 확인).
// 저장은 /api/property 한 번. 장부에는 집·대출·보증금이 각각 행으로 들어가 엑셀 보고서·홈 합계에 그대로 잡힌다.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, ChevronRight, House, Plus, X } from 'lucide-react'
import { api } from './local-data'
import { Modal } from './components'
import { money, type Family } from './model'
import './property.css'

export type Address = { road: string; jibun: string; building: string; bcode: string | null; sigungu_code: string | null; zonecode: string | null; apartment: boolean }
export type Tenure = 'live' | 'jeonse' | 'monthly' | 'other'
export type LoanRef = { id: string; name: string; amount: number; owner: string; as_of: string; mine?: number }
export type Home = {
  asset: { id: string; name: string; owner: 'me' | 'partner' | 'joint'; share_percent: number | null; amount: number; as_of: string; version: number }
  value: number; full_value: number
  detail: null | { address: Address | null; area_m2: number | null; pyeong: number | null; purchase_price: number | null; purchase_month: string | null; tenure: Tenure; deposit: number | null; monthly_rent: number | null; loan_ids: string[]; listings?: Listing[]; value_source?: ValueSource | null; version: number }
  loans: LoanRef[]; deposit: { id: string; amount: number; mine: number } | null
  asking: { low: number; high: number; count: number } | null
  metrics: { gain: number | null; gain_rate: number | null; held_months: number | null; equity: number; ltv: number | null; gain_mine: number | null; loans_mine: number; deposit_mine: number; equity_mine: number }
}
export type ValueSource = { kind: 'trade' | 'purchase' | 'manual' | 'none'; date?: string; floor?: number | null; area?: number }
export function sourceLabel(v?: ValueSource | null) {
  if (!v) return '직접 입력'
  return v.kind === 'trade' ? `실거래 ${v.date?.slice(0, 7).replace('-', '.')}${v.floor ? ` · ${v.floor}층` : ''}` : v.kind === 'purchase' ? '산 가격 기준 · 시세 확인 필요' : v.kind === 'none' ? '시세 확인 필요' : '직접 입력'
}
export type Listing = { price: number; floor: string; memo: string; checked_on: string }
export type HomeList = { homes: Home[]; free_loans: LoanRef[]; total: { value: number; loans: number; deposit: number; equity: number } }

type Step = 'address' | 'owner' | 'purchase' | 'value' | 'tenure' | 'loans' | 'review'
const ALL_STEPS: Step[] = ['address', 'owner', 'purchase', 'value', 'tenure', 'loans', 'review']
const STEPS: Step[] = ALL_STEPS.filter(s => s !== 'value')   // 등록 때는 시세를 묻지 않는다 — 실거래가·산 가격으로 자동
export const TENURE: Record<Tenure, string> = { live: '직접 살아요', jeonse: '전세 줬어요', monthly: '월세 줬어요', other: '비어 있거나 기타' }
const AREAS = [59, 74, 84, 114]
const today = () => new Date().toLocaleDateString('sv-SE')
const thisMonth = () => today().slice(0, 7)

// ── 금액 입력: 만원 단위로 치고, 읽기 쉬운 억·만으로 바로 보여 준다 ──
function toMan(won: number | null | undefined) { return won ? String(Math.round(won / 10_000)) : '' }
function fromMan(text: string) { const n = Number(text.replace(/[^\d]/g, '')); return text && Number.isFinite(n) ? n * 10_000 : null }
const QUICK: [string, number][] = [['+10억', 100_000], ['+1억', 10_000], ['+1,000만', 1_000], ['+100만', 100]]   // 만원 단위
function MoneyField({ label, value, onChange, autoFocus, hint }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; hint?: ReactNode }) {
  const won = fromMan(value)
  return <label className="pe-money">
    <span className="pe-field-label">{label}</span>
    <span className="pe-money-input"><input inputMode="numeric" autoFocus={autoFocus} value={value ? Number(value).toLocaleString('ko-KR') : ''} placeholder="0" onChange={e => onChange(e.target.value.replace(/[^\d]/g, '').slice(0, 9))}/><em>만원</em></span>
    <small>{won ? money(won) : hint ?? '만원 단위로 입력해요. 예: 82000 → 8억 2,000만원'}</small>
    <span className="pe-quick">{QUICK.map(([label, man]) => <button type="button" key={label} onClick={e => { e.preventDefault(); onChange(String(Math.min((Number(value) || 0) + man, 999_999_999))) }}>{label}</button>)}
      {value && <button type="button" className="pe-quick-clear" onClick={e => { e.preventDefault(); onChange('') }}>지우기</button>}</span>
  </label>
}

// ── 면적: 전용㎡가 기준(실거래가가 전용면적으로 나온다). 평형(분양 평수)으로 쳐도 된다 ──
const SQM = 3.305785, SUPPLY = 0.75   // 아파트 전용/공급 비율은 단지마다 다르다 — 평형 환산은 '약'으로만 쓴다
const toTypePy = (m2: number) => Math.round(m2 / SQM / SUPPLY)
function AreaField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [unit, setUnit] = useState<'m2' | 'py'>('m2')
  const [typed, setTyped] = useState('')
  const m2 = Number(value) || 0
  return <div className="pe-field"><span className="pe-field-label">면적 <small>선택 · 실거래가를 찾을 때 써요</small></span>
    <div className="pe-chips">{AREAS.map(a => <button type="button" key={a} className={m2 === a ? 'on' : ''} onClick={() => { setTyped(''); onChange(m2 === a ? '' : String(a)) }}>{a}㎡ · {toTypePy(a)}평형</button>)}</div>
    <div className="pe-area-row">
      <div className="pe-seg" role="group" aria-label="면적 단위">{([['m2', '전용 ㎡'], ['py', '평형']] as const).map(([k, l]) => <button type="button" key={k} className={unit === k ? 'on' : ''} aria-pressed={unit === k} onClick={() => { setUnit(k); setTyped('') }}>{l}</button>)}</div>
      <span className="pe-unit-input"><input inputMode="decimal" placeholder="직접" value={typed} onChange={e => { const t = e.target.value.replace(/[^\d.]/g, '').slice(0, 6); setTyped(t); const n = Number(t); onChange(!n ? '' : unit === 'm2' ? String(n) : String(Math.round(n * SQM * SUPPLY * 10) / 10)) }}/><em>{unit === 'm2' ? '㎡' : '평형'}</em></span>
    </div>
    {m2 > 0 && <small>{unit === 'py' && typed ? `${typed}평형 → 전용 약 ${m2}㎡로 저장해요. 계약서·등기부의 전용면적을 알면 ‘전용 ㎡’로 넣는 게 정확해요.` : `전용 ${m2}㎡ (${(m2 / SQM).toFixed(1)}평) · 보통 ${toTypePy(m2)}평형 안팎`}</small>}
  </div>
}

// ── 날짜: 산 날짜는 연도·월만 고르고, 시세 기준일은 오늘이 기본 ──
function YearMonth({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  // 숫자만 친다: 201905 → 2019.05. 연도만(2019) 치면 1월로 본다
  const [text, setText] = useState(value ? value.replace('-', '.') : '')
  const digits = text.replace(/\D/g, '')
  const y = Number(digits.slice(0, 4)), m = digits.length > 4 ? Number(digits.slice(4, 6)) : 0
  const now = new Date(), cur = now.getFullYear() * 100 + now.getMonth() + 1
  const bad = digits.length >= 4 && (y < 1950 || (m && (m < 1 || m > 12)) || y * 100 + (m || 1) > cur)
  function type(raw: string) {
    const d = raw.replace(/\D/g, '').slice(0, 6)
    setText(d.length > 4 ? `${d.slice(0, 4)}.${d.slice(4)}` : d)
    const yy = Number(d.slice(0, 4)), mm = d.length === 6 ? Number(d.slice(4)) : d.length === 5 ? Number(d.slice(4)) : 1
    const ok = d.length >= 4 && yy >= 1950 && mm >= 1 && mm <= 12 && yy * 100 + mm <= cur
    onChange(ok ? `${yy}-${String(mm).padStart(2, '0')}` : '')
  }
  const ago = value ? (() => { const [vy, vm] = value.split('-').map(Number); const n = (now.getFullYear() - vy) * 12 + now.getMonth() + 1 - vm; return n >= 12 ? `${Math.floor(n / 12)}년${n % 12 ? ` ${n % 12}개월` : ''} 전` : n > 0 ? `${n}개월 전` : '이번 달' })() : ''
  return <label className="pe-field"><span className="pe-field-label">{label}</span>
    <input inputMode="numeric" value={text} placeholder="예: 201905" onChange={e => type(e.target.value)}/>
    <small>{bad ? '연도와 월을 확인해 주세요 (미래는 안 돼요)' : value ? `${Number(value.slice(0, 4))}년 ${Number(value.slice(5))}월 · ${ago}` : '연도와 월을 숫자로만 쳐요'}</small>
  </label>
}
function AsOf({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(value !== today())
  if (!open) return <p className="pe-note">{value.replace(/-/g, '.')} 오늘 기준으로 저장해요. <button type="button" className="pe-inline-link" onClick={() => setOpen(true)}>다른 날짜로</button></p>
  return <label className="pe-field"><span className="pe-field-label">시세 기준일</span><input type="date" value={value} max={today()} onChange={e => onChange(e.target.value || today())}/>
    <small><button type="button" className="pe-inline-link" onClick={() => { onChange(today()); setOpen(false) }}>오늘로</button></small></label>
}

// ── 실거래가 (국토부 공식) ──
type Trade = { name: string; area: number; price: number; date: string; floor: number | null; kind: string }
function Trades({ sigungu, name, area, jibun, picked, onPick }: { sigungu: string; name: string; area: number | null; jibun?: string; picked?: number | null; onPick?: (t: Trade) => void }) {
  const dong = jibun?.split(' ').reverse().find(w => /\S+(동|가|리)$/.test(w))
  const [state, setState] = useState<{ loading: boolean; configured?: boolean; trades: Trade[]; error?: string }>({ loading: true, trades: [] })
  const [rev, setRev] = useState(0)
  useEffect(() => {
    let live = true
    setState({ loading: true, trades: [] })
    api<{ configured: boolean; trades: Trade[] }>(`/property/trades?sigungu=${sigungu}&name=${encodeURIComponent(name)}${area ? `&area=${area}` : ''}${dong ? `&dong=${encodeURIComponent(dong)}` : ''}${jibun ? `&jibun=${encodeURIComponent(jibun)}` : ''}`)
      .then(r => live && setState({ loading: false, configured: r.configured, trades: r.trades }), e => live && setState({ loading: false, configured: true, trades: [], error: e instanceof Error ? e.message : '불러오지 못했어요.' }))
    return () => { live = false }
  }, [sigungu, name, area, dong, jibun, rev])
  if (state.loading) return <p className="pe-note">최근 실거래가를 불러오는 중…</p>
  if (state.configured === false) return <KeySetup onDone={() => setRev(r => r + 1)}/>
  return <div className="pe-trades">
    <span className="pe-field-label">최근 12개월 실거래 · {name}{area ? ` 전용 ${area}㎡ 근처` : ''}</span>
    {state.error ? <p className="form-error">{state.error}</p> : !state.trades.length ? <p className="pe-note">최근 12개월 안에 이 단지·면적의 거래가 없어요.</p>
      : <ul>{state.trades.slice(0, 6).map((t, i) => <li key={i}><button type="button" disabled={!onPick} className={picked === t.price ? 'on' : ''} onClick={() => onPick?.(t)}>
          <span>{t.date.replace(/-/g, '.')}</span><span>{t.floor ?? '—'}층 · {t.area}㎡</span><b>{money(t.price)}</b></button></li>)}</ul>}
    {onPick && state.trades.length > 0 && <small>누르면 시세와 기준일에 채워져요</small>}
  </div>
}
export function KeySetup({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [error, setError] = useState('')
  if (!open) return <p className="pe-note">실거래가를 자동으로 불러오려면 공공데이터포털 인증키가 한 번 필요해요. <button type="button" className="pe-inline-link" onClick={() => setOpen(true)}>인증키 넣기</button></p>
  return <div className="pe-keybox">
    <p className="pe-note">1. <a href="https://www.data.go.kr/data/15126468/openapi.do" target="_blank" rel="noreferrer">공공데이터포털 ‘국토교통부 아파트 매매 실거래가 상세 자료’</a>에서 활용 신청(무료) → 2. 마이페이지의 ‘일반 인증키’를 복사해 아래에 붙여 넣기. 키는 이 컴퓨터에만 저장돼요.</p>
    <div className="pe-keyrow"><input value={key} placeholder="인증키 붙여 넣기" onChange={e => setKey(e.target.value.trim())}/>
      <button type="button" className="primary-button" disabled={key.length < 10} onClick={async () => { try { await api('/property/market/key', 'PUT', { key }); onDone() } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요.') } }}>저장</button></div>
    {error && <p className="form-error">{error}</p>}
  </div>
}

// ── 호가·매물 (직접 적는 칸, 시세와 따로) ──
export function HomeMarket({ home, onChanged, onUpdateValue }: { home: Home; onChanged: (h: Home) => void; onUpdateValue: () => void }) {
  const [listings, setListings] = useState<Listing[]>(home.detail?.listings ?? [])
  const [form, setForm] = useState({ price: '', floor: '', memo: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(home.detail?.version ?? 0)
  const name = home.detail?.address?.building || home.asset.name
  async function save(next: Listing[]) {
    setBusy(true); setError('')
    try { const h = await api<Home>(`/property/${home.asset.id}/listings`, 'PUT', { listings: next, detail_version: version }); setListings(h.detail?.listings ?? []); setVersion(h.detail?.version ?? version); onChanged(h); return true }
    catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요.'); return false } finally { setBusy(false) }
  }
  const prices = listings.map(l => l.price)
  return <div className="pe">
    <section className="pm-block">
      <div className="pm-head"><h3>실거래가</h3><span>시세에 반영</span></div>
      {home.detail?.address?.sigungu_code ? <Trades sigungu={home.detail.address.sigungu_code} name={name} area={home.detail.area_m2} jibun={home.detail.address.jibun}/> : <p className="pe-note">주소를 검색해 저장하면 실거래가를 불러올 수 있어요.</p>}
      <div className="pm-actions">{home.detail?.address?.sigungu_code && <button type="button" className="primary-button pm-update" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const h = await api<Home>(`/property/${home.asset.id}/refresh`, 'POST'); setVersion(h.detail?.version ?? version); onChanged(h) } catch (e) { setError(e instanceof Error ? e.message : '갱신하지 못했어요.') } finally { setBusy(false) } }}>최근 실거래가로 시세 갱신</button>}
        <button type="button" className="secondary-button pm-update" onClick={onUpdateValue}>직접 입력</button></div>
      <p className="pe-note">지금 시세: {money(home.full_value)} · {sourceLabel(home.detail?.value_source)}</p>
    </section>
    <section className="pm-block">
      <div className="pm-head"><h3>호가 · 매물</h3><span>참고용 · 순자산에는 넣지 않아요</span></div>
      {prices.length > 0 && <p className="pm-range"><b>{money(Math.min(...prices))}</b>{Math.max(...prices) !== Math.min(...prices) && <> ~ <b>{money(Math.max(...prices))}</b></>} · 매물 {prices.length}건</p>}
      {!version ? <p className="pe-note">‘집 정보’에서 주소·산 가격을 먼저 저장하면 매물을 적어 둘 수 있어요.</p> : <>
        <ul className="pm-list">{listings.map((l, i) => <li key={i}><span>{l.floor || '층 모름'}</span><span className="pm-memo">{l.memo}</span><small>{l.checked_on.replace(/-/g, '.')} 확인</small><b>{money(l.price)}</b>
          <button type="button" aria-label="이 매물 지우기" disabled={busy} onClick={() => save(listings.filter((_, j) => j !== i))}><X size={14}/></button></li>)}</ul>
        <div className="pm-add">
          <MoneyField label="호가" value={form.price} onChange={v => setForm(f => ({ ...f, price: v }))}/>
          <div className="pm-add-row"><label className="pe-field"><span className="pe-field-label">층</span><input value={form.floor} maxLength={20} placeholder="예: 12층, 고층" onChange={e => setForm(f => ({ ...f, floor: e.target.value }))}/></label>
            <label className="pe-field"><span className="pe-field-label">메모 <small>선택</small></span><input value={form.memo} maxLength={100} placeholder="예: 남향, 올수리" onChange={e => setForm(f => ({ ...f, memo: e.target.value }))}/></label></div>
          <button type="button" className="secondary-button" disabled={busy || !fromMan(form.price)} onClick={async () => { if (await save([...listings, { price: fromMan(form.price)!, floor: form.floor.trim(), memo: form.memo.trim(), checked_on: today() }])) setForm({ price: '', floor: '', memo: '' }) }}><Plus size={14}/>매물 추가</button>
        </div>
        <p className="pe-note"><a href={`https://m.land.naver.com/search/result/${encodeURIComponent(name)}`} target="_blank" rel="noreferrer">네이버 부동산에서 매물 보기</a> · <a href="https://kbland.kr/" target="_blank" rel="noreferrer">KB부동산</a> — 보고 온 호가를 위에 적어 두세요.</p>
      </>}
      {error && <p className="form-error">{error}</p>}
    </section>
  </div>
}

// ── 주소 검색: 카카오(다음) 우편번호 서비스. 키 없이 동작하고, 검색어는 카카오로 전송된다 ──
type Postcode = { roadAddress: string; jibunAddress: string; autoJibunAddress: string; buildingName: string; apartment: 'Y' | 'N'; bcode: string; sigunguCode: string; zonecode: string }
declare global { interface Window { daum?: { Postcode: new (o: { oncomplete: (d: Postcode) => void; width: string; height: string }) => { embed: (el: HTMLElement, o?: { autoClose?: boolean }) => void } } } }
const POSTCODE_SRC = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
let postcodeLoad: Promise<void> | null = null
function loadPostcode() {
  if (window.daum?.Postcode) return Promise.resolve()
  postcodeLoad ??= new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = POSTCODE_SRC; s.async = true; s.onload = () => resolve(); s.onerror = () => { postcodeLoad = null; reject(new Error('load')) }; document.head.appendChild(s) })
  return postcodeLoad
}
export function AddressSearch({ onPick }: { onPick: (a: Address) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    loadPostcode().then(() => {
      if (!live || !box.current || !window.daum) return
      box.current.innerHTML = ''
      new window.daum.Postcode({ width: '100%', height: '100%', oncomplete: d => onPick({ road: d.roadAddress, jibun: d.jibunAddress || d.autoJibunAddress, building: d.buildingName, bcode: /^\d{10}$/.test(d.bcode) ? d.bcode : null, sigungu_code: /^\d{5}$/.test(d.sigunguCode) ? d.sigunguCode : null, zonecode: /^\d{5}$/.test(d.zonecode) ? d.zonecode : null, apartment: d.apartment === 'Y' }) }).embed(box.current, { autoClose: false })
    }).catch(() => live && setFailed(true))
    return () => { live = false }
  }, [onPick])
  if (failed) return <p className="pe-note">주소 검색을 불러오지 못했어요(인터넷 연결 확인). 아래 ‘주소 없이 이름만 적기’로 계속할 수 있어요.</p>
  return <div className="pe-postcode" ref={box}><p className="pe-note">주소 검색을 불러오는 중…</p></div>
}

// ── 마법사 ──
type Draft = {
  name: string; address: Address | null; area: string; owner: 'me' | 'partner' | 'joint'; share: number
  purchase: string; purchaseMonth: string; value: string; asOf: string
  tenure: Tenure; deposit: string; rent: string; loanIds: string[]; newLoans: { name: string; amount: string }[]
}
function draftFrom(home: Home | null, owner: 'together' | 'me' | 'partner'): Draft {
  const d = home?.detail
  return {
    name: home?.asset.name ?? '', address: d?.address ?? null, area: d?.area_m2 ? String(d.area_m2) : '',
    owner: home?.asset.owner ?? (owner === 'partner' ? 'partner' : owner === 'me' ? 'me' : 'joint'), share: home?.asset.share_percent ?? 50,
    purchase: toMan(d?.purchase_price), purchaseMonth: d?.purchase_month ?? '', value: toMan(home?.full_value), asOf: home?.asset.as_of ?? today(),
    tenure: d?.tenure ?? 'live', deposit: toMan(d?.deposit), rent: toMan(d?.monthly_rent),
    loanIds: home?.loans.map(l => l.id) ?? [], newLoans: [],
  }
}

export function HomeWizard({ home, list, family, owner, start, onSaved, onDelete }: {
  home: Home | null; list: HomeList; family: Family | null; owner: 'together' | 'me' | 'partner'; start?: Step
  onSaved: (h: Home) => void; onDelete?: () => void
}) {
  const editing = !!home
  const [step, setStep] = useState<Step>(start ?? (editing ? 'review' : 'address'))
  const [d, setD] = useState<Draft>(() => draftFrom(home, owner))
  const [manualAddress, setManualAddress] = useState(false)
  const [valueTouched, setValueTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(crypto.randomUUID())
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(old => ({ ...old, [k]: v }))
  const meName = family?.me.name ?? '나', partnerName = family?.partner?.name ?? '배우자'
  const loanChoices = useMemo(() => [...(home?.loans ?? []), ...list.free_loans], [home, list.free_loans])
  const index = STEPS.indexOf(step)
  const pick = useMemo(() => (a: Address) => { setD(old => ({ ...old, address: a, name: old.name || a.building || a.road.split(' ').slice(-2).join(' ') })) }, [])

  const problem: Partial<Record<Step, string>> = {
    address: !d.name.trim() ? '집 이름을 적어 주세요' : '',
    owner: d.owner === 'joint' && !(d.share >= 1 && d.share <= 99) ? '내 지분은 1~99%예요' : '',
    purchase: d.purchaseMonth > thisMonth() ? '산 날짜가 미래예요' : '',
    value: !valueTouched ? '' : !fromMan(d.value) ? '지금 시세를 넣어 주세요' : d.asOf > today() ? '기준일이 미래예요' : '',
    tenure: d.tenure !== 'live' && d.tenure !== 'other' && !fromMan(d.deposit) ? '보증금을 넣어 주세요' : '',
    loans: d.newLoans.some(l => !l.name.trim() || !fromMan(l.amount)) ? '새 대출의 이름과 잔액을 채워 주세요' : '',
  }
  function next() {
    if (problem[step]) { setError(problem[step]!); return }
    setError('')
    setStep(editing ? 'review' : STEPS[Math.min(index + 1, STEPS.length - 1)])
  }
  async function save() {
    const firstBad = ALL_STEPS.find(s => problem[s])
    if (firstBad) { setStep(firstBad); setError(problem[firstBad]!); return }
    const rented = d.tenure === 'jeonse' || d.tenure === 'monthly'
    const body = {
      name: d.name.trim(), owner: d.owner, share_percent: d.owner === 'joint' ? d.share : null,
      ...(valueTouched ? { value: fromMan(d.value), as_of: d.asOf } : {}), address: d.address, area_m2: d.area ? Number(d.area) : null,
      purchase_price: fromMan(d.purchase), purchase_month: d.purchaseMonth || null, tenure: d.tenure,
      deposit: rented ? fromMan(d.deposit) : null, monthly_rent: d.tenure === 'monthly' ? fromMan(d.rent) : null,
      loan_ids: d.loanIds, new_loans: d.newLoans.map(l => ({ name: l.name.trim(), amount: fromMan(l.amount) })),
    }
    setBusy(true); setError('')
    try {
      const saved = home
        ? await api<Home>(`/property/${home.asset.id}`, 'PUT', { ...body, version: home.asset.version, detail_version: home.detail?.version ?? 0 })
        : await api<Home>('/property', 'POST', { ...body, request_id: requestId.current })
      onSaved(saved)
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했어요.') } finally { setBusy(false) }
  }

  const ownerText = d.owner === 'joint' ? `공동 명의 · 내 지분 ${d.share}%` : d.owner === 'me' ? `${meName} 단독` : `${partnerName} 단독`
  const loanTotal = d.loanIds.reduce((n, id) => n + (loanChoices.find(l => l.id === id)?.amount ?? 0), 0) + d.newLoans.reduce((n, l) => n + (fromMan(l.amount) ?? 0), 0)

  return <div className="pe" onKeyDown={e => { if (e.key === 'Enter' && step !== 'review' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); next() } }}>
    {step !== 'review' && <div className="pe-top">
      {(editing || index > 0) && <button className="pe-back" onClick={() => { setError(''); setStep(editing ? 'review' : STEPS[index - 1]) }} aria-label="이전"><ArrowLeft size={18}/></button>}
      {!editing && <div className="pe-progress" aria-label={`${index + 1} / ${STEPS.length - 1} 단계`}><i style={{ width: `${(index + 1) / (STEPS.length - 1) * 100}%` }}/></div>}
    </div>}

    {step === 'address' && <section>
      <h3 className="pe-q">어느 집인가요?</h3>
      {d.address && !manualAddress ? <div className="pe-picked">
        <div><strong>{d.address.building || d.address.road}</strong><span>{d.address.road}</span>{d.address.jibun && <span>지번 {d.address.jibun}</span>}</div>
        <button className="text-link" onClick={() => set('address', null)}>다시 검색</button>
      </div> : manualAddress ? null : <AddressSearch onPick={pick}/>}
      {(d.address || manualAddress) && <>
        <label className="pe-field"><span className="pe-field-label">부를 이름</span><input value={d.name} maxLength={100} placeholder="예: 우리 집, 헬리오시티" autoFocus onChange={e => set('name', e.target.value)}/></label>
        <AreaField value={d.area} onChange={v => set('area', v)}/>
      </>}
      {!d.address && <button className="text-link pe-alt" onClick={() => setManualAddress(!manualAddress)}>{manualAddress ? '주소 검색으로 돌아가기' : '주소 없이 이름만 적기'}</button>}
    </section>}

    {step === 'owner' && <section>
      <h3 className="pe-q">누구 명의인가요?</h3>
      <div className="pe-options">{([['me', `${meName} 단독`], ['partner', `${partnerName} 단독`], ['joint', '부부 공동']] as const).map(([k, label]) =>
        <button key={k} className={d.owner === k ? 'on' : ''} aria-pressed={d.owner === k} onClick={() => set('owner', k)}>{label}{d.owner === k && <Check size={16}/>}</button>)}</div>
      {d.owner === 'joint' && <div className="pe-field"><span className="pe-field-label">{meName}의 지분</span>
        <div className="pe-chips">{[50, 30, 70].map(s => <button key={s} className={d.share === s ? 'on' : ''} onClick={() => set('share', s)}>{s} : {100 - s}</button>)}
          <span className="pe-unit-input"><input inputMode="numeric" value={[50, 30, 70].includes(d.share) ? '' : String(d.share || '')} placeholder="직접" onChange={e => set('share', Number(e.target.value.replace(/\D/g, '').slice(0, 2)))}/><em>%</em></span></div>
        <small>{meName} {d.share || 0}% · {partnerName} {100 - (d.share || 0)}% — 집은 한 번만 등록하고, ‘나’ 화면에서는 지분만큼 보여요.</small></div>}
    </section>}

    {step === 'purchase' && <section>
      <h3 className="pe-q">언제, 얼마에 샀나요?</h3>
      <MoneyField label="산 가격 (매매 계약서 금액)" value={d.purchase} autoFocus onChange={v => set('purchase', v)}/>
      <YearMonth label="산 날짜 (잔금 기준)" value={d.purchaseMonth} onChange={v => set('purchaseMonth', v)}/>
      <p className="pe-note">모르면 비워 두고 넘어가도 돼요. 산 가격이 없으면 ‘얼마 올랐는지’는 표시하지 않아요.</p>
    </section>}

    {step === 'value' && <section>
      <h3 className="pe-q">지금 얼마쯤 하나요?</h3>
      {d.address?.sigungu_code && <Trades sigungu={d.address.sigungu_code} name={d.address.building || d.name} area={d.area ? Number(d.area) : null} jibun={d.address.jibun} picked={fromMan(d.value)} onPick={t => { setValueTouched(true); setD(old => ({ ...old, value: String(t.price / 10_000), asOf: t.date })) }}/>}
      <MoneyField label="지금 시세 (집 전체)" value={d.value} autoFocus={!d.address?.sigungu_code} onChange={v => { setValueTouched(true); setD(old => ({ ...old, value: v, asOf: today() })) }} hint={d.purchase ? `산 가격 ${money(fromMan(d.purchase) ?? 0)}` : undefined}/>
      <AsOf value={d.asOf} onChange={v => { setValueTouched(true); set('asOf', v) }}/>
      <p className="pe-note">시세에는 실제 거래된 값을 넣어요. 호가(집주인이 부르는 값)는 등록 뒤 ‘시세·호가’에서 따로 적어요. <a href="https://kbland.kr/" target="_blank" rel="noreferrer">KB부동산</a> · <a href="https://rt.molit.go.kr/" target="_blank" rel="noreferrer">국토부 실거래가</a></p>
    </section>}

    {step === 'tenure' && <section>
      <h3 className="pe-q">이 집은 지금 어떻게 쓰고 있나요?</h3>
      <div className="pe-options">{(Object.keys(TENURE) as Tenure[]).map(k => <button key={k} className={d.tenure === k ? 'on' : ''} aria-pressed={d.tenure === k} onClick={() => set('tenure', k)}>{TENURE[k]}{d.tenure === k && <Check size={16}/>}</button>)}</div>
      {(d.tenure === 'jeonse' || d.tenure === 'monthly') && <>
        <MoneyField label="세입자에게 돌려줄 보증금" value={d.deposit} onChange={v => set('deposit', v)}/>
        {d.tenure === 'monthly' && <MoneyField label="월세 (한 달)" value={d.rent} onChange={v => set('rent', v)}/>}
        <p className="pe-note">보증금은 나중에 돌려줄 돈이라 장부에 ‘{d.name || '이 집'} 임대보증금’ 대출 행으로 함께 저장돼요.</p>
      </>}
    </section>}

    {step === 'loans' && <section>
      <h3 className="pe-q">이 집에 걸린 대출이 있나요?</h3>
      {loanChoices.length > 0 && <div className="pe-checklist">
        <span className="pe-field-label">이미 등록한 대출에서 고르기</span>
        {loanChoices.map(l => { const on = d.loanIds.includes(l.id); return <button key={l.id} className={on ? 'on' : ''} aria-pressed={on} onClick={() => set('loanIds', on ? d.loanIds.filter(x => x !== l.id) : [...d.loanIds, l.id])}>
          <span className="pe-box">{on && <Check size={13}/>}</span><span><strong>{l.name}</strong><small>{l.as_of} 기준</small></span><b>{money(l.amount)}</b></button> })}
      </div>}
      {d.newLoans.map((l, i) => <div className="pe-newloan" key={i}>
        <label className="pe-field"><span className="pe-field-label">새 대출 이름</span><input value={l.name} placeholder="예: 주택담보대출" maxLength={100} onChange={e => set('newLoans', d.newLoans.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}/></label>
        <MoneyField label="남은 잔액" value={l.amount} onChange={v => set('newLoans', d.newLoans.map((x, j) => j === i ? { ...x, amount: v } : x))}/>
        <button className="pe-remove" aria-label="이 대출 빼기" onClick={() => set('newLoans', d.newLoans.filter((_, j) => j !== i))}><X size={16}/></button>
      </div>)}
      {d.newLoans.length < 5 && <button className="pe-add" onClick={() => set('newLoans', [...d.newLoans, { name: d.newLoans.length ? '' : '주택담보대출', amount: '' }])}><Plus size={15}/>새 대출 입력</button>}
      <p className="pe-note">{loanTotal ? `연결한 대출 합계 ${money(loanTotal)}` : '대출이 없으면 그냥 다음으로 넘어가세요.'}</p>
    </section>}

    {step === 'review' && <section>
      <h3 className="pe-q">{editing ? d.name : '이대로 저장할까요?'}</h3>
      <dl className="pe-review">
        <Row label="주소" onEdit={() => setStep('address')}>{d.address ? <>{d.address.building && <>{d.address.building}<br/></>}<small>{d.address.road}</small></> : d.name}{d.area && <small>전용 {d.area}㎡ · 보통 {toTypePy(Number(d.area))}평형</small>}</Row>
        <Row label="명의" onEdit={() => setStep('owner')}>{ownerText}</Row>
        <Row label="산 가격" onEdit={() => setStep('purchase')}>{d.purchase ? money(fromMan(d.purchase)!) : '모름'}{d.purchaseMonth && <small>{d.purchaseMonth.replace('-', '년 ')}월</small>}</Row>
        {editing ? <Row label="지금 시세" onEdit={() => setStep('value')}>{d.value ? money(fromMan(d.value)!) : '—'}<small>{d.asOf} 기준 · {valueTouched ? '직접 입력' : sourceLabel(home?.detail?.value_source)}</small></Row>
          : <div className="pe-row pe-row-static"><dt>시세</dt><dd>자동으로 넣어요<small>{d.address?.sigungu_code ? '최근 실거래가로, 거래가 없거나 실거래가 연결 전이면 산 가격으로' : '산 가격으로 넣고 ‘시세 확인 필요’로 표시해요'}</small></dd><span/></div>}
        <Row label="쓰는 방식" onEdit={() => setStep('tenure')}>{TENURE[d.tenure]}{(d.tenure === 'jeonse' || d.tenure === 'monthly') && d.deposit && <small>보증금 {money(fromMan(d.deposit)!)}{d.tenure === 'monthly' && d.rent ? ` · 월 ${money(fromMan(d.rent)!)}` : ''}</small>}</Row>
        <Row label="대출" onEdit={() => setStep('loans')}>{loanTotal ? money(loanTotal) : '없음'}{(d.loanIds.length + d.newLoans.length) > 0 && <small>{[...d.loanIds.map(id => loanChoices.find(l => l.id === id)?.name), ...d.newLoans.map(l => l.name)].filter(Boolean).join(', ')}</small>}</Row>
      </dl>
      {fromMan(d.value) && <div className="pe-equity"><span>남는 돈 (시세 − 대출 − 보증금)</span><strong>{money((fromMan(d.value) ?? 0) - loanTotal - ((d.tenure === 'jeonse' || d.tenure === 'monthly') ? fromMan(d.deposit) ?? 0 : 0))}</strong></div>}
    </section>}

    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="pe-actions">
      {step === 'review' ? <>
        {editing && onDelete && <button className="pe-delete" onClick={onDelete} disabled={busy}>이 집 삭제</button>}
        <button className="primary-button" onClick={save} disabled={busy}>{busy ? '저장하는 중…' : editing ? '저장' : '저장하기'}</button>
      </> : <button className="primary-button" onClick={next} disabled={step === 'address' && !d.address && !manualAddress}>{editing ? '확인' : step === 'loans' ? '확인하러 가기' : (step === 'purchase' && !d.purchase) ? '모르겠어요, 넘어가기' : '다음'}</button>}
    </div>
  </div>
}

function Row({ label, children, onEdit }: { label: string; children: ReactNode; onEdit: () => void }) {
  return <button className="pe-row" onClick={onEdit}><dt>{label}</dt><dd>{children}</dd><span className="pe-row-edit">수정</span></button>
}

export function DeleteHome({ home, onDone, onCancel }: { home: Home; onDone: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <div className="pe">
    <h3 className="pe-q">{home.asset.name}을 삭제할까요?</h3>
    <p className="pe-note">집과 {home.deposit ? '임대보증금 행이' : '집 정보가'} 장부에서 빠져요. 연결한 대출({home.loans.length}건)은 남겨 둘게요 — 필요 없으면 ‘우리 자산’에서 따로 지워 주세요.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="pe-actions"><button className="secondary-button" onClick={onCancel} disabled={busy}>돌아가기</button>
      <button className="danger-button" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/property/${home.asset.id}?version=${home.asset.version}`, 'DELETE'); onDone() } catch (e) { setError(e instanceof Error ? e.message : '삭제하지 못했어요.'); setBusy(false) } }}>{busy ? '삭제 중…' : '삭제하기'}</button></div>
  </div>
}


// ── 부동산 메뉴 실제 보기: 우리 집 목록 ──
const STALE_DAYS = 90
function signed(n: number) { return `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}` }
function ageDays(asOf: string) { return Math.floor((Date.now() - new Date(asOf).getTime()) / 86_400_000) }

export function MyHomes({ owner, family, hidden, onChanged, onDemo }: { owner: 'together' | 'me' | 'partner'; family: Family | null; hidden: boolean; onChanged: () => void; onDemo: () => void }) {
  const [list, setList] = useState<HomeList | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<null | { home: Home | null; start?: Step; del?: boolean; market?: boolean }>(null)
  const show = (n: number) => hidden ? '••••' : money(n)
  const load = useCallback(() => { api<HomeList>(`/property?owner=${owner}`).then(setList, e => setError(e instanceof Error ? e.message : '불러오지 못했어요.')) }, [owner])
  useEffect(load, [load])
  function done() { setOpen(null); load(); onChanged() }
  if (error) return <section className="panel"><p className="form-error">{error}</p></section>
  if (!list) return <section className="panel"><p className="pe-note">불러오는 중…</p></section>
  const t = list.total
  return <section className="panel ph">
    <div className="ph-head">
      <div><span className="ph-label">부동산 순자산{owner !== 'together' && ' · 내 지분'}</span><strong className="ph-total">{show(t.equity)}</strong>
        {list.homes.length > 0 && <span className="ph-sub">집 {show(t.value)}{t.loans > 0 && <> · 대출 −{show(t.loans)}</>}{t.deposit > 0 && <> · 보증금 −{show(t.deposit)}</>}</span>}</div>
      <button className="primary-button" onClick={() => setOpen({ home: null })}><Plus size={14}/>{list.homes.length ? '집 추가' : '우리 집 등록'}</button>
    </div>
    {!list.homes.length && <div className="ph-empty"><House size={26}/><strong>아직 등록한 집이 없어요</strong><p>주소로 찾아서 명의·산 가격·대출까지 한 번에 넣어요. 1분이면 돼요.</p></div>}
    <ul className="ph-list">{list.homes.map(h => { const m = h.metrics, dt = h.detail, stale = ageDays(h.asset.as_of) > STALE_DAYS
      return <li key={h.asset.id}>
        <button className="ph-row" onClick={() => setOpen({ home: h })}>
          <span className="ph-icon"><House size={18}/></span>
          <span className="ph-main"><strong>{h.asset.name}</strong>
            <small>{[dt?.address?.road, dt?.area_m2 ? `${dt.area_m2}㎡ · ${toTypePy(dt.area_m2)}평형` : '', h.asset.owner === 'joint' ? `공동 ${h.asset.share_percent}%` : h.asset.owner === 'me' ? (family?.me.name ?? '나') : (family?.partner?.name ?? '배우자'), dt ? TENURE[dt.tenure] : ''].filter(Boolean).join(' · ')}</small></span>
          <span className="ph-value"><strong>{show(h.value)}</strong>
            {m.gain_mine !== null && !hidden && dt?.value_source?.kind !== 'purchase' && <small className={m.gain_mine > 0 ? 'up' : m.gain_mine < 0 ? 'down' : ''}>{signed(m.gain_mine)} ({((m.gain_rate ?? 0) * 100).toFixed(1)}%)</small>}
            <small className={dt?.value_source?.kind === 'purchase' || dt?.value_source?.kind === 'none' ? 'ph-stale' : ''}>{sourceLabel(dt ? dt.value_source ?? { kind: 'manual' } : null)}</small></span>
          <ChevronRight size={16} className="ph-chev"/>
        </button>
        <div className="ph-lines">
          {m.loans_mine > 0 && <span>대출 <b>−{show(m.loans_mine)}</b>{m.ltv !== null && <em>시세의 {(m.ltv * 100).toFixed(0)}%</em>}</span>}
          {h.deposit && <span>보증금 <b>−{show(h.deposit.mine)}</b></span>}
          {(m.loans_mine > 0 || h.deposit) && <span>남는 돈 <b>{show(m.equity_mine)}</b></span>}
          {m.held_months !== null && <span>보유 {Math.floor(m.held_months / 12) ? `${Math.floor(m.held_months / 12)}년 ` : ''}{m.held_months % 12 ? `${m.held_months % 12}개월` : ''}</span>}
          <span className={stale ? 'ph-stale' : ''}>{h.asset.as_of} 시세{stale && ' · 오래됨'}</span>
          {h.asking && <span>호가 <b>{show(h.asking.low)}{h.asking.high !== h.asking.low && ` ~ ${show(h.asking.high)}`}</b><em>매물 {h.asking.count}건</em></span>}
          <button className="text-link" onClick={() => setOpen({ home: h, market: true })}>시세·호가</button>
          {!dt && <button className="text-link" onClick={() => setOpen({ home: h, start: 'address' })}>주소·산 가격 더하기</button>}
        </div>
      </li> })}</ul>
    <button className="text-link ph-demo" onClick={onDemo}>다음 집 갈아타기 예시 보기 <ChevronRight size={12}/></button>
    {open && <Modal title={open.market ? `${open.home?.asset.name} 시세·호가` : open.del ? '집 삭제' : open.home ? '집 정보' : '우리 집 등록'} onClose={() => setOpen(null)}>
      {open.market && open.home ? <HomeMarket home={open.home} onChanged={() => { load(); onChanged() }} onUpdateValue={() => setOpen({ home: open.home, start: 'value' })}/>
        : open.del && open.home ? <DeleteHome home={open.home} onDone={done} onCancel={() => setOpen({ home: open.home })}/>
        : <HomeWizard home={open.home} list={list} family={family} owner={owner} start={open.start} onSaved={done} onDelete={open.home ? () => setOpen({ home: open.home, del: true }) : undefined}/>}
    </Modal>}
  </section>
}
