import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, BookOpen, Calculator, ChevronDown, ChevronRight, Info, Landmark, MousePointer2, RefreshCw, Settings2, Sprout, Sun, Wallet, X } from 'lucide-react'
import { Popover } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '../local-data'
import { ProfileForm } from '../forms'
import type { Family } from '../model'
import { useRetirementData, type Plan, type Result } from '../workbook/retirement'
import { Pagoda } from './Pagoda'
import { PlanDialog, type Editor } from './PlanDialog'
import { SpendingGoal } from './SpendingGoal'
import { SpendingBudgetDialog } from './SpendingBudgetDialog'
import { LearnLayer } from './LearnLayer'
import { IncomeChart } from './IncomeChart'
import { accruedDb, amount, capital, extra, LAYERS, manWon, PEOPLE, layerState, percent, streams, visibleYears, type Scope } from './presentation'
import './retirement-tower.css'

type Props = {
  data: Result | null; error: string; save: (plan: Plan) => Promise<boolean>; reload: () => Promise<void>
  owner: Scope; onOwnerChange: (owner: Scope) => void; onAssets: () => void; onRegister?: () => void
  hidden?: boolean; details?: ReactNode; embedded?: boolean; onProfileChanged?: () => void
}

export function RetirementPage({ owner, onOwnerChange, onChanged, onAssets, onRegister, hidden, rev, onProfileChanged }: {
  owner: Scope; onOwnerChange: (owner: Scope) => void; onChanged: (message: string) => void; onAssets: () => void; onRegister?: () => void; hidden: boolean; rev: number; onProfileChanged: () => void
}) {
  const state = useRetirementData({ rev, onChanged, onError: onChanged })
  return <RetirementTower {...state} owner={owner} onOwnerChange={onOwnerChange} onAssets={onAssets} onRegister={onRegister} hidden={hidden} onProfileChanged={onProfileChanged} embedded/>
}

export function RetirementTower({ data, error, save, reload, owner, onOwnerChange, onAssets, onRegister, hidden = false, details, embedded = false, onProfileChanged }: Props) {
  const uid = useId()
  const [selected, setSelected] = useState(1)
  // 층 상세는 별도 섹션이 아니라 누른 줄 아래 말풍선으로 (2026-11-02 사용자: "메모나 커서 아래로 내용이 뜨면"). 처음엔 닫혀 있다.
  const [detailOpen, setDetailOpen] = useState(false)
  const openDetail = (id: number) => { setSelected(id); setDetailOpen(true) }
  const [chosenYear, setChosenYear] = useState<number | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [editorScope, setEditorScope] = useState<Scope | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const budgetButton = useRef<HTMLButtonElement>(null)
  const [busySave, setBusySave] = useState(false)
  const [learnOpen, setLearnOpen] = useState(false)   // '이 연금 알아두기' 한 페이지
  // 자산 등록(사진·표·포털 계약)이 끝나면 적립금이 바뀌므로 다시 읽는다
  useEffect(() => { const h = () => { reload() }; window.addEventListener('retire:holdings-changed', h); return () => window.removeEventListener('retire:holdings-changed', h) }, [reload])
  const money = (won: number | null | undefined) => hidden ? '••••••' : won == null ? '—' : `${won.toLocaleString('ko-KR')}원`
  const monthly = (won: number | null | undefined) => hidden ? '••••••' : won == null ? '—' : (won / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })
  const big = (won: number | null | undefined) => hidden ? '••••••' : won == null ? '—' : `${manWon(won)} 원`
  if (!data) return <div className="tower-workspace"><div className="tower-loading" role={error ? 'alert' : 'status'}><Landmark size={32}/><h2>{error ? '연금 계획을 불러오지 못했어요' : '우리의 연금탑을 불러오고 있어요'}</h2><p>{error || '저장한 계획과 등록한 계좌를 확인하고 있습니다.'}</p>{error && <Button onClick={reload}><RefreshCw size={15}/>다시 불러오기</Button>}</div></div>
  const years = visibleYears(data, owner)
  const defaultYear = data.projection?.summary.retire_year ?? years[0]?.year
  const row = years.find(r => r.year === chosenYear) ?? years.find(r => r.year === defaultYear) ?? years[0]
  const year = row?.year ?? data.base_year
  const scopedStreams = streams(data, owner)
  const hasInputs = scopedStreams.length > 0
  const hasPerson = owner === 'together' ? !!data.used.me : !!data.used[owner]
  const ready = !!row && hasPerson && hasInputs && !error
  const total = ready ? amount(row, owner) : null
  const partial = data.missing.length > 0 && owner === 'together'
  const need = owner === 'together' && !partial && ready && row?.retired ? row.need_real : null
  const gap = need != null && total != null ? total - need : null
  const coverage = need != null && need > 0 ? row?.coverage : null
  const pct = coverage?.total ?? null
  const saved = error ? null : capital(data, owner)
  const dbSaved = error ? 0 : accruedDb(data, owner)
  const share = (id: number) => coverage && streams(data, owner, id).length ? coverage.layers[String(id)] ?? 0 : null
  // 4층 추가연금: 기본 합계 밖. '월급으로 나눠 쓰면' 월액과 '목돈으로 두면' 적립금을 나란히 (추천 없음)
  const extraMonthly = ready ? extra(row, owner) : 0
  const layerCapital = (id: number) => error ? null : capital(data, owner, id)
  const scopeLabel = owner === 'together' ? '우리 함께' : owner === 'me' ? '나' : '배우자'
  const ageLabel = row ? PEOPLE.filter(([who]) => row.ages[who] != null && (owner === 'together' || who === owner)).map(([who, label]) => `${label} ${row.ages[who]}세`).join(' · ') : '계산 전'
  const currentLayer = LAYERS[selected - 1]
  const currentStatus = layerState(data, owner, year, selected)
  const activePeople = PEOPLE.filter(([who]) => data.used[who] && (owner === 'together' || owner === who))
  const icon = [Landmark, Wallet, Sprout, Sun][selected - 1]
  const Icon = icon
  const firstYear = years[0]?.year ?? year, lastYear = years.at(-1)?.year ?? year
  const milestones = [...new Set([defaultYear, ...scopedStreams.map(s => s.start_year), lastYear])].filter((y): y is number => y != null && y >= firstYear && y <= lastYear).sort((a, b) => a - b)
  const missing = !hasPerson ? owner === 'partner' ? ['배우자 나이·은퇴 나이'] : data.missing : data.missing
  // Before a layer starts paying, show when it starts and how much (today's money) instead of a bare 0.
  const upcoming = (scope: Scope, id: number) => {
    const start = streams(data, scope, id).map(s => s.start_year).filter(y => y > year)
    if (!start.length) return null
    const startYear = Math.min(...start)
    return { year: startYear, amount: amount(data.projection?.rows.find(r => r.year === startYear), scope, id) }
  }
  const layerText = (id: number) => {
    if (error) return '확인 필요'
    const status = layerState(data, owner, year, id)
    if (status === '수령 중') return `월 ${monthly(amount(row, owner, id))}만 원`
    const next = status.endsWith('년부터') ? upcoming(owner, id) : null
    return next && (next.amount ?? 0) > 0 ? `${next.year}년부터 월 ${monthly(next.amount)}만 원` : status
  }
  const monthlyBenefit = (scope: Scope, id: number) => {
    const status = error ? '확인 필요' : layerState(data, scope, year, id)
    if (status === '수령 중') return { value: amount(row, scope, id), starts: null, status }
    const next = status.endsWith('년부터') ? upcoming(scope, id) : null
    return { value: next?.amount ?? null, starts: next?.year ?? null, status }
  }
  const layerMonthly = (id: number) => {
    const benefit = monthlyBenefit(owner, id)
    return <><span className={`tower-layer-amount${benefit.value == null ? ' is-muted' : benefit.starts != null ? ' is-upcoming' : ''}`} data-testid={`layer-monthly-${id}`} data-won={hidden ? undefined : benefit.value ?? undefined}>
      {benefit.value == null ? benefit.status : <><small>월</small><b>{monthly(benefit.value)}</b><small>만 원</small></>}
    </span>{benefit.starts != null && <span className="tower-layer-period">{benefit.starts}년부터 수령</span>}</>
  }
  // DB 퇴직금은 지금 그만둬도 받는 확정 금액이라(2026-11-02 사용자) 2층 적립금과 전체 모인 돈에 합산한다. 계좌 잔고와는 성격이 달라 내역에서 나눠 보여 준다.
  const capitalLabel = (id: number) => id === 2 && dbSaved > 0 ? layerCapital(2) == null ? '확정 퇴직금(DB)' : `계좌 ${big(layerCapital(2))} · DB ${big(dbSaved)}` : '현재 계좌 적립금'
  const capitalAmount = (id: number) => id === 2 && dbSaved > 0 ? (layerCapital(2) ?? 0) + dbSaved : layerCapital(id)
  const savedTotal = saved == null && dbSaved === 0 ? null : (saved ?? 0) + dbSaved
  const periodText = (person: Scope, layer: number) => [...new Set(streams(data, person, layer).map(s => s.layer === 1 ? `${s.start_age}세부터 종신` : s.payout_years == null ? '수령 기간 확인 필요' : `${s.start_age}세부터 ${s.end_age_exclusive}세 직전까지 · ${s.payout_years}년 수령`))].join(' / ')
  // 은퇴 첫해부터 국민연금 개시 전까지의 소득 공백. 서버가 계산한 그 해 월 합계(오늘 돈)만 읽는다.
  const retireYear = data.projection?.summary.retire_year ?? null
  const npStarts = streams(data, owner, 1).map(s => s.start_year)
  const npStart = npStarts.length ? Math.min(...npStarts) : null
  const bridgeRow = retireYear != null ? data.projection?.rows.find(r => r.year === retireYear) : undefined
  const bridge = ready && retireYear != null && npStart != null && npStart > retireYear && bridgeRow ? { from: retireYear, to: npStart - 1, years: npStart - retireYear, amount: amount(bridgeRow, owner) ?? 0 } : null
  return <div className={`tower-workspace${embedded ? ' tower-embedded' : ''}`}>
    <div className="tower-intro"><h1>연금</h1>
      <div className="tower-intro-actions"><div className="tower-toolbar"><button onClick={() => setProfileOpen(true)}>내 정보</button><button onClick={() => hasPerson ? setEditor('timing') : setProfileOpen(true)}>은퇴·수령 시점</button><button onClick={() => setEditor('assumptions')}><Settings2 size={14}/>계산 가정</button></div>
      <div className="tower-scope" role="group" aria-label="연금 조회 범위">{([['together', '우리 함께'], ['me', '나'], ['partner', '배우자']] as const).map(([key, label]) => <button key={key} aria-pressed={owner === key} onClick={() => onOwnerChange(key)}>{label}</button>)}</div></div>
    </div>
    {(error || data.error || missing.length > 0) && <div className="tower-alert" role="alert"><Info size={18}/><div><strong>{error || data.error || `먼저 확인해 주세요: ${missing.join(', ')}`}</strong>{partial && data.projection && <p>입력이 있는 사람만 계산했습니다. 가족 정보를 채우기 전에는 생활비 충당 여부를 표시하지 않아요.</p>}</div><Button variant="outline" size="sm" onClick={error ? reload : data.error ? () => setEditor('timing') : () => setProfileOpen(true)}>{error ? '새로고침' : data.error ? '수령 시점 수정' : '내 정보 입력'}</Button></div>}
    {bridge && <div className="tower-bridge" role="note" data-testid="pension-bridge"><Info size={16}/><p>{bridge.years === 1 ? `${bridge.from}년` : `${bridge.from}~${bridge.to}년`}, 국민연금을 받기 전 <b>{bridge.years}년</b>은 {bridge.amount > 0 ? <>월 <b>{monthly(bridge.amount)}만 원</b>뿐이에요.</> : <><b>월 연금이 없어요.</b></>}{need != null && bridge.amount > 0 && !hidden ? ` 생활비 ${monthly(need)}만 원의 ${percent(bridge.amount / need * 100)}%예요.` : ''}</p>{year !== bridge.from && <button onClick={() => setChosenYear(bridge.from)}>{bridge.from}년 보기</button>}</div>}
    <section className="tower-hero" aria-label="우리집 4층 연금탑">
      <div className="tower-tower-card"><div className="tower-tower-heading"><div><h2>은퇴 후, 매달 받는 연금.</h2><span>{row ? `${year}년 기준` : scopeLabel} · 세전 · 오늘의 돈</span></div></div>
        <div className="tower-tower-view"><figure className="tower-sculpture"><Pagoda selected={selected} onSelect={openDetail} states={LAYERS.map(l => ({ label: `${l.name}, ${layerText(l.id)}` }))}/><figcaption><MousePointer2 size={13}/>각 층을 눌러 살펴보세요</figcaption><p className="tower-color-legend">색은 연금 종류를 나타내요</p></figure>
          <div className="tower-layers" role="group" aria-label="연금층 선택">{[...LAYERS].reverse().map(l => <Popover.Root key={l.id} open={detailOpen && selected === l.id} onOpenChange={open => { if (!open) setDetailOpen(false) }}><Popover.Anchor asChild><div className="tower-layer-row" data-selected={selected === l.id}><button className="tower-layer-button" aria-pressed={selected === l.id} onClick={() => detailOpen && selected === l.id ? setDetailOpen(false) : openDetail(l.id)} aria-label={`${l.id}층 ${l.name} 살펴보기`}>
            <span className="tower-layer-name"><i style={{ background: `var(--tower-layer-${l.id})` }}/><small>{l.id}층</small>{l.name}<ChevronRight size={13}/></span>
            <span className="tower-layer-principal">{<>
              {/* 사용자(11-02): 4층도 3층처럼 — 큰 글씨는 월 금액, 아래 연한 글씨는 등록한 목돈 */}
              {layerMonthly(l.id)}
              {l.id > 1 && <span className="tower-layer-balance" title={capitalLabel(l.id)}>{l.id === 4 ? '등록한 목돈' : '현재 준비금'} <span data-testid={`layer-capital-${l.id}`} data-won={hidden ? undefined : capitalAmount(l.id) ?? undefined}>{capitalAmount(l.id) == null ? hidden ? '••••••' : '등록 내역 없음' : big(capitalAmount(l.id))}</span></span>}
              {l.id > 1 && scopedStreams.some(s => s.layer === l.id) && <span className="tower-layer-period">{activePeople.map(([who, label]) => { const periods = streams(data, who, l.id).map(s => s.payout_years).filter((v): v is number => v != null); return periods.length ? `${label} ${[...new Set(periods)].join('·')}년 수령` : '' }).filter(Boolean).join(' · ')}</span>}
            </>}</span>
            <span className="tower-layer-gauge" aria-label={hidden ? '금액 숨김' : share(l.id) == null ? '생활비 기여율 계산 전' : `목표 생활비의 ${percent(share(l.id)!)}% 담당`}><span className="tower-layer-track"><i style={{ width: `${hidden ? 0 : Math.min(100, share(l.id) ?? 0)}%`, background: `var(--tower-fill-${l.id})` }}/></span><span>{hidden ? '•••' : share(l.id) != null ? <>생활비의 <b>{percent(share(l.id)!)}%</b></> : l.id === 4 ? '월 연금 연결 전' : owner !== 'together' ? '기여율은 함께 보기에서' : partial ? '가족 정보 확인 필요' : data.plan.monthly_need == null || data.plan.monthly_need === 0 ? '생활비 목표 설정 필요' : !row?.retired ? '은퇴 전' : '연금 정보 확인 필요'}</span></span>
          </button>{l.id <= 2 ? <button type="button" className="tower-layer-edit" aria-label={`${l.name} 입력·수정하기`} onClick={() => { setSelected(l.id); setEditorScope(null); if (!hasPerson) setProfileOpen(true); else setEditor(l.id as Editor) }}>입력·수정하기</button>
            : <button type="button" className="tower-layer-edit" aria-label={`${l.name} 자산 등록하기`} onClick={() => { setSelected(l.id); (onRegister ?? onAssets)() }}>자산 등록하기</button>}{/* 개인·추가연금 적립금은 공통 '자산 등록하기'(사진·파일·직접)로 (2026-11-02 사용자: "처음에 자산 등록하기로 되어야, 그건 공통") */}</div></Popover.Anchor>
            <Popover.Portal><Popover.Content className="tower-detail tower-detail-pop tower-plan-dialog" aria-labelledby={`${uid}-detail`} side="bottom" align="start" sideOffset={6} collisionPadding={12} onOpenAutoFocus={e => e.preventDefault()} onCloseAutoFocus={e => e.preventDefault()}>
<div className="tower-detail-heading"><span className="tower-detail-icon"><Icon size={20}/></span><div><h2 id={`${uid}-detail`}>{selected}층 · {currentLayer.name}</h2><p>{currentLayer.description}</p></div><Popover.Close className="tower-detail-close" aria-label="층 상세 닫기"><X size={16}/></Popover.Close></div>
      <div className="tower-members">{activePeople.length ? activePeople.map(([who, label]) => { const benefit = monthlyBenefit(who, selected); return <div className="tower-member" key={who}>
        <small>{label} · {selected === 4 ? '등록한 목돈' : `${benefit.starts ?? year}년${benefit.starts != null ? '부터' : ''} 월 연금 · 오늘 돈`}</small>
        <strong>{error ? '확인 필요' : selected === 4 ? capital(data, who, selected) == null ? '등록 내역 없음' : big(capital(data, who, selected)) : benefit.value == null ? benefit.status : `월 ${monthly(benefit.value)}만 원`}</strong>
        {selected > 1 && selected < 4 && <span>현재 계좌 적립금 {capital(data, who, selected) == null ? '등록 내역 없음' : money(capital(data, who, selected))}</span>}
        {selected === 2 && !error && accruedDb(data, who) > 0 && <span>현재 DB 퇴직금 {money(accruedDb(data, who))} 별도</span>}
        {selected === 4 && <span className="tower-member-payout">월로 나눠 쓰면 · {benefit.value == null ? benefit.status : `${benefit.starts ?? year}년 월 ${monthly(benefit.value)}만 원`} · 오늘 돈</span>}
        <span>{periodText(who, selected) || '준비 정보를 입력해 주세요'}</span>
        {selected === 1 && <span>화면 계산은 {data.assumptions.end_age}세 직전까지</span>}
      </div> }) : <p className="tower-muted">나이와 은퇴 목표를 입력하면 각자의 계획을 볼 수 있어요.</p>}</div>
      <button type="button" className="tower-detail-link tower-detail-learn" aria-label={`${currentLayer.name} 알아두기`} onClick={() => { setDetailOpen(false); setLearnOpen(true) }}><BookOpen size={13}/>이 연금 알아두기 — 세금·한도·조심할 것</button>
      {selected === 1 && !error && data.national && activePeople.some(([who]) => (data.national!.options[who] ?? []).length) && <div className="tower-nat">
        {/* 조기·연기 비교: 월액·시작 연도·공백·손익분기 나이를 나란히. 어느 쪽도 추천하지 않고 고르는 건 사용자 (2026-11-02) */}
        {activePeople.map(([who, label]) => { const opts = data.national!.options[who] ?? []; if (!opts.length) return null; const current = opts.find(o => o.selected); const show = [...new Set([-5, 0, 5, current?.shift ?? 0])].sort((a, b) => a - b).map(sh => opts.find(o => o.shift === sh)!).filter(Boolean); return <div className="tower-nat-person" key={who}>
          <div className="tower-nat-head"><strong>{label} · 언제 받을까</strong><small>오늘 돈 · 세전 · 손익분기 = 65세에 받는 것과 누적액이 같아지는 나이</small></div>
          <div className="tower-nat-grid" role="table" aria-label={`${label} 국민연금 조기·연기 비교`}>
            {show.map(o => <button type="button" key={o.shift} className={`tower-nat-opt${o.selected ? ' is-selected' : ''}`} aria-pressed={o.selected} disabled={busySave} onClick={async () => { if (o.selected) return; setBusySave(true); await save({ ...data.plan, [who]: { ...(data.plan[who] ?? {}), national_start_age: o.start_age } }); setBusySave(false) }}>
              <small>{o.shift < 0 ? `조기 ${-o.shift}년` : o.shift > 0 ? `연기 ${o.shift}년` : '정상'}</small>
              <b>{o.start_age}세 · {o.start_year}년</b>
              <span className="tower-nat-amt">월 {monthly(o.monthly_real)}만 원 <em>({Math.round(o.factor * 100)}%)</em></span>
              <span>{o.gap_years ? `은퇴 뒤 공백 ${o.gap_years}년` : '공백 없음'}</span>
              <span>{o.breakeven_age != null ? `손익분기 ${o.breakeven_age}세` : '기준'}</span>
              {o.selected ? <i>지금 선택</i> : <i className="tower-nat-pick">이 나이로 정하기</i>}
            </button>)}
          </div>
        </div> })}
        {Object.keys(data.national.survivor).length > 0 && <details className="tower-nat-survivor"><summary>한 사람이 먼저 떠나면 — 유족연금 대충 보기<ChevronDown size={14}/></summary>
          {Object.values(data.national.survivor).filter(sv => owner === 'together' || sv.survivor === owner).map(sv => { const t = sv.tiers.over_20y ?? Object.values(sv.tiers)[0]; const who = sv.survivor === 'me' ? '내가' : '배우자가', gone = sv.deceased === 'me' ? '내가' : '배우자가', goneName = sv.deceased === 'me' ? '내' : '배우자'; return <div className="tower-nat-sv" key={sv.survivor}>
            <strong>{gone} 먼저 떠나면, {who} 받는 국민연금</strong>
            <div><span>① 본인 노령연금 + 유족연금의 30%</span><b>{monthly(t.own_plus)}만 원{t.larger === 'own_plus' && <i> · 더 큼</i>}</b></div>
            <div><span>② 유족연금만 ({goneName} 월액의 60%)</span><b>{monthly(t.survivor_only)}만 원{t.larger === 'survivor_only' && <i> · 더 큼</i>}</b></div>
            <small>가입 20년 이상 기준(10~20년 50% · 10년 미만 40%). 부양가족연금액·세금은 뺀 대충 계산이에요. 둘 중 하나만 받을 수 있어요.</small>
          </div> })}
        </details>}
      </div>}
      {selected === 3 && <button type="button" className="tower-detail-link" aria-label="개인연금 납입·수령 설정" onClick={() => { setDetailOpen(false); setEditorScope(null); if (!hasPerson) setProfileOpen(true); else setEditor(3) }}><Settings2 size={13}/>1년 납입액 · 수령 설정</button>}
      {selected === 4 && <button type="button" className="tower-detail-link" onClick={() => { setDetailOpen(false); onAssets() }}><Wallet size={13}/>등록한 자산 보기</button>}
      {selected === 4 && <p className="tower-detail-note"><Info size={15}/>세제비적격 연금보험(일반·변액연금보험)과 ISA처럼 세액공제를 받지 않은 은퇴 자금이 여기에 들어가요. 받을 때 연금소득세가 없고 해지해도 토해 낼 공제가 없어요. 월 수령액은 3층과 같은 방식으로 계산하지만 기본 합계에는 넣지 않고, 요약 카드에 ‘월급으로 나눠 쓰면 / 목돈으로 두면’ 두 숫자로 따로 보여 줘요.</p>}
      {selected !== 4 && currentStatus === '준비 정보 없음' && <p className="tower-detail-note">정보가 없다는 뜻이며, 실제 받을 연금이 0원이라는 뜻은 아니에요.</p>}
            </Popover.Content></Popover.Portal></Popover.Root>)}
</div>
        </div>
        <details className="tower-capital-details"><summary><Wallet size={14}/><span>준비한 연금 자산 · 2–4층</span><strong data-testid="pension-capital-total" data-won={hidden ? undefined : savedTotal ?? undefined}>{savedTotal == null ? hidden ? '••••••' : '등록 내역 없음' : big(savedTotal)}</strong><ChevronDown size={14}/></summary>
          <div><span>계좌 적립금</span><b data-testid="pension-capital" data-won={hidden ? undefined : saved ?? undefined}>{saved == null ? hidden ? '••••••' : '등록 내역 없음' : big(saved)}</b></div>
          {dbSaved > 0 && <div><span>확정 퇴직금(DB)</span><b>{big(dbSaved)}</b></div>}
        </details>
      </div>
      <aside className="tower-summary" aria-label="선택 연도의 연금 요약"><div className="tower-summary-kicker"><i/>{scopeLabel} · {row ? `${year}년` : '계산 전'}</div><p className="tower-summary-ages">{ageLabel}</p><p className="tower-monthly-label">매달 받는 연금 · 1–3층</p><div className="tower-income-actions"><div className="tower-total"><small>월</small><strong data-testid="pension-total" data-won={hidden ? undefined : total ?? undefined}>{monthly(total)}</strong><small>만 원</small></div><button type="button" className="tower-budget-open" ref={budgetButton} onClick={() => setBudgetOpen(true)}><Calculator size={14}/>생활비 계산</button></div><p className="tower-summary-note">{partial ? '계산 가능한 가족의 연금만 포함' : '입력된 연금 기준 · 세전 / 오늘의 돈'}</p>
        <div className="tower-coverage">{pct != null && !hidden && <div className="tower-coverage-track" aria-hidden="true">{LAYERS.slice(0, 3).map(l => <i key={l.id} style={{ width: `${(amount(row, owner, l.id) ?? 0) / Math.max(1, total ?? 0, need ?? 0) * 100}%`, background: `var(--tower-layer-${l.id})` }}/>)}</div>}
          <div className="tower-coverage-label"><button onClick={() => setEditor('goal')}><span>{owner !== 'together' ? '부부 생활비' : '생활비 · 오늘 돈'} {data.plan.monthly_need == null ? '입력하기' : money(data.plan.monthly_need)}</span><Settings2 size={12}/></button>{pct != null && <span>{hidden ? '•••' : percent(pct)}% 충당</span>}</div></div>
        <div className="tower-gap"><h3>{!ready ? '연금 정보를 채워 주세요.' : partial ? '가족 정보를 먼저 채워 주세요.' : owner !== 'together' ? '각자의 준비를 함께 살펴요.' : !row?.retired ? '은퇴 전 수령하는 금액이에요.' : gap == null ? '바라는 한 달을 정해 볼까요?' : gap < 0 ? <>생활비까지<br/><em>월 {monthly(-gap)}만 원</em>이 더 필요해요.</> : <>입력된 연금으로<br/><em>{gap === 0 ? '생활비를 채우고 있어요.' : `월 ${monthly(gap)}만 원의 여유가 있어요.`}</em></>}</h3>{(!ready || owner !== 'together' || gap == null) && <p>{!ready ? '국민연금 예상액과 퇴직금, 연금저축 납입 계획을 알려 주세요.' : owner !== 'together' ? '생활비는 부부의 합계와 비교해요. 우리 함께 보기에서 확인하세요.' : gap != null ? '수령 시점에 따라 달라져요. 다른 나이의 흐름도 함께 살펴보세요.' : '은퇴 후 부부가 필요한 월 생활비를 입력하면 연금과 비교할 수 있어요.'}</p>}
          <button className="tower-summary-action" onClick={() => !hasPerson ? setProfileOpen(true) : !hasInputs ? setEditor(1) : owner !== 'together' ? onOwnerChange('together') : setEditor('goal')}>{!hasPerson ? '내 정보 입력하기' : !hasInputs ? '연금 정보 입력하기' : owner !== 'together' ? '우리 함께 보기' : '생활비 목표 바꾸기'}<ArrowRight size={15}/></button></div>
        {need != null && row?.need_nominal != null && <div className="tower-nominal-summary" aria-label="선택 연도의 명목 금액 비교"><small>{year}년 그해의 돈으로 보면</small><div><span>월 연금 · 세전</span><b data-testid="selected-nominal-income" data-won={hidden ? undefined : row.total_nominal}>{monthly(row.total_nominal)}만 원</b></div><div><span>필요한 월 생활비</span><b data-testid="selected-nominal-need" data-won={hidden ? undefined : row.need_nominal}>{monthly(row.need_nominal)}만 원</b></div></div>}
        {(layerCapital(4) ?? 0) > 0 || extraMonthly > 0
          ? <div className="tower-extra-choice" data-testid="pension-extra"><small>4층 추가연금은 기본 합계에 넣지 않았어요 — 두 가지로 볼 수 있어요</small>
              <div><span>월급으로 나눠 쓰면</span><b data-testid="pension-total-with-extra" data-won={hidden || total == null ? undefined : total + extraMonthly}>{extraMonthly > 0 ? `월 ${monthly((total ?? 0) + extraMonthly)}만 원` : layerText(4)}</b></div>
              <div><span>목돈으로 두면</span><b>{big(layerCapital(4))} 그대로</b></div></div>
          : <p className="tower-excluded">4층 추가연금은 월 수령 합계에서 제외</p>}
      </aside>
    </section>
    <section className="tower-flow" id={`${uid}-flow`} aria-labelledby={`${uid}-flow-title`}>
      <div className="tower-section-heading"><div><h2 id={`${uid}-flow-title`}>받는 시간표</h2><p>연금이 하나씩 더해지며 달라지는 한 달 · 그래프나 연도를 움직여 살펴보세요</p></div>
        {row && hasInputs && !error && <div className="tower-milestones">{milestones.map(y => <button key={y} aria-pressed={year === y} onClick={() => setChosenYear(y)}>{y}년 · {y === defaultYear ? '나 은퇴 첫해' : y === lastYear ? '마지막 해' : [...new Set(scopedStreams.filter(s => s.start_year === y).map(s => `${s.person === 'me' ? '나' : '배우자'} ${s.label.replace(/\(.+\)/, '')}`))].join(' · ') + ' 시작'}</button>)}</div>}</div>
      {row && hasInputs && !error ? <IncomeChart rows={years} scope={owner} year={year} onYearChange={setChosenYear} onLayerSelect={openDetail} hidden={hidden} showNeed={owner === 'together' && !partial}/>
        : <div className="tower-flow-empty"><Sprout size={18}/><p>{data.error ? '수령 시점의 입력 오류를 수정하면 시간표를 볼 수 있어요.' : '가족 정보와 연금 계획이 준비되면 수령 시간표가 나타나요.'}</p><Button variant="outline" size="sm" onClick={() => !hasPerson ? setProfileOpen(true) : setEditor(data.error ? 'timing' : 1)}>{!hasPerson ? '내 정보 입력' : '연금 정보 입력'}</Button></div>}
    </section>
    <SpendingGoal data={data} hidden={hidden} error={error} onGoal={() => setEditor('goal')} onAssumptions={() => setEditor('assumptions')} onTiming={() => { if (data.used.me) { setEditorScope('me'); setEditor('timing') } else setProfileOpen(true) }}/>
    <div className="tower-assumptions-summary"><div><strong>이렇게 계산했어요</strong><button onClick={() => setEditor('assumptions')}>가정 수정<Settings2 size={13}/></button></div><p>연 수익률 {(data.assumptions.return_rate * 100).toFixed(1)}% · 물가 {(data.assumptions.inflation * 100).toFixed(1)}%</p>
      <ul>{scopedStreams.filter(s => s.layer > 1).map((s, i) => <li key={i}><span>{s.person === 'me' ? '나' : '배우자'} · {s.label}</span><strong>{s.start_age}세부터 {s.end_age_exclusive}세 직전까지, 총 {s.payout_years}년 수령</strong></li>)}</ul>
      <p>국민연금은 종신 · 화면 계산은 {data.assumptions.end_age}세 직전까지. 세금·수령한도·추가연금은 반영하지 않았어요.</p>
    </div>
    <div className="tower-footnote"><p>층별 게이지 = 해당 층의 월 연금 ÷ 목표 월 생활비. 각 층이 생활비에서 담당하는 몫이며, 층마다 100%를 채우는 목표가 아닙니다. 현재 적립금에는 앞으로 넣을 돈과 예상 수익을 더하지 않았어요.</p><p>예측이 아닌 입력한 가정의 계산 결과입니다. 석탑의 네 층은 연금 종류를 구분합니다. 생활비 충당률은 각 항목의 막대와 숫자로 확인해 주세요.</p></div>
    {details && <details className="tower-sheet-detail"><summary>입력값·연도별 계산을 표로 보기<ChevronDown size={16}/></summary><div className="tower-sheet-grid">{details}</div></details>}
    {budgetOpen && <SpendingBudgetDialog data={data} save={save} close={() => setBudgetOpen(false)} returnFocus={() => budgetButton.current?.focus()}/>}
    {editor !== null && <PlanDialog data={data} scope={editorScope ?? owner} section={editor} save={save} close={() => { setEditor(null); setEditorScope(null) }}/>}
    {learnOpen && <LearnLayer layer={selected} data={data} row={row} owner={owner} close={() => setLearnOpen(false)}/>}
    {profileOpen && <RetirementProfile close={() => setProfileOpen(false)} onSaved={() => { setProfileOpen(false); reload(); onProfileChanged?.() }}/>}
  </div>
}

function RetirementProfile({ close, onSaved }: { close: () => void; onSaved: () => void }) {
  const [family, setFamily] = useState<Family | null | undefined>()
  const [error, setError] = useState('')
  useEffect(() => { const controller = new AbortController(); api<Family | null>('/family', 'GET', undefined, controller.signal).then(setFamily).catch(e => { if (!controller.signal.aborted) setError(e.message) }); return () => controller.abort() }, [])
  return <Dialog open onOpenChange={open => { if (!open) close() }}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>내 정보 · 배우자 정보</DialogTitle><DialogDescription>각자의 나이와 은퇴 목표를 알려 주세요.</DialogDescription></DialogHeader>{error ? <p role="alert">{error}</p> : family === undefined ? <p>불러오는 중…</p> : <ProfileForm family={family} onSaved={onSaved}/>}</DialogContent></Dialog>
}
