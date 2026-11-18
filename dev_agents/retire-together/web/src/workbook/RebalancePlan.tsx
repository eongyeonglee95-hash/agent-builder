import type React from 'react'
import { TradeJournal } from './TradeJournal'
import { ReviewSettings, ReviewReport, usePensionReview } from './PensionReview'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { api } from '../local-data'
import { manwon as man, won, pct as formatPct } from '@/lib/format'

// 리밸런싱 시트 (2026-11-02 사용자 "리밸런싱 탭이 한눈에 안 들어온다" → 아티팩트 시안 'A 고도화' 채택).
// 묶음마다 카드 하나: 한 문장 판정 + 줄이기 → 늘리기(자산군별 금액) + 접힌 종목별 주문 + 결정.
// 2026-11-17 사용자 "계좌별로 한 줄, 앞쪽에서 계좌가 구분되게" → 시안 2(줄 배경색)+3(왼쪽 색 패널) 합침.
// 왼쪽 계좌색 패널(이름·잔고·원칙 고르기) + 오른쪽 같은 색 옅은 배경(문장·줄이기/늘리기·결정). 원칙 4칸 버튼은 고르기 하나로.
// 원칙을 고르면 바꾸기 전에 서버가 저장 없이 다시 계산한 비교를 보여 준다(/portfolio/preview).
// 숫자·문장은 전부 서버(backend/plan.py)가 만든다. 화면은 만원 단위 표시만 한다.

type Amount = { asset_class: string; label: string; amount: number }
type Plan = { kind: 'blocked' | 'in_range' | 'move' | 'buy' | 'buy_needs_cash'; title?: string; title_head?: string | null; title_tail?: string; title_tone?: 'up' | 'down'; line?: string; reduce: Amount[]; increase: Amount[]
  reduce_total: number; increase_total: number; sell_count: number; buy_count: number; amount_only: number; leftover: number
  targets: { asset_class: string; label: string; target_pct: number }[]
  mix?: { asset_class: string; label: string; current_pct: number; target_pct: number; sell: number; buy: number }[] }
type Order = { account_id?: string; ticker?: string | null; side: string; asset_class: string; ticker_name: string | null; qty: number | null; amount: number }
type Pool = { pool_id: string; label: string; mode: string; strategy_id: string; total_value?: number; error?: string; plan?: Plan; orders?: Order[]
  accounts: { id: string; label: string }[]; new_cash_account?: string; last_decision?: { date: string; decision: string; reason: string } | null }
type EmptyPool = { pool_id: string; label: string; mode: string; strategy_id: string }
type Card = { id: string; short: string; ready: boolean; classes: { asset_class: string; label: string; target_pct: number }[] }
type Preview = { name: string; strategy_id: string; current: Plan | null; proposed: Plan; notes: string[] }

const COLOR: Record<string, string> = { stock: 'var(--cls-stock)', long_bond: 'var(--cls-long-bond)', mid_bond: 'var(--cls-mid-bond)', gold: 'var(--cls-gold)', commodity: 'var(--cls-commodity)', cash: 'var(--cls-cash)' }
const short = (label: string) => label.split(' — ')[0]
// 한국어 조사: 받침 있으면 앞 것. 로/으로는 ㄹ 받침이면 '로'
const jong = (w: string) => { const c = w.trim().slice(-1).charCodeAt(0) - 0xac00; return c >= 0 && c <= 11171 ? c % 28 : 0 }
const ro = (w: string) => w + (jong(w) && jong(w) !== 8 ? '으로' : '로')
const eul = (w: string) => w + (jong(w) ? '을' : '를')
const eun = (w: string) => w + (jong(w) ? '은' : '는')
// 계좌 순서대로 theme.css --acct-1..4 를 돌려 쓴다
const acct = (i: number) => ({ '--a': `var(--acct-${i % 4 + 1})`, '--a-tint': `var(--acct-${i % 4 + 1}-tint)` }) as React.CSSProperties
// 계좌 한 줄: 왼쪽 낮은 대비의 설정 패널 + 오른쪽 목표 배분과 실행 정보. 오른쪽 맨 윗줄은 따르는 자산배분(원칙 이름 크게 + 목표 비중 + 운용 방식)
// (2026-11-18 사용자 "설정한 올웨더 같은 자산배분 방법을 젤 윗줄에 눈에 띄게"). 운용 방식과 원칙 선택은 왼쪽 계좌 패널에 항상 표시한다. 잔고 없는 계좌는 얇은 줄(compact)
function AccountLine({ index, name, balance, rule, editor, children, compact }: {
  index: number; name: string; balance?: string; rule: { name: string; classes: Card['classes'] }; mode: string; editor: React.ReactNode; children: React.ReactNode; compact?: boolean
}) {
  const parts = rule.classes.filter(c => c.target_pct > 0)
  return <section aria-label={name} style={acct(index)} className="grid overflow-hidden rounded-2xl bg-[var(--a-tint)] md:grid-cols-[168px_minmax(0,1fr)]">
    <div className={cn('flex flex-col gap-1 border-b border-black/10 bg-white/40 px-4 text-grey-900 md:border-b-0 md:border-r', compact ? 'justify-center py-2' : 'py-3')}>
      <b className={cn('font-semibold', compact ? 'text-base' : 'text-sm text-[var(--a)]')}>{name}</b>
      {balance ? <span className="text-2xl font-bold tabular-nums tracking-tight">{balance}</span> : <span className="text-sm text-grey-600">잔고 없음</span>}
      <div className="mt-2 flex min-w-0 flex-col gap-2 text-grey-900 [&>div]:w-full">{editor}</div>
    </div>
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-black/10 px-4 py-3">
        <b className="shrink-0 text-lg font-bold">{rule.name}</b>
        {parts.length > 0 && <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto"><StrategyAllocation name={rule.name} targets={parts}/></div>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  </section>
}
// 운용 방식 고르기 (2026-11-18 사용자 "사고팔기/사기만도 옵션으로") — 누르면 바로 저장·결정 기록, 다시 계산
function ModeToggle({ pool, disabled, run }: { pool: { pool_id: string; label: string; mode: string }; disabled: boolean; run: (fn: () => Promise<string>) => Promise<void> }) {
  const name = short(pool.label)
  return <div role="group" aria-label={`${name} 운용 방식`} className="grid w-48 grid-cols-2 gap-1 border-b border-grey-300">
    {([['rebalance', '사고팔기'], ['buy_only', '사기만']] as const).map(([m, l]) => {
      const on = (pool.mode === 'buy_only' ? 'buy_only' : 'rebalance') === m
      return <button key={m} type="button" aria-pressed={on} disabled={disabled}
        title={m === 'rebalance' ? '팔고 사서 목표 비율에 맞춰요' : '팔지 않고 넣는 돈으로 모자란 것만 사요'}
        onClick={() => !on && run(async () => { await api('/workbook/portfolio/mode', 'POST', { pool_id: pool.pool_id, mode: m }); return `${eun(name)} 이제 ${l}로 운용해요.` })}
        className={cn('min-h-9 border-b-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50', on ? 'border-grey-800 font-semibold text-grey-900' : 'border-transparent text-grey-600 hover:text-grey-900')}>{l}</button>
    })}
  </div>
}
const ALL_CLASSES: [string, string][] = [['stock', '주식'], ['long_bond', '장기채'], ['mid_bond', '중기채'], ['gold', '금'], ['commodity', '원자재'], ['cash', '현금·달러']]

export function RebalancePlan({ owner, live, rev, onChanged, onError, onRegister, embedded }: {
  owner: string; live: boolean; rev: number; onChanged: (msg: string) => void; onError: (msg: string) => void; onRegister: () => void
  embedded?: boolean   // 예전 카드형 화면 안에 넣을 때: 바깥 배경·여백·폭 제한 없이 그 화면 폭을 그대로 쓴다
}) {
  const review = usePensionReview()
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
  // 카드가 같은 말을 다시 하니 요약은 개수만 (잔고 없는 계좌는 얇은 줄이 스스로 말한다)
  const headline = ([[moveNow, '조정 필요'], [viaCash, '납입 대기']] as const).filter(([n]) => n > 0).map(([n, l]) => `${l} ${n}개`).join(' · ')
  const ruleOf = (id: string) => ({ name: cards.find(c => c.id === id)?.short ?? id, classes: cards.find(c => c.id === id)?.classes ?? [] })

  // 2026-11-02 사용자 "빈 곳이 너무 많다, 더 넓게" → 폭 제한을 넓히고(1600px) 카드 안 여백·간격을 줄였다
  return <div className={embedded ? '' : 'min-h-0 flex-1 overflow-y-auto bg-grey-100'}>
    <div className={cn('flex w-full flex-col gap-3', !embedded && 'mx-auto max-w-[1600px] px-4 py-4 sm:px-6')}>
      <ReviewSettings review={review} summary={!total ? '연금 계좌와 잔고를 등록해 주세요' : headline || (pools.length ? '목표 범위 안' : '잔고 등록 필요')}/>

      {pools.map((p, i) => <PoolCard key={p.pool_id} index={i} pool={p} cards={cards} input={input} busy={busy} cash={cash[p.pool_id] ?? 0}
        onCash={v => setCash(c => ({ ...c, [p.pool_id]: v }))} run={run} onError={onError} onCustom={() => setCustomOpen(true)} rule={ruleOf(p.strategy_id)}/>)}

      {empty.map((p, i) => <AccountLine key={p.pool_id} compact index={pools.length + i} name={short(p.label)} rule={ruleOf(p.strategy_id)} mode={p.mode}
        editor={<><ModeToggle pool={p} disabled={busy} run={run}/><div className="w-56"><PrincipleSelect pool={p} cards={cards} disabled={busy} onPick={id => run(async () => { await api('/workbook/portfolio/follow', 'POST', { pool_id: p.pool_id, strategy_id: id }); return `${eun(short(p.label))} 이제 ${eul(cards.find(c => c.id === id)?.short ?? id)} 따라가요.` })} onCustom={() => setCustomOpen(true)}/></div></>}>
        <div className="flex h-full flex-wrap items-center gap-3 px-5 py-3">
          <p className="flex-1 text-base text-grey-700">잔고가 없어요. 등록하면 비교해요.</p>
          <Button size="sm" variant="outline" className="bg-white" onClick={onRegister}>잔고 등록</Button>
        </div>
      </AccountLine>)}

      <ReviewReport review={review}/>

    </div>
    <CustomDialog open={customOpen} onOpenChange={setCustomOpen} card={cards.find(c => c.id === 'custom')} run={run}/>
  </div>
}

function PrincipleSelect({ pool, cards, disabled, onPick, onCustom, shown }: { pool: { strategy_id: string; label: string }; cards: Card[]; disabled: boolean; onPick: (id: string) => void; onCustom: () => void; shown?: string }) {
  // shown: 비교 중인 원칙(아직 저장 전). '따르는 중'은 늘 실제로 따르는 원칙에만 붙인다
  const value = shown ?? pool.strategy_id
  return <Select value={value} disabled={disabled} onValueChange={v => v === '__custom' ? onCustom() : v !== value && onPick(v)}>
    <SelectTrigger className="h-9 w-full min-w-0 gap-1 border-transparent bg-grey-200/60 px-2 text-sm text-grey-900 shadow-none hover:bg-grey-200" aria-label={`${short(pool.label)} 따르는 원칙`}>
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
  const add = plan.leftover > 0 ? [...plan.increase, { asset_class: 'cash', label: '남는 현금', amount: plan.leftover }] : plan.increase
  const addTotal = plan.increase_total + Math.max(plan.leftover, 0)
  const max = Math.max(plan.reduce_total, addTotal, 1)
  const row = (title: string, tone: string, total: number, rows: Amount[]) => <div className="grid grid-cols-[52px_minmax(0,1fr)] items-start gap-3">
    <span className={cn('text-sm font-semibold leading-5', tone)}>{title}</span>
    <span className="flex flex-col gap-1">
      <span className="mt-1 flex h-3 gap-0.5" style={{ width: `${Math.max(8, total / max * 100)}%` }} role="img" aria-label={`${title} ${rows.map(r => `${r.label} ${man(r.amount)}`).join(', ')}`}>
        {rows.map(r => <span key={r.asset_class} title={`${r.label} ${man(r.amount)}`} className="rounded-full" style={{ width: `${r.amount / total * 100}%`, minWidth: 4, background: COLOR[r.asset_class] ?? 'var(--grey-400)' }}/>)}
      </span>
      <span className="flex flex-wrap gap-x-3 text-sm text-grey-700">{rows.map(r => <span key={r.asset_class} className="flex items-center gap-1">
        <i aria-hidden="true" className="inline-block size-2 rounded-full" style={{ background: COLOR[r.asset_class] ?? 'var(--grey-400)' }}/>{r.label} <b className="font-semibold tabular-nums">{man(r.amount)}</b></span>)}</span>
    </span>
  </div>
  if (!plan.reduce.length && !plan.increase.length) return null
  return <div className="flex flex-col gap-2">
    {plan.reduce.length > 0 && row('줄이기', 'text-down', plan.reduce_total, plan.reduce)}
    {plan.increase.length > 0 && row('늘리기', 'text-up', addTotal, add)}
  </div>
}

// 자산군마다 한 줄: 지금 비중(막대) · 목표(세로선) · 이번 달 팔기/사기 금액 (2026-11-18 사용자 "줄이기/늘리기 그래프는 펼쳐야 이해된다")
// 숫자는 서버(plan.mix)가 계산한 값 그대로
export function MixRows({ mix, leftover }: { mix: NonNullable<Plan['mix']>; leftover: number }) {
  const pct = (n: number) => formatPct(n, { signed: false, digits: 1 })
  return <div className="overflow-hidden rounded-md border border-grey-200 bg-white px-3 sm:px-4">
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-grey-200 py-2 text-xs text-grey-600 sm:grid-cols-[minmax(100px,1fr)_minmax(120px,2fr)_120px_152px]">
      <span>자산</span><span className="hidden sm:block">현재 비중 · 세로선은 목표</span><span className="hidden text-right sm:block">현재 → 목표</span><span className="text-right">이번에 할 일</span>
    </div>
    {mix.map(m => {
      const label = m.label.split(' (')[0]
      const detail = m.label.includes(' (') ? m.label.slice(m.label.indexOf(' (') + 2).replace(/\)$/, '') : ''
      return <div key={m.asset_class} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-grey-100 py-1.5 last:border-0 sm:grid-cols-[minmax(100px,1fr)_minmax(120px,2fr)_120px_152px]">
        <span title={m.label} className="min-w-0 text-sm font-semibold">
          <span className="flex items-center gap-1.5"><i aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full" style={{ background: COLOR[m.asset_class] ?? 'var(--grey-400)' }}/>{label}</span>
          {detail && <span className="hidden text-xs font-normal text-grey-600">{detail}</span>}
          <span className="mt-1 block text-xs font-normal tabular-nums text-grey-600 sm:hidden">{pct(m.current_pct)} → {pct(m.target_pct)}</span>
        </span>
        <span className="relative hidden h-2 rounded-full bg-grey-100 sm:block" role="img" aria-label={`${m.label} 현재 ${pct(m.current_pct)}, 목표 ${pct(m.target_pct)}`}>
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, m.current_pct)}%`, background: COLOR[m.asset_class] ?? 'var(--grey-400)' }}/>
          <span aria-hidden="true" className="absolute -inset-y-1 w-0.5 bg-grey-900" style={{ left: `calc(${Math.min(100, m.target_pct)}% - 1px)` }}/>
        </span>
        <span className="hidden text-right text-sm tabular-nums text-grey-600 sm:block">{pct(m.current_pct)} → {pct(m.target_pct)}</span>
        <span className={cn('flex items-center justify-end gap-2 whitespace-nowrap rounded-md px-2 py-1 tabular-nums', m.sell ? 'bg-down-soft' : m.buy ? 'bg-up-soft' : '', m.sell ? 'text-down' : m.buy ? 'text-up' : 'text-grey-600')}>
          <span className="text-xs">{m.sell ? '팔기' : m.buy ? '사기' : '그대로'}</span>
          {(m.sell > 0 || m.buy > 0) && <b className="text-base font-bold">{man(m.sell || m.buy)}</b>}
        </span>
      </div>
    })}
    {leftover > 0 && <p className="border-t border-grey-200 py-2 text-right text-sm text-grey-600">판 돈 중 <b className="font-semibold tabular-nums text-grey-800">{man(leftover)}</b>은 현금으로 남아요.</p>}
  </div>
}

export function StrategyAllocation({ name, targets }: { name: string; targets: Plan['targets'] }) {
  return <div className="flex max-w-3xl flex-col gap-1.5">
    <div className="flex h-2.5 overflow-hidden rounded-sm" role="img" aria-label={`${name} 목표 배분: ${targets.map(t => `${t.label} ${t.target_pct}%`).join(', ')}`}>
      {targets.map(t => <span key={t.asset_class} title={`${t.label} ${t.target_pct}%`} className="h-full shrink-0" style={{ width: `${t.target_pct}%`, background: COLOR[t.asset_class] ?? 'var(--grey-400)' }}/>) }
    </div>
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-grey-700">
      {targets.map(t => <span key={t.asset_class} title={t.label} className="inline-flex items-center gap-1 whitespace-nowrap"><i aria-hidden="true" className="size-1.5 shrink-0 rounded-full" style={{ background: COLOR[t.asset_class] ?? 'var(--grey-400)' }}/>{t.label.split(' (')[0]} <b className="font-semibold tabular-nums text-grey-900">{t.target_pct}%</b></span>)}
    </div>
  </div>
}

function TargetBar({ targets }: { targets: Plan['targets'] }) {
  return <span className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={targets.map(t => `${t.label} ${t.target_pct}%`).join(', ')}>
    {targets.map(t => <span key={t.asset_class} style={{ width: `${t.target_pct}%`, background: COLOR[t.asset_class] ?? 'var(--grey-400)' }}/>)}
  </span>
}

function PoolCard({ index, pool, cards, input, busy, cash, onCash, run, onError, onCustom, rule }: {
  rule: { name: string; classes: Card['classes'] }; index: number; pool: Pool; cards: Card[]; input: { owner: string; live: boolean }; busy: boolean; cash: number; onCash: (v: number) => void
  run: (fn: () => Promise<string>) => Promise<void>; onError: (m: string) => void; onCustom: () => void
}) {
  const [showOrders, setShowOrders] = useState(false)
  const [sending, setSending] = useState(false)
  const [delivery, setDelivery] = useState<{ ok: boolean; text: string } | null>(null)
  const sendLock = useRef(false)
  const sendOrders = async () => {
    if (sendLock.current) return
    sendLock.current = true; setSending(true); setDelivery(null)
    try {
      const result = await api<{ message: string }>('/workbook/telegram', 'POST', {
        ...input, cash: cash ? { [pool.pool_id]: { amount: cash } } : {}, pool_id: pool.pool_id,
      })
      setDelivery({ ok: true, text: result.message })
    } catch (error) {
      setDelivery({ ok: false, text: error instanceof Error ? error.message : '전송 결과를 확인하지 못했어요. 텔레그램을 확인해 주세요.' })
    } finally { sendLock.current = false; setSending(false) }
  }
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

  return <AccountLine index={index} name={name}
    balance={pool.total_value != null ? man(pool.total_value) : undefined} rule={rule} mode={pool.mode}
    editor={<><ModeToggle pool={pool} disabled={busy || previewing} run={run}/><div className="w-56"><PrincipleSelect pool={pool} shown={preview?.strategy_id} cards={cards} disabled={busy || previewing} onPick={pick} onCustom={onCustom}/></div></>}>

    {preview ? <div className="flex flex-col gap-2 px-4 py-3">
      <p className="text-2xl font-bold">{ro(preview.name)} 바꾸면, 이번 달 할 일이 이렇게 달라져요.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {([['지금', currentShort, preview.current, false], ['바꾸면', preview.name, preview.proposed, true]] as const).map(([tag, label, p, strong]) => p && <div key={tag} className={cn('flex flex-col gap-3 rounded-lg p-5', strong ? 'border-2 border-grey-900 bg-white' : 'border border-grey-200 bg-white')}>
          <span className="text-sm text-grey-600">{tag} · {label}</span>
          <TargetBar targets={p.targets}/>
          <p className="text-lg">{p.kind === 'move' ? <><b className="font-bold">{man(p.reduce_total)}</b>을 옮겨요.</> : <b className="font-bold">{p.title}</b>}</p>
          <p className="text-base text-grey-700">{p.kind === 'move'
            ? <>{p.reduce.map(r => `${r.label} ${man(r.amount)}`).join(' · ')} 팔기<br/>→ {p.increase.map(r => `${r.label} ${man(r.amount)}`).join(' · ')} 사기{p.leftover ? ` · ${man(p.leftover)}은 현금으로 남아요` : ''}</>
            : p.line}</p>
        </div>)}
      </div>
      {preview.notes.length > 0 && <div className="flex flex-col gap-1 rounded-lg bg-white px-4 py-3 text-base">
        <b className="font-semibold">꼭 알아둘 것</b>{preview.notes.map(n => <span key={n}>{n}</span>)}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" disabled={busy} onClick={() => run(async () => { await api('/workbook/portfolio/follow', 'POST', { pool_id: pool.pool_id, strategy_id: preview.strategy_id }); setPreview(null); return `${eun(name)} 이제 ${eul(preview.name)} 따라가요.` })}>{ro(preview.name)} 바꾸기</Button>
        <Button size="lg" variant="outline" className="bg-white" onClick={() => setPreview(null)}>{currentShort} 그대로</Button>
        <span className="text-sm text-grey-600">바꾸면 결정 기록에 남아요.</span>
      </div>
    </div>

    : pool.error || !plan ? <p className="px-5 py-4 text-base text-grey-700">{pool.error ?? '계산하지 못했어요.'}</p>

    : <div className="flex flex-col gap-2 px-4 py-3">
      {/* 문장은 한 줄(진단)만 — 옮길 금액은 막대가 말한다. 막대가 없으면(납입 때 맞추기 등) 오른쪽에 할 일 */}
      <div className={cn('grid items-center gap-x-8 gap-y-3', !(plan.mix?.length && (plan.reduce.length || plan.increase.length)) && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm leading-relaxed">
          <span className="text-grey-700">{plan.title_head ? <>{plan.title_head} {plan.title_tail}</> : plan.title}</span>
          {plan.line && <span className={cn('rounded-md px-2.5 py-1', plan.kind === 'blocked' ? 'bg-white/60 text-grey-700' : 'bg-white font-semibold text-grey-900')}>{plan.line}</span>}
        </p>
        {(plan.reduce.length > 0 || plan.increase.length > 0) ? (plan.mix?.length ? <MixRows mix={plan.mix} leftover={plan.leftover}/> : <FlowBars plan={plan}/>)
          : (plan.kind === 'buy_needs_cash' || (pool.mode === 'buy_only' && cash > 0)) ? <label className="flex flex-wrap items-center gap-2 text-base text-grey-700">이번 달 넣을 돈
            <input inputMode="numeric" defaultValue={cash ? cash.toLocaleString('ko-KR') : ''} placeholder="예: 3,000,000" aria-label={`${name} 이번 달 납입`}
              onBlur={e => onCash(Number(e.target.value.replace(/[^\d]/g, '')) || 0)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="h-10 w-40 rounded-md border border-grey-300 bg-white px-3 text-right text-base tabular-nums"/>원</label>
          : <span/>}
      </div>
      {pool.mode === 'buy_only' && cash > 0 && (plan.reduce.length > 0 || plan.increase.length > 0) && <p className="text-sm text-grey-600">이번 달 넣을 돈 {man(cash)} 기준이에요. <button type="button" className="underline underline-offset-2" onClick={() => onCash(0)}>지우기</button></p>}

      <TradeJournal poolId={pool.pool_id} accounts={pool.accounts} orders={trades} disabled={busy || sending}
        orderToggle={trades.length > 0 ? <button type="button" onClick={() => setShowOrders(s => !s)} aria-expanded={showOrders} className="flex min-h-9 items-center gap-1 text-sm font-semibold text-grey-800 hover:text-grey-900">
          종목·수량 보기 <span className="font-normal text-grey-600">팔기 {plan.sell_count} · 사기 {plan.buy_count}</span>{showOrders ? <ChevronUp className="size-4"/> : <ChevronDown className="size-4"/>}</button> : undefined}
        sendButton={trades.length > 0 ? <Button disabled={busy || sending || plan.kind === 'blocked'} onClick={sendOrders}><Send className="size-3.5"/>{sending ? '보내는 중…' : '주문표 보내기'}</Button> : undefined}/>
      {trades.length > 0 && <>
        {delivery && <p role={delivery.ok ? 'status' : 'alert'} className={cn('text-sm', delivery.ok ? 'text-grey-700' : 'text-destructive')}>{delivery.text}</p>}
        {/* 종목·수량, 확인 전 종목, 지난 기록은 펼쳤을 때만 */}
        {showOrders && <div className="flex flex-col gap-2">
          <ul className="flex flex-col rounded-lg bg-white px-3">
            {trades.map((o, i) => <li key={i} className="grid grid-cols-[40px_minmax(0,1fr)_72px_120px] items-center gap-2 border-b border-grey-100 py-2.5 last:border-0">
              <b className={cn('text-sm font-semibold', o.side === '매도' ? 'text-down' : 'text-up')}>{o.side === '매도' ? '팔기' : '사기'}</b>
              <span className={cn('truncate text-base', !o.qty && 'text-grey-600')}>{o.ticker_name ?? '종목 지정 필요'}</span>
              <span className="text-right text-sm text-grey-700 tabular-nums">{o.qty ? `${o.qty.toLocaleString('ko-KR')}주` : '금액만'}</span>
              <span className="text-right text-base tabular-nums">{won(o.amount)}</span>
            </li>)}
          </ul>
          {plan.amount_only > 0 && <p className="text-sm text-grey-600">{plan.amount_only}종목은 확인 전이라 금액만 보여요.</p>}
          {pool.last_decision && <p className="text-sm text-grey-600">이전 계획 기록(체결 내역 아님) {pool.last_decision.date}: {pool.last_decision.decision.replace(name, '').trim()}{pool.last_decision.reason ? ` — ${pool.last_decision.reason}` : ''}</p>}
        </div>}
      </>}
    </div>}
  </AccountLine>
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
