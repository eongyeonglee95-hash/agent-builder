import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { api } from '../local-data'

// 리밸런싱 시트 (2026-11-02 사용자 "리밸런싱 탭이 한눈에 안 들어온다" → 아티팩트 시안 'A 고도화' 채택).
// 묶음마다 카드 하나: 한 문장 판정 + 줄이기 → 늘리기(자산군별 금액) + 접힌 종목별 주문 + 결정.
// 원칙은 카드 오른쪽 위에서 고르고, 바꾸기 전에 서버가 저장 없이 다시 계산한 비교를 보여 준다(/portfolio/preview).
// 숫자·문장은 전부 서버(backend/plan.py)가 만든다. 화면은 만원 단위 표시만 한다.

type Amount = { asset_class: string; label: string; amount: number }
type Plan = { kind: 'blocked' | 'in_range' | 'move' | 'buy' | 'buy_needs_cash'; title?: string; title_head?: string | null; title_tail?: string; title_tone?: 'up' | 'down'; line?: string; reduce: Amount[]; increase: Amount[]
  reduce_total: number; increase_total: number; sell_count: number; buy_count: number; amount_only: number; leftover: number
  targets: { asset_class: string; label: string; target_pct: number }[] }
type Order = { side: string; asset_class: string; ticker_name: string | null; qty: number | null; amount: number }
type Pool = { pool_id: string; label: string; mode: string; strategy_id: string; total_value?: number; error?: string; plan?: Plan; orders?: Order[]
  accounts: { id: string; label: string }[]; new_cash_account?: string; last_decision?: { date: string; decision: string; reason: string } | null }
type EmptyPool = { pool_id: string; label: string; mode: string; strategy_id: string }
type Card = { id: string; short: string; ready: boolean; classes: { asset_class: string; label: string; target_pct: number }[] }
type Preview = { name: string; strategy_id: string; current: Plan | null; proposed: Plan; notes: string[] }
type Option = { strategy_id: string; name: string; ready: boolean; reason?: string; plan?: Plan; notes?: string[] }

const COLOR: Record<string, string> = { stock: 'var(--cls-stock)', long_bond: 'var(--cls-long-bond)', mid_bond: 'var(--cls-mid-bond)', gold: 'var(--cls-gold)', commodity: 'var(--cls-commodity)', cash: 'var(--cls-cash)' }
const man = (n: number) => `${Math.round(n / 10_000).toLocaleString('ko-KR')}만원`
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
const short = (label: string) => label.split(' — ')[0]
// 한국어 조사: 받침 있으면 앞 것. 로/으로는 ㄹ 받침이면 '로'
const jong = (w: string) => { const c = w.trim().slice(-1).charCodeAt(0) - 0xac00; return c >= 0 && c <= 11171 ? c % 28 : 0 }
const ro = (w: string) => w + (jong(w) && jong(w) !== 8 ? '으로' : '로')
const eul = (w: string) => w + (jong(w) ? '을' : '를')
const eun = (w: string) => w + (jong(w) ? '은' : '는')
const ALL_CLASSES: [string, string][] = [['stock', '주식'], ['long_bond', '장기채'], ['mid_bond', '중기채'], ['gold', '금'], ['commodity', '원자재'], ['cash', '현금·달러']]

export function RebalancePlan({ owner, live, rev, onChanged, onError, onRegister, embedded }: {
  owner: string; live: boolean; rev: number; onChanged: (msg: string) => void; onError: (msg: string) => void; onRegister: () => void
  embedded?: boolean   // 예전 카드형 화면 안에 넣을 때: 바깥 배경·여백·폭 제한 없이 그 화면 폭을 그대로 쓴다
}) {
  const [pools, setPools] = useState<Pool[] | null>(null)
  const [empty, setEmpty] = useState<EmptyPool[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [cash, setCash] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)

  const input = useMemo(() => ({ owner, live, cash: Object.fromEntries(Object.entries(cash).filter(([, v]) => v > 0).map(([k, v]) => [k, { amount: v }])) }), [owner, live, cash])
  const load = useCallback(async () => {
    try {
      const [rb, pf] = await Promise.all([
        api<{ pools: Pool[]; empty_pools?: EmptyPool[] }>('/workbook/rebalance', 'POST', input),
        api<{ strategies: Card[] }>('/workbook/portfolios'),
      ])
      setPools(rb.pools); setEmpty(rb.empty_pools ?? []); setCards(pf.strategies)
    } catch (e) { onError(e instanceof Error ? e.message : '리밸런싱을 계산하지 못했어요.') }
  }, [input, onError])
  useEffect(() => { load() }, [load, rev])

  const run = useCallback(async (fn: () => Promise<string>) => {
    setBusy(true)
    try { onChanged(await fn()); await load() } catch (e) { onError(e instanceof Error ? e.message : '저장하지 못했어요.') } finally { setBusy(false) }
  }, [onChanged, onError, load])

  if (!pools) return <div className="p-6 text-sm text-grey-600">계산하는 중…</div>
  const moveNow = pools.filter(p => p.plan?.kind === 'move').length
  const viaCash = pools.filter(p => p.plan?.kind === 'buy_needs_cash' || p.plan?.kind === 'buy').length
  const total = pools.length + empty.length
  // [이어질 때, 끝날 때] — 마지막 절만 '-요'로 끝낸다
  const clauses = ([[moveNow, '지금 옮기고', '지금 옮겨요'], [viaCash, '납입 때 맞추고', '납입 때 맞춰요'], [empty.length, '잔고가 필요하고', '잔고가 필요해요']] as const)
    .filter(([n]) => n > 0).map(([n, mid, end], i, all) => `${n}개는 ${i === all.length - 1 ? end : mid}`)
  const headline = clauses.join(', ')

  // 2026-11-02 사용자 "빈 곳이 너무 많다, 더 넓게" → 폭 제한을 넓히고(1600px) 카드 안 여백·간격을 줄였다
  return <div className={embedded ? '' : 'min-h-0 flex-1 overflow-y-auto bg-grey-100'}>
    <div className={cn('flex w-full flex-col gap-3', !embedded && 'mx-auto max-w-[1600px] px-4 py-4 sm:px-6')}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold">이번 달 리밸런싱</h2>
          <p className="text-lg text-grey-700">{!total ? '리밸런싱할 묶음이 없어요. 연금 계좌와 잔고를 먼저 등록하세요.' : headline ? <>{total}개 중 {headline}.</> : '모든 묶음이 목표 범위 안이에요.'}</p>
        </div>
        <p className="text-sm text-grey-600">{live ? '현재가 반영' : '등록한 잔고·가격 기준'} · 주문은 증권사 앱에서</p>
      </div>

      {pools.map(p => <PoolCard key={p.pool_id} pool={p} cards={cards} input={input} busy={busy} rev={rev} cash={cash[p.pool_id] ?? 0}
        onCash={v => setCash(c => ({ ...c, [p.pool_id]: v }))} run={run} onError={onError} onCustom={() => setCustomOpen(true)}/>)}

      {empty.map(p => <section key={p.pool_id} className="flex flex-wrap items-center gap-4 rounded-xl border border-grey-200 bg-white px-5 py-3">
        <div className="flex min-w-40 flex-col"><b className="text-lg font-bold">{short(p.label)}</b><span className="text-sm text-grey-600">잔고 없음 · {p.mode === 'buy_only' ? '사기만' : '사고팔기'}</span></div>
        <p className="flex-1 text-lg text-grey-700">잔고를 등록하면 비교할 수 있어요.</p>
        <Button variant="outline" onClick={onRegister}>잔고 등록</Button>
        <PrincipleSelect pool={p} cards={cards} disabled={busy} onPick={id => run(async () => { await api('/workbook/portfolio/follow', 'POST', { pool_id: p.pool_id, strategy_id: id }); return `${eun(short(p.label))} 이제 ${eul(cards.find(c => c.id === id)?.short ?? id)} 따라가요.` })} onCustom={() => setCustomOpen(true)}/>
      </section>)}

      <p className="text-sm text-grey-600">여기서는 기록만 남기고 자동 주문은 하지 않아요. 종목코드는 예시이며 추천이 아닙니다.</p>
    </div>
    <CustomDialog open={customOpen} onOpenChange={setCustomOpen} card={cards.find(c => c.id === 'custom')} run={run}/>
  </div>
}

function PrincipleSelect({ pool, cards, disabled, onPick, onCustom, shown }: { pool: { strategy_id: string; label: string }; cards: Card[]; disabled: boolean; onPick: (id: string) => void; onCustom: () => void; shown?: string }) {
  // shown: 비교 중인 원칙(아직 저장 전). '따르는 중'은 늘 실제로 따르는 원칙에만 붙인다
  const value = shown ?? pool.strategy_id
  return <Select value={value} disabled={disabled} onValueChange={v => v === '__custom' ? onCustom() : v !== value && onPick(v)}>
    <SelectTrigger className="h-10 min-w-36 gap-2 text-base" aria-label={`${short(pool.label)} 따르는 원칙`}>
      <span className="text-sm text-grey-600">원칙</span><SelectValue>{<b className="font-semibold">{cards.find(c => c.id === value)?.short ?? value}</b>}</SelectValue>{shown && <span className="text-sm text-grey-600">비교 중</span>}
    </SelectTrigger>
    <SelectContent align="end">
      {cards.map(c => <SelectItem key={c.id} value={c.id} disabled={!c.ready && c.id !== pool.strategy_id}>
        <span className="flex w-full items-center justify-between gap-6"><span className="font-semibold">{c.short}</span>
          <span className="text-sm text-grey-600">{c.id === pool.strategy_id ? '따르는 중' : c.ready ? c.classes.filter(x => x.target_pct).map(x => x.target_pct).join('/') : '비율 미정'}</span></span>
      </SelectItem>)}
      <SelectItem value="__custom"><span className="text-sm text-grey-700">직접 설정 비율 넣기…</span></SelectItem>
    </SelectContent>
  </Select>
}

// 줄이기·늘리기를 한 줄씩: 자산군 칸을 이어 붙인 가로 막대(폭 = 금액, 두 막대는 같은 축) + 그 아래 금액 한 줄
function FlowBars({ plan }: { plan: Plan }) {
  const max = Math.max(plan.reduce_total, plan.increase_total, 1)
  const row = (title: string, tone: string, total: number, rows: Amount[]) => <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3">
    <span className={cn('pt-0.5 text-sm font-semibold', tone)}>{title}<br/><span className="text-base tabular-nums">{man(total)}</span></span>
    <span className="flex flex-col gap-1">
      <span className="flex h-6 gap-0.5" style={{ width: `${Math.max(8, total / max * 100)}%` }} role="img" aria-label={`${title} ${rows.map(r => `${r.label} ${man(r.amount)}`).join(', ')}`}>
        {rows.map(r => <span key={r.asset_class} title={`${r.label} ${man(r.amount)}`} className="rounded-sm" style={{ width: `${r.amount / total * 100}%`, minWidth: 4, background: COLOR[r.asset_class] ?? 'var(--grey-400)' }}/>)}
      </span>
      <span className="flex flex-wrap gap-x-3 text-sm text-grey-700">{rows.map(r => <span key={r.asset_class} className="flex items-center gap-1">
        <i aria-hidden="true" className="inline-block size-2 rounded-full" style={{ background: COLOR[r.asset_class] ?? 'var(--grey-400)' }}/>{r.label} <b className="font-semibold tabular-nums">{man(r.amount)}</b></span>)}</span>
    </span>
  </div>
  if (!plan.reduce.length && !plan.increase.length) return null
  return <div className="flex flex-col gap-2.5">
    {plan.reduce.length > 0 && row('줄이기', 'text-down', plan.reduce_total, plan.reduce)}
    {plan.increase.length > 0 && row('늘리기', 'text-up', plan.increase_total, plan.increase)}
  </div>
}

function TargetBar({ targets }: { targets: Plan['targets'] }) {
  return <span className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={targets.map(t => `${t.label} ${t.target_pct}%`).join(', ')}>
    {targets.map(t => <span key={t.asset_class} style={{ width: `${t.target_pct}%`, background: COLOR[t.asset_class] ?? 'var(--grey-400)' }}/>)}
  </span>
}

function PoolCard({ pool, cards, input, busy, rev, cash, onCash, run, onError, onCustom }: {
  pool: Pool; cards: Card[]; input: { owner: string; live: boolean }; busy: boolean; rev: number; cash: number; onCash: (v: number) => void
  run: (fn: () => Promise<string>) => Promise<void>; onError: (m: string) => void; onCustom: () => void
}) {
  const [showOrders, setShowOrders] = useState(false)
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const plan = pool.plan
  const name = short(pool.label)
  const trades = (pool.orders ?? []).filter(o => o.side !== '생략')

  const pick = async (strategy_id: string) => {
    if (strategy_id === pool.strategy_id) { setPreview(null); return }   // 지금 원칙을 다시 고르면 비교를 닫는다
    setPreviewing(true)
    try { setPreview(await api<Preview>('/workbook/portfolio/preview', 'POST', { pool_id: pool.pool_id, strategy_id, owner: input.owner, live: input.live, cash })) }
    catch (e) { onError(e instanceof Error ? e.message : '비교하지 못했어요.') } finally { setPreviewing(false) }
  }
  const currentShort = cards.find(c => c.id === pool.strategy_id)?.short ?? pool.strategy_id

  return <section className="overflow-hidden rounded-xl border border-grey-200 bg-white">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-grey-100 px-5 py-3">
      <div className="flex flex-1 flex-col"><b className="text-lg font-bold">{name}</b>
        <span className="text-sm text-grey-600">{pool.total_value != null ? won(pool.total_value) : ''} · {pool.mode === 'buy_only' ? '사기만' : '사고팔기'}</span></div>
      {plan && !pool.error
        ? <PrincipleButtons pool={pool} plan={plan} cards={cards} input={input} cash={cash} rev={rev} shown={preview?.strategy_id} disabled={busy || previewing} onPick={pick} onCustom={onCustom}/>
        : <PrincipleSelect pool={pool} shown={preview?.strategy_id} cards={cards} disabled={busy || previewing} onPick={pick} onCustom={onCustom}/>}
    </div>

    {preview ? <div className="flex flex-col gap-3 px-5 py-4">
      <p className="text-2xl font-bold">{ro(preview.name)} 바꾸면, 이번 달 할 일이 이렇게 달라져요.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {([['지금', currentShort, preview.current, false], ['바꾸면', preview.name, preview.proposed, true]] as const).map(([tag, label, p, strong]) => p && <div key={tag} className={cn('flex flex-col gap-3 rounded-lg p-5', strong ? 'border-2 border-grey-900' : 'border border-grey-200')}>
          <span className="text-sm text-grey-600">{tag} · {label}</span>
          <TargetBar targets={p.targets}/>
          <p className="text-lg">{p.kind === 'move' ? <><b className="font-bold">{man(p.reduce_total)}</b>을 옮겨요.</> : <b className="font-bold">{p.title}</b>}</p>
          <p className="text-base text-grey-700">{p.kind === 'move'
            ? <>{p.reduce.map(r => `${r.label} ${man(r.amount)}`).join(' · ')} 팔기<br/>→ {p.increase.map(r => `${r.label} ${man(r.amount)}`).join(' · ')} 사기{p.leftover ? ` · ${man(p.leftover)}은 현금으로 남아요` : ''}</>
            : p.line}</p>
        </div>)}
      </div>
      {preview.notes.length > 0 && <div className="flex flex-col gap-1 rounded-lg bg-grey-50 px-4 py-3 text-base">
        <b className="font-semibold">꼭 알아둘 것</b>{preview.notes.map(n => <span key={n}>{n}</span>)}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" disabled={busy} onClick={() => run(async () => { await api('/workbook/portfolio/follow', 'POST', { pool_id: pool.pool_id, strategy_id: preview.strategy_id }); setPreview(null); return `${eun(name)} 이제 ${eul(preview.name)} 따라가요.` })}>{ro(preview.name)} 바꾸기</Button>
        <Button size="lg" variant="outline" onClick={() => setPreview(null)}>{currentShort} 그대로</Button>
        <span className="text-sm text-grey-600">바꾸면 결정 기록에 남아요.</span>
      </div>
    </div>

    : pool.error || !plan ? <p className="px-5 py-4 text-base text-grey-700">{pool.error ?? '계산하지 못했어요.'}</p>

    : <div className="flex flex-col gap-4 px-5 py-4">
      <div className="flex min-w-0 flex-col gap-3">
      {/* 2026-11-02 사용자 "화면이 너무 길다" → 문장(왼쪽)과 줄이기·늘리기 막대(오른쪽)를 한 줄에 */}
      <div className={cn('grid items-center gap-x-8 gap-y-3', (plan.reduce.length || plan.increase.length) && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}>
        <p className="text-xl font-bold leading-snug">
          {plan.title_head ? <>{plan.title_head} <span className={plan.title_tone === 'up' ? 'text-up' : 'text-down'}>{plan.title_tail}</span></> : plan.title}
          {plan.line && <><br/><span className={plan.kind === 'blocked' ? 'text-base font-normal text-grey-700' : 'text-lg'}>{plan.line}</span></>}
          {plan.leftover > 0 && <><br/><span className="text-sm font-normal text-grey-600">판 돈 중 {man(plan.leftover)}은 현금으로 남아요.</span></>}
        </p>
        <FlowBars plan={plan}/>
      </div>

      {(plan.kind === 'buy_needs_cash' || (pool.mode === 'buy_only' && cash > 0)) && <label className="flex flex-wrap items-center gap-2 text-base text-grey-700">이번 달 넣을 돈
        <input inputMode="numeric" defaultValue={cash ? cash.toLocaleString('ko-KR') : ''} placeholder="예: 3,000,000" aria-label={`${name} 이번 달 납입`}
          onBlur={e => onCash(Number(e.target.value.replace(/[^\d]/g, '')) || 0)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="h-11 w-44 rounded-md border border-grey-300 px-3 text-right text-base tabular-nums"/>원
        <span className="text-sm text-grey-600">넣으면 살 종목을 다시 계산해요.</span></label>}

      {trades.length > 0 && <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 border-t border-grey-200 pt-3">
          <Button variant="outline" onClick={() => setShowOrders(s => !s)} aria-expanded={showOrders}>
            종목별 주문 보기 <span className="text-sm text-grey-600">팔기 {plan.sell_count} · 사기 {plan.buy_count}</span>{showOrders ? <ChevronUp className="size-4"/> : <ChevronDown className="size-4"/>}</Button>
          {plan.amount_only > 0 && <span className="text-sm text-grey-600">{plan.amount_only}종목은 확인 전이라 금액만</span>}
          <span className="hidden flex-1 lg:block"/>
          <Button disabled={busy} onClick={() => run(async () => { await api('/workbook/decision', 'POST', { ...input, cash: cash ? { [pool.pool_id]: { amount: cash } } : {}, pool_id: pool.pool_id, action: 'accept', reason }); setReason(''); return '기록했어요. 증권사 앱에서 주문하세요.' })}>직접 주문할게요</Button>
          <Button variant="outline" disabled={busy} onClick={() => run(async () => { await api('/workbook/decision', 'POST', { ...input, cash: cash ? { [pool.pool_id]: { amount: cash } } : {}, pool_id: pool.pool_id, action: 'hold', reason }); setReason(''); return '이번엔 넘긴다고 기록했어요.' })}>이번엔 넘기기</Button>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="사유 (선택)" aria-label={`${name} 결정 사유`} className="h-9 w-full min-w-40 rounded-md lg:w-56 border border-grey-300 px-3 text-base"/>
        </div>
        {showOrders && <ul className="flex flex-col border-t border-grey-200">
          {trades.map((o, i) => <li key={i} className="grid grid-cols-[40px_minmax(0,1fr)_72px_120px] items-center gap-2 border-b border-grey-100 py-2.5">
            <b className={cn('text-sm font-semibold', o.side === '매도' ? 'text-down' : 'text-up')}>{o.side === '매도' ? '팔기' : '사기'}</b>
            <span className={cn('truncate text-base', !o.qty && 'text-grey-600')}>{o.ticker_name ?? '종목 지정 필요'}</span>
            <span className="text-right text-sm text-grey-700 tabular-nums">{o.qty ? `${o.qty.toLocaleString('ko-KR')}주` : '금액만'}</span>
            <span className="text-right text-base tabular-nums">{won(o.amount)}</span>
          </li>)}
        </ul>}
      </div>}
      {pool.last_decision && <p className="text-sm text-grey-600">지난 기록 {pool.last_decision.date}: {pool.last_decision.decision.replace(name, '').trim()}{pool.last_decision.reason ? ` — ${pool.last_decision.reason}` : ''}</p>}
      </div>
    </div>}
  </section>
}

// 원칙 버튼 (2026-11-02 사용자 "늘리는 것보다 버튼을 고도화") — 원칙마다 버튼 하나에 '그 원칙이면 이번 달 할 일'을 한 줄로.
// 따르는 원칙은 진하게, 다른 버튼을 누르면 카드 안에 비교(저장 전). 숫자는 서버가 같은 잔고로 계산한 값(/portfolio/alternatives), 순위·추천 없음.
const ORDER = ['all_weather', 'k_all_weather', 'park_gomhee', 'custom']
// 원칙 비중을 버튼 오른쪽 작은 도넛으로 (2026-11-02 사용자 "오른쪽에 아주 작은 비중으로 도식화해서 어떤 앤지"). 비율 없으면 빈 점선 원
function MiniDonut({ classes, label }: { classes: Card['classes']; label: string }) {
  const parts = classes.filter(c => c.target_pct > 0)
  if (!parts.length) return <span aria-hidden="true" className="size-8 shrink-0 rounded-full border border-dashed border-grey-300"/>
  let at = 0
  const stops = parts.map(c => { const from = at; at += c.target_pct; return `${COLOR[c.asset_class] ?? 'var(--grey-400)'} ${from}% ${at}%` }).join(', ')
  return <span role="img" aria-label={`${label} 비중: ${parts.map(c => `${c.label} ${c.target_pct}%`).join(', ')}`}
    title={parts.map(c => `${c.label} ${c.target_pct}%`).join(' · ')}
    className="size-8 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops})`, mask: 'radial-gradient(circle, transparent 42%, #000 43%)', WebkitMask: 'radial-gradient(circle, transparent 42%, #000 43%)' }}/>
}
function summary(p: Plan): string {
  return p.kind === 'move' ? `옮길 돈 ${man(p.reduce_total)}` : p.kind === 'buy' ? `살 돈 ${man(p.increase_total)}`
    : p.kind === 'buy_needs_cash' ? '납입 때 맞추기' : p.kind === 'in_range' ? '할 일 없음' : '주문표 보류'
}
function PrincipleButtons({ pool, plan, cards, input, cash, rev, shown, disabled, onPick, onCustom }: {
  pool: Pool; plan: Plan; cards: Card[]; input: { owner: string; live: boolean }; cash: number; rev: number; shown?: string
  disabled: boolean; onPick: (id: string) => void; onCustom: () => void
}) {
  const [options, setOptions] = useState<Option[] | null>(null)
  useEffect(() => {
    let alive = true
    setOptions(null)
    api<{ options: Option[] }>('/workbook/portfolio/alternatives', 'POST', { pool_id: pool.pool_id, owner: input.owner, live: input.live, cash })
      .then(d => { if (alive) setOptions(d.options) }).catch(() => { if (alive) setOptions([]) })
    return () => { alive = false }
  }, [pool.pool_id, pool.strategy_id, input.owner, input.live, cash, rev])
  const name = (id: string) => cards.find(c => c.id === id)?.short ?? id
  const items = ORDER.filter(id => cards.some(c => c.id === id)).map(id => {
    if (id === pool.strategy_id) return { id, state: 'current' as const, sub: summary(plan) }
    const o = options?.find(x => x.strategy_id === id)
    if (!o) return { id, state: 'loading' as const, sub: '계산 중…' }
    if (!o.ready || !o.plan) return { id, state: id === 'custom' ? 'custom' as const : 'off' as const, sub: id === 'custom' ? '비율 넣기' : '비율 미정' }
    return { id, state: 'other' as const, sub: summary(o.plan) }
  })
  return <div role="group" aria-label={`${short(pool.label)} 따를 원칙`} className="grid w-full grid-cols-2 gap-1.5 sm:w-auto sm:grid-cols-4">
    {items.map(it => {
      const comparing = shown === it.id
      return <button key={it.id} type="button" aria-pressed={it.state === 'current'}
        disabled={disabled || it.state === 'off' || it.state === 'loading'}
        onClick={() => it.state === 'custom' ? onCustom() : it.state === 'current' ? onPick(pool.strategy_id) : onPick(it.id)}
        title={it.state === 'current' ? '지금 따르는 원칙' : it.state === 'other' ? '누르면 바꿨을 때를 비교해요 (저장 전)' : undefined}
        className={cn('flex min-h-12 min-w-36 items-center gap-2.5 rounded-lg border py-1.5 pl-3 pr-2 text-left transition-colors disabled:cursor-not-allowed',
          it.state === 'current' ? 'border-grey-900 bg-grey-900 text-white'
            : comparing ? 'border-grey-900 bg-white ring-1 ring-grey-900'
            : it.state === 'off' ? 'border-dashed border-grey-300 bg-white text-grey-500'
            : 'border-grey-300 bg-white hover:border-grey-500 hover:bg-grey-50')}>
        <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex w-full items-center justify-between gap-2 text-base font-semibold">{name(it.id)}
          {it.state === 'current' && <span className="text-xs font-normal text-grey-300">따르는 중</span>}
          {comparing && <span className="text-xs font-normal text-grey-600">비교 중</span>}</span>
        <span className={cn('text-sm tabular-nums', it.state === 'current' ? 'text-grey-200' : 'text-grey-600')}>{it.sub}</span>
        </span>
        <MiniDonut classes={cards.find(c => c.id === it.id)?.classes ?? []} label={name(it.id)}/>
      </button>
    })}
  </div>
}

function CustomDialog({ open, onOpenChange, card, run }: { open: boolean; onOpenChange: (o: boolean) => void; card?: Card; run: (fn: () => Promise<string>) => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  useEffect(() => { if (open) setDraft(Object.fromEntries((card?.classes ?? []).filter(c => c.target_pct).map(c => [c.asset_class, String(c.target_pct)]))) }, [open, card])
  const sum = Object.values(draft).reduce((a, v) => a + (Number(v) || 0), 0)
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>직접 설정 비율</DialogTitle></DialogHeader>
      <div className="flex flex-col gap-2">
        {ALL_CLASSES.map(([k, l]) => <label key={k} className="flex items-center justify-between gap-3 text-base">{l}
          <span className="flex items-center gap-1"><input inputMode="numeric" value={draft[k] ?? ''} placeholder="0" aria-label={`${l} 비율(%)`}
            onChange={e => setDraft(d => ({ ...d, [k]: e.target.value.replace(/[^\d]/g, '') }))} className="h-10 w-20 rounded-md border border-grey-300 px-2 text-right tabular-nums"/>%</span></label>)}
        <p className={cn('text-base font-semibold', sum === 100 ? 'text-grey-900' : 'text-up')}>합계 {sum}%{sum !== 100 && ' — 100%로 맞춰 주세요'}</p>
        <Button size="lg" disabled={sum !== 100} onClick={() => run(async () => {
          await api('/workbook/portfolio/custom', 'POST', { targets: Object.fromEntries(Object.entries(draft).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])) })
          onOpenChange(false); return '직접 설정 비율을 저장했어요. 카드의 원칙 칸에서 고를 수 있어요.' })}>저장</Button>
      </div>
    </DialogContent>
  </Dialog>
}
