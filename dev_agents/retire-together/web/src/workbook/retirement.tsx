import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ChevronRight, Landmark, PiggyBank, Wallet } from 'lucide-react'
import { api } from '../local-data'
import type { Cell } from './ReadGrid'

// '은퇴' 시트 (RETIRE-01). 위: 입력 칸(나·배우자), 아래: 연도별 월 수령액(세전·오늘 돈). 계산은 전부 서버(tools/pension.py).
// 적립금은 '자산' 시트의 노후 주머니를 그대로 쓴다 — 여기서 다시 받지 않는다.

export type PersonPlan = { retire_age: number | null; national_monthly: number; national_start_age: number | null; private_start_age: number | null; irp_annual: number; savings_annual: number; db_lump: number; db_monthly_wage: number; db_accrued: number; db_method: 'reported' | 'tenure'; db_start_date: string | null }
export type Plan = { me: PersonPlan; partner: PersonPlan; monthly_need: number | null; return_rate: number | null; inflation: number | null; version: number }
export type ServicePeriod = { years: number; months: number; days: number }
export type DbEstimate = { method: 'reported' | 'tenure'; as_of: string; tenure: ServicePeriod | null; missing: string[]; accrued_now: number | null; lump_at_retire: number | null; eligible_now?: boolean | null; timeline: { year: number; date: string; tenure: ServicePeriod | null; amount: number; eligible: boolean | null }[] }
type Db = { years_left: number; lump_at_retire: number }
export type Used = { age: number; retire_age: number; national_start_age: number; private_start_age: number; balances: Record<string, number>; db: Db | null }
export type Row = { year: number; ages: Record<string, number>; retired: boolean; items: { person: 'me' | 'partner'; layer: number; real: number; nominal: number; label: string }[]; total_real: number; extra_real?: number; extra_nominal?: number; total_nominal: number; layers_real: Record<string, number>; need_real?: number | null; gap_real?: number | null; need_nominal?: number | null; gap_nominal?: number | null; coverage: { total: number; layers: Record<string, number> } | null }
export type NationalOption = { shift: number; start_age: number; start_year: number; factor: number; monthly_real: number; gap_years: number; breakeven_age: number | null; selected: boolean }
export type SurvivorCheck = { survivor: string; deceased: string; own_monthly: number; deceased_monthly: number; tiers: Record<string, { survivor_only: number; own_plus: number; larger: 'own_plus' | 'survivor_only' }> }
export type Result = { plan: Plan; used: Partial<Record<'me' | 'partner', Used>>; missing: string[]; error: string | null; line: string; base_year: number
  as_of: string; db_estimates: Record<'me' | 'partner', DbEstimate>
  capital: Record<'me' | 'partner', { balances: Record<string, number>; db_accrued: number }>
  // 국민연금 조기·연기 선택지와 유족연금 대충 보기 (서버 계산, 추천 없음)
  national?: { options: Partial<Record<'me' | 'partner', NationalOption[]>>; survivor: Record<string, SurvivorCheck> }
  spending_target: { base_year: number; target_year: number; years: number; monthly_today: number; monthly_nominal: number; monthly_increase: number; inflation: number } | null
  assumptions: { return_rate: number; inflation: number; end_age: number; start_age_min: number; min_payout_years: number }
  projection: { rows: Row[]; summary: { retire_year: number | null; streams: { person: 'me' | 'partner'; layer: number; label: string; start_year: number; start_age: number; principal: number; payout_years: number | null; end_age_exclusive: number | null }[] } } | null }

const WHO = [['me', '나'], ['partner', '배우자']] as const
const num = (v: string) => { const n = Number(v.replace(/[^\d]/g, '')); return v.trim() === '' ? null : n }

type Opts = { rev: number; onChanged: (msg: string) => void; onError: (msg: string) => void }

// 은퇴 계획 읽기·저장 — 워크북 '은퇴' 시트와 예전 화면 '연금 · 은퇴' 카드가 같이 쓴다
export function useRetirementData({ rev, onChanged, onError }: Opts) {
  const [data, setData] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const load = useCallback(async () => {
    const id = ++requestId.current
    try { const result = await api<Result>('/retirement'); if (id === requestId.current) { setData(result); setError('') } } catch (e) { if (id !== requestId.current) return; const message = e instanceof Error ? e.message : '은퇴 계획을 불러오지 못했어요.'; setError(message); onError(message) }
  }, [onError])
  useEffect(() => { load() }, [load, rev])
  const save = useCallback(async (next: Plan) => {
    ++requestId.current // An earlier read must not replace a newly saved plan.
    try { const result = await api<Result>('/retirement/plan', 'PUT', next); setData(result); setError(''); onChanged(result.error ? '계획을 저장했어요. 계산하려면 수령 조건을 확인해 주세요.' : '은퇴 계획을 저장하고 다시 계산했어요.'); return true }
    catch (e) { const message = e instanceof Error ? e.message : '저장하지 못했어요.'; setError(message); onError(message); return false }
  }, [onChanged, onError])
  return { data, save, error, reload: load }
}

export function useRetirementRows({ rev, onChanged, onError }: Opts) {
  const { data, save, error, reload } = useRetirementData({ rev, onChanged, onError })

  const rows = useMemo<Cell[][]>(() => {
    if (!data) return []
    const p = data.plan, a = data.assumptions
    const setP = (who: 'me' | 'partner', k: keyof PersonPlan, v: string, zero: boolean) => {
      const n = num(v)
      if ((p[who][k] ?? null) === (zero ? n ?? 0 : n)) return
      save({ ...p, [who]: { ...p[who], [k]: zero ? n ?? 0 : n, ...(k === 'db_accrued' ? { db_method: 'reported' as const } : {}) } })
    }
    const setH = (k: 'monthly_need' | 'return_rate' | 'inflation', v: string) => {
      const t = v.trim(), n = k === 'monthly_need' ? num(t) : t === '' ? null : Number(t.replace('%', '')) / 100
      if (n !== null && Number.isNaN(n)) return onError('숫자로 입력해 주세요.')
      if ((p[k] ?? null) === n) return
      save({ ...p, [k]: n })
    }
    const W = 8
    const out: Cell[][] = []
    out.push([{ v: data.line, span: W, bold: true, tone: data.error ? 'up' : undefined }])
    out.push([{ span: W }])
    out.push([{ v: '입력 — 빈 칸은 기본값(회색 글씨)으로 계산해요', section: true, span: W }])
    out.push([{ v: '항목', head: true }, { v: '나', head: true }, { v: '배우자', head: true }, { v: '설명', head: true, span: W - 3 }])
    const read = (label: string, f: (u: Used) => number | null, note: string) =>
      out.push([{ v: label }, ...WHO.map(([k]) => { const u = data.used[k]; return u ? { v: f(u), fmt: 'won' as const, tone: 'muted' as const } : { v: '—', tone: 'muted' as const } }), { v: note, span: W - 3, tone: 'muted' }])
    const edit = (label: string, k: keyof PersonPlan, zero: boolean, ph: (u?: Used) => string, note: string, text = false) =>
      out.push([{ v: label }, ...WHO.map(([w, wl]) => ({ v: '', edit: { text, label: `${wl} ${label}`, value: p[w][k] == null || (zero && !p[w][k]) ? '' : String(p[w][k]), placeholder: ph(data.used[w]), onCommit: (v: string) => setP(w, k, v, zero) } })), { v: note, span: W - 3, tone: 'muted' }])
    const dbRow = (label: string, note: string) =>
      out.push([{ v: label, bold: true }, ...WHO.map(([k]) => { const d = data.used[k]?.db; return d ? { v: d.lump_at_retire, fmt: 'won' as const, bold: true } : { v: '—', tone: 'muted' as const } }), { v: note, span: W - 3, tone: 'muted' }])
    out.push([{ v: '만 나이' }, ...WHO.map(([k]) => ({ v: data.used[k]?.age ?? '—', tone: 'muted' as const })), { v: '‘다른 버전으로 보기 → 내 정보’에서 바꿔요', span: W - 3, tone: 'muted' }])
    edit('은퇴 나이', 'retire_age', false, u => u ? String(u.retire_age) : '', '비우면 내 정보의 은퇴 목표(나 기준). 배우자는 같은 해')
    edit('국민연금 월액(오늘 돈)', 'national_monthly', true, () => '0', '국민연금공단 ‘내 연금 알아보기’의 예상 월액')
    edit('국민연금 개시 나이', 'national_start_age', false, u => u ? String(u.national_start_age) : '', '비우면 출생연도 기준')
    out.push([{ v: '퇴직연금 (DB형)', section: true, span: W }])
    out.push([{ v: '현재 계산 방식' }, ...WHO.map(([who]) => ({ v: p[who].db_method === 'tenure' ? `입사일 ${p[who].db_start_date}` : '회사 확인금액', tone: 'muted' as const })), { v: '상단 퇴직연금 입력·수정하기에서 방식과 입사일을 바꿔요', span: W - 3, tone: 'muted' }])
    edit('월급 (최근 3개월 평균)', 'db_monthly_wage', true, () => '0', '세전 급여명세 3개월 총액 ÷ 3')
    edit('지금 쌓인 퇴직금', 'db_accrued', true, () => '0', '회사 조회 금액 · 수정하면 회사 확인금액 방식으로 전환')
    dbRow('→ 은퇴 때 퇴직금', '선택한 DB 계산 방식의 예상액 · 세전·오늘 돈')
    if (WHO.some(([k]) => (data.used[k]?.balances['2'] ?? 0) > 0 || p[k].irp_annual > 0)) {
      read('IRP 적립금', u => u.balances['2'] ?? 0, '‘자산’ 시트의 IRP 계좌 합계')
      edit('IRP 연 납입', 'irp_annual', true, () => '0', '은퇴 나이까지')
    }
    out.push([{ v: '개인연금', section: true, span: W }])
    read('연금저축 적립금', u => u.balances['3'] ?? 0, '‘자산’ 시트의 연금저축 계좌 합계')
    edit('연금저축 연 납입', 'savings_annual', true, () => '0', '은퇴 나이까지')
    out.push([{ v: '받는 방법 · 생활비', section: true, span: W }])
    edit('연금 받기 시작 나이', 'private_start_age', false, u => u ? String(u.private_start_age) : '', `퇴직연금·연금저축. ${a.start_age_min}세 이상, ${a.end_age}세까지 나눠 받기`)
    out.push([{ v: '은퇴 후 월 생활비(오늘 돈)' }, { v: '', span: 2, edit: { label: '은퇴 후 부부 월 생활비', value: p.monthly_need == null ? '' : String(p.monthly_need), placeholder: '비우면 비교 안 함', onCommit: v => setH('monthly_need', v) } }, { v: '부부 합계', span: W - 3, tone: 'muted' }])
    out.push([{ v: '연 수익률 · 물가' }, { v: '', edit: { text: true, label: '연 수익률(%)', value: p.return_rate == null ? '' : String(+(p.return_rate * 100).toFixed(2)), placeholder: `${a.return_rate * 100}%`, onCommit: v => setH('return_rate', v) } },
      { v: '', edit: { text: true, label: '물가상승률(%)', value: p.inflation == null ? '' : String(+(p.inflation * 100).toFixed(2)), placeholder: `${a.inflation * 100}%`, onCommit: v => setH('inflation', v) } }, { v: '수익률 · 물가 (%). 비우면 기본값', span: W - 3, tone: 'muted' }])
    out.push([{ span: W }])

    const pr = data.projection
    out.push([{ v: '연도별 월 수령액 — 세전, 오늘 돈 기준', section: true, span: W }])
    if (!pr) { out.push([{ v: data.error ?? (data.missing.length ? `먼저 입력해 주세요: ${data.missing.join(', ')}` : '계산할 값이 없어요.'), span: W, tone: 'muted' }]); return out }
    const hasNeed = data.plan.monthly_need != null
    out.push(['연도', '나이(나·배우자)', '국민연금', '퇴직연금', '개인연금', '합계', hasNeed ? '생활비 대비' : '', ''].map(v => ({ v, head: true })))
    const starts = pr.summary.streams.map(s => s.start_year)
    const from = Math.min(pr.summary.retire_year ?? Infinity, ...starts, data.base_year + 60)
    const shown = pr.rows.filter(r => r.year >= from)
    const max = Math.max(1, ...shown.map(r => r.total_real), data.plan.monthly_need ?? 0)
    for (const r of shown) {
      const ages = WHO.filter(([k]) => r.ages[k] != null).map(([k]) => r.ages[k]).join(' · ')
      const startNote = pr.summary.streams.filter(s => s.start_year === r.year).map(s => `${s.person === 'me' ? '나' : '배우자'} ${s.label} 시작`).join(', ')
      out.push([{ v: `${r.year}${r.year === pr.summary.retire_year ? ' 은퇴' : ''}`, bold: r.year === pr.summary.retire_year, tone: r.retired ? undefined : 'muted' }, { v: ages, tone: 'muted' },
        { v: r.layers_real['1'] || null, fmt: 'won' }, { v: r.layers_real['2'] || null, fmt: 'won' }, { v: r.layers_real['3'] || null, fmt: 'won' },
        { v: r.total_real, fmt: 'won', bold: true },
        hasNeed && r.gap_real != null ? { v: r.gap_real, fmt: 'signed', tone: 'auto' } : { v: '' },
        { v: startNote, tone: 'muted', bar: { pct: r.total_real / max * 100, color: 'var(--cls-long-bond)' } }])
    }
    out.push([{ span: W }])
    out.push([{ v: `가정: 연 수익률 ${(a.return_rate * 100).toFixed(1)}% · 물가 ${(a.inflation * 100).toFixed(1)}% · 사적연금은 ${a.end_age}세까지 매달 같은 금액(확정기간형) · 국민연금은 물가만큼 올라 오늘 돈으로는 같아요.`, span: W, tone: 'muted' }])
    out.push([{ v: '세금(연금소득세)·연금수령한도·ISA·현금 주머니는 아직 넣지 않았어요. 예측이 아니라 입력한 가정으로 계산한 값이에요.', span: W, tone: 'muted' }])
    return out
  }, [data, save, onError])

  // 첫 화면 팝업 (2026-11-02 사용자 "입력하라는 간단한 팝업을 떠야지"): 내 국민연금·퇴직연금이 비어 있으면 한 번 띄운다.
  // '나중에'를 누르면 7일 동안 다시 띄우지 않는다(이 브라우저에만 기억). 가져오기 메뉴에서는 언제든 연다.
  const [pensionOpen, setPensionOpen] = useState(false)
  const [asked, setAsked] = useState(false)
  useEffect(() => {
    if (!data || asked) return
    setAsked(true)
    const me = data.plan.me
    if (!data.used.me || me.national_monthly || me.db_monthly_wage || me.db_accrued) return
    let later = 0
    try { later = Number(localStorage.getItem(LATER_KEY) || 0) } catch { /* 저장소를 못 쓰면 매번 묻는다 */ }
    if (Date.now() - later > 7 * 864e5) setPensionOpen(true)
  }, [data, asked])
  const dialog = data ? <PensionDialog open={pensionOpen} data={data}
    onLater={() => { try { localStorage.setItem(LATER_KEY, String(Date.now())) } catch { /* 무시 */ } setPensionOpen(false) }}
    onSave={async next => { if (await save(next)) setPensionOpen(false) }}/> : null

  return { rows, line: data?.line ?? null, dialog, openPension: () => setPensionOpen(true), data, save, error, reload }
}

const LATER_KEY = 'retire.pensionPrompt.later'
const FIELDS = [
  ['national_monthly', '국민연금', '국민연금 예상 월액', '국민연금공단 ‘내 연금 알아보기’'],
  ['db_monthly_wage', '퇴직연금', '월급 (최근 3개월 평균)', '세전 급여명세 3개월 총액 ÷ 3'],
  ['db_accrued', '퇴직연금', '지금 쌓인 퇴직금', '회사 ‘예상 퇴직금 조회’'],
  ['savings_annual', '개인연금', '연금저축 1년 납입액', '앞으로 1년에 넣을 돈 · 적립금은 등록한 계좌에서'],
] as const
type Field = typeof FIELDS[number][0]
export type Layer = typeof FIELDS[number][1]

export function PensionDialog({ open, data, onLater, onSave, focus }: { open: boolean; data: Result; onLater: () => void; onSave: (p: Plan) => Promise<void>; focus?: Layer }) {
  const who = WHO.filter(([k]) => k === 'me' || data.used[k])
  const [vals, setVals] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setVals(Object.fromEntries(who.flatMap(([w]) => FIELDS.map(([k]) => [`${w}.${k}`, data.plan[w][k] ? String(data.plan[w][k]) : '']))))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  async function submit() {
    setBusy(true)
    const next: Plan = { ...data.plan, me: { ...data.plan.me }, partner: { ...data.plan.partner } }
    for (const [w] of who) for (const [k] of FIELDS) {
      next[w][k as Field] = Number(vals[`${w}.${k}`] || 0)
      if (k === 'db_accrued' && next[w][k] !== data.plan[w][k]) next[w].db_method = 'reported'
    }
    try { await onSave(next) } finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={o => { if (!o) onLater() }}>
    <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>국민연금·퇴직연금·개인연금을 입력해 주세요</DialogTitle>
        <DialogDescription>은퇴 후 매달 받을 돈을 계산하는 데 써요. 모르는 칸은 비워 두세요.</DialogDescription>
      </DialogHeader>
      <form className="grid gap-3" onSubmit={e => { e.preventDefault(); submit() }}>
        <div className="grid items-center gap-x-2 gap-y-3 text-sm" style={{ gridTemplateColumns: `minmax(0,1.2fr) ${who.map(() => 'minmax(0,1fr)').join(' ')}` }}>
          <span/>{who.map(([, l]) => <span key={l} className="text-center text-grey-600">{l}</span>)}
          {FIELDS.map(([k, layer, label, help], i) => [
            ...(i === 0 || FIELDS[i - 1][1] !== layer ? [<div key={`h-${layer}`} className="col-span-full -mb-1 pt-1 text-xs font-semibold text-grey-600">{layer}</div>] : []),
            <div key={k}><div className="font-medium">{label}</div><div className="text-xs text-grey-600">{help}</div></div>,
            ...who.map(([w, wl], j) => <Input key={`${w}.${k}`} aria-label={`${wl} ${label}`} inputMode="numeric" placeholder="원" className="text-right"
              autoFocus={j === 0 && !!focus && FIELDS.findIndex(f => f[1] === focus) === i}
              value={vals[`${w}.${k}`] ? Number(vals[`${w}.${k}`]).toLocaleString('ko-KR') : ''}
              onChange={e => setVals(v => ({ ...v, [`${w}.${k}`]: e.target.value.replace(/[^\d]/g, '') }))}/>),
          ])}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onLater}>나중에 할게요</Button>
          <Button type="submit" disabled={busy}>저장</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}


// 예전 화면 '연금 · 은퇴'의 층별 카드 (2026-11-02 사용자 "아이콘 같은 거 만들어서 입력하기로 들어가면 뜨면 좋겠어").
// 아이콘이나 '입력하기'를 누르면 같은 입력 팝업이 그 층 칸부터 열린다. 숫자는 서버(/api/retirement) 값만 보여 준다.
export function PensionLayers({ show, onChanged, onError, extra }: { show: (won: number) => string; onChanged: (msg: string) => void; onError: (msg: string) => void; extra: ReactNode }) {
  const { data, save } = useRetirementData({ rev: 0, onChanged, onError })
  const [focus, setFocus] = useState<Layer | null>(null)
  const who = data ? WHO.filter(([k]) => k === 'me' || data.used[k]) : []
  const per = (f: (w: 'me' | 'partner') => number) => who.map(([w, l]) => ({ l, v: f(w) })).filter(x => x.v > 0)
  const line = (xs: { l: string; v: number }[], unit = '') => xs.length ? xs.map(x => `${x.l} ${unit}${show(x.v)}`).join(' · ') : '입력 전'
  const cards: { layer: Layer; detail: string; icon: typeof Landmark; value: string }[] = data ? [
    { layer: '국민연금', detail: '예상 월액 (오늘 돈)', icon: Landmark, value: line(per(w => data.plan[w].national_monthly), '월 ') },
    { layer: '퇴직연금', detail: '은퇴 때 받을 퇴직금 (DB형)', icon: Wallet, value: line(per(w => data.used[w]?.db?.lump_at_retire ?? 0)) },
    { layer: '개인연금', detail: '연금저축 적립금 · 1년 납입', icon: PiggyBank, value: line(per(w => data.used[w]?.balances['3'] ?? 0)) + (per(w => data.plan[w].savings_annual).length ? ` · 납입 ${line(per(w => data.plan[w].savings_annual))}` : '') },
  ] : []
  return <>
    <div className="pension-layers">
      {cards.map((c, i) => <section className="panel layer-card" key={c.layer}>
        <button type="button" className={`layer-icon layer-${i}`} aria-label={`${c.layer} 입력하기`} onClick={() => setFocus(c.layer)}><c.icon size={22}/></button>
        <small>{i + 1}층</small><h3>{c.layer}</h3><p>{c.detail}</p>
        <strong className={c.value === '입력 전' ? 'is-empty' : 'is-filled'}>{c.value}</strong>
        <button type="button" className="text-link layer-input" onClick={() => setFocus(c.layer)}>입력하기 <ChevronRight size={13}/></button>
      </section>)}
      {extra}
    </div>
    {data && <PensionDialog open={focus !== null} focus={focus ?? undefined} data={data} onLater={() => setFocus(null)} onSave={async next => { if (await save(next)) setFocus(null) }}/>}
  </>
}
