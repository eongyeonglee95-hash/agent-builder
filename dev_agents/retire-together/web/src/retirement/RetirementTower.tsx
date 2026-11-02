import { useEffect, useId, useState, type ReactNode } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, Coins, Info, Landmark, MousePointer2, RefreshCw, Settings2, Sprout, Sun, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { api } from '../local-data'
import { ProfileForm } from '../forms'
import type { Family } from '../model'
import { useRetirementData, type Plan, type Result } from '../workbook/retirement'
import { Pagoda } from './Pagoda'
import { PlanDialog, type Editor } from './PlanDialog'
import { SpendingGoal } from './SpendingGoal'
import { accruedDb, amount, capital, LAYERS, PEOPLE, layerState, percent, streams, visibleYears, type Scope } from './presentation'
import './retirement-tower.css'

type Props = {
  data: Result | null; error: string; save: (plan: Plan) => Promise<boolean>; reload: () => Promise<void>
  owner: Scope; onOwnerChange: (owner: Scope) => void; onAssets: () => void
  hidden?: boolean; details?: ReactNode; embedded?: boolean; onProfileChanged?: () => void
}

export function RetirementPage({ owner, onOwnerChange, onChanged, onAssets, hidden, rev, onProfileChanged }: {
  owner: Scope; onOwnerChange: (owner: Scope) => void; onChanged: (message: string) => void; onAssets: () => void; hidden: boolean; rev: number; onProfileChanged: () => void
}) {
  const state = useRetirementData({ rev, onChanged, onError: onChanged })
  return <RetirementTower {...state} owner={owner} onOwnerChange={onOwnerChange} onAssets={onAssets} hidden={hidden} onProfileChanged={onProfileChanged} embedded/>
}

export function RetirementTower({ data, error, save, reload, owner, onOwnerChange, onAssets, hidden = false, details, embedded = false, onProfileChanged }: Props) {
  const uid = useId()
  const [selected, setSelected] = useState(1)
  const [chosenYear, setChosenYear] = useState<number | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [editorScope, setEditorScope] = useState<Scope | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const money = (won: number | null | undefined) => hidden ? '••••••' : won == null ? '—' : `${won.toLocaleString('ko-KR')}원`
  const monthly = (won: number | null | undefined) => hidden ? '••••••' : won == null ? '—' : (won / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })
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
  const share = (id: number) => coverage && id !== 4 && streams(data, owner, id).length ? coverage.layers[String(id)] ?? 0 : null
  const hasCapital = (id: number) => !error && ((capital(data, owner, id) ?? 0) > 0 || (id === 2 && dbSaved > 0))
  const layerCapital = (id: number) => error ? null : capital(data, owner, id)
  const scopeLabel = owner === 'together' ? '우리 함께' : owner === 'me' ? '나' : '배우자'
  const ageLabel = row ? PEOPLE.filter(([who]) => row.ages[who] != null && (owner === 'together' || who === owner)).map(([who, label]) => `${label} ${row.ages[who]}세`).join(' · ') : '계산 전'
  const currentLayer = LAYERS[selected - 1]
  const currentStatus = layerState(data, owner, year, selected)
  const activePeople = PEOPLE.filter(([who]) => data.used[who] && (owner === 'together' || owner === who))
  const icon = [Landmark, Wallet, Sprout, Sun][selected - 1]
  const Icon = icon
  const firstYear = years[0]?.year ?? year, lastYear = years.at(-1)?.year ?? year
  const span = Math.max(1, lastYear - firstYear + 1)
  const scale = (value: number) => Math.max(0, Math.min(100, (value - firstYear) / span * 100))
  const milestones = [...new Set([defaultYear, ...scopedStreams.map(s => s.start_year), lastYear])].filter((y): y is number => y != null && y >= firstYear && y <= lastYear).sort((a, b) => a - b)
  const missing = !hasPerson ? owner === 'partner' ? ['배우자 나이·은퇴 나이'] : data.missing : data.missing
  const layerText = (id: number) => {
    if (error) return '확인 필요'
    const status = layerState(data, owner, year, id)
    return status === '수령 중' ? `${monthly(amount(row, owner, id))}만 원 / 월` : status
  }
  const currentYearText = (id: number) => layerState(data, owner, year, id) === '수령 중'
  const capitalLabel = (id: number) => id === 2 && layerCapital(2) == null && dbSaved > 0 ? '현재 DB 퇴직금' : '현재 계좌 적립금'
  const capitalAmount = (id: number) => id === 2 && layerCapital(2) == null && dbSaved > 0 ? dbSaved : layerCapital(id)
  const periodText = (person: Scope, layer: number) => [...new Set(streams(data, person, layer).map(s => s.layer === 1 ? `${s.start_age}세부터 종신` : s.payout_years == null ? '수령 기간 확인 필요' : `${s.start_age}세부터 ${s.end_age_exclusive}세 직전까지 · ${s.payout_years}년 수령`))].join(' / ')
  return <div className={`tower-workspace${embedded ? ' tower-embedded' : ''}`}>
    <div className="tower-intro"><h1>우리의 연금, 차곡차곡.</h1>
      <div className="tower-intro-actions"><div className="tower-toolbar"><button onClick={() => setProfileOpen(true)}>내 정보</button><button onClick={() => hasPerson ? setEditor('timing') : setProfileOpen(true)}>은퇴·수령 시점</button><button onClick={() => setEditor('assumptions')}><Settings2 size={14}/>계산 가정</button></div>
      <div className="tower-scope" role="group" aria-label="연금 조회 범위">{([['together', '우리 함께'], ['me', '나'], ['partner', '배우자']] as const).map(([key, label]) => <button key={key} aria-pressed={owner === key} onClick={() => onOwnerChange(key)}>{label}</button>)}</div></div>
    </div>
    {(error || data.error || missing.length > 0) && <div className="tower-alert" role="alert"><Info size={18}/><div><strong>{error || data.error || `먼저 확인해 주세요: ${missing.join(', ')}`}</strong>{partial && data.projection && <p>입력이 있는 사람만 계산했습니다. 가족 정보를 채우기 전에는 생활비 충당 여부를 표시하지 않아요.</p>}</div><Button variant="outline" size="sm" onClick={error ? reload : data.error ? () => setEditor('timing') : () => setProfileOpen(true)}>{error ? '새로고침' : data.error ? '수령 시점 수정' : '내 정보 입력'}</Button></div>}
    <section className="tower-hero" aria-label="우리집 4층 연금탑">
      <div className="tower-tower-card"><div className="tower-tower-heading"><div><h2>쌓인 돈이, 매달의 연금으로.</h2><span>{row ? `${year}년 월 연금` : scopeLabel} · 세전 · 오늘의 돈</span></div>
        <div className="tower-capital-total"><Coins size={16} className="tower-capital-icon"/><small>지금 모인 돈 · 2–4층</small><strong data-testid="pension-capital" data-won={hidden ? undefined : saved ?? undefined}>{saved == null ? hidden ? '••••••' : '등록 내역 없음' : `${monthly(saved)}만 원`}</strong>{dbSaved > 0 && <span className="tower-db-separate">DB 퇴직금 <b>{monthly(dbSaved)}만 원</b> 별도</span>}</div></div>
        <div className="tower-tower-view"><figure className="tower-sculpture"><Pagoda selected={selected} onSelect={setSelected} hidden={hidden} states={LAYERS.map(l => ({ label: `${l.name}, ${layerText(l.id)}`, empty: !hasCapital(l.id) && !streams(data, owner, l.id).length, funded: hasCapital(l.id), share: share(l.id), inactive: !hasCapital(l.id) && !currentYearText(l.id) }))}/><figcaption><MousePointer2 size={13}/>각 층을 눌러 살펴보세요</figcaption></figure>
          <div className="tower-layers" role="group" aria-label="연금층 선택">{[...LAYERS].reverse().map(l => <button className="tower-layer-button" key={l.id} aria-pressed={selected === l.id} onClick={() => setSelected(l.id)} aria-label={`${l.id}층 ${l.name} 살펴보기`}>
            <span className="tower-layer-name"><i style={{ background: `var(--tower-layer-${l.id})` }}/><small>{l.id}층</small>{l.name}<ChevronRight size={13}/></span>
            <span className="tower-layer-principal"><span className={`tower-layer-amount${l.id === 1 && !currentYearText(1) ? ' is-muted' : ''}`} data-testid={`layer-capital-${l.id}`} data-won={hidden || l.id === 1 ? undefined : capitalAmount(l.id) ?? undefined}>{l.id === 1 ? layerText(1) : capitalAmount(l.id) == null ? hidden ? '••••••' : '등록 내역 없음' : `${monthly(capitalAmount(l.id))}만 원`}</span><span className="tower-layer-caption">{l.id === 1 ? '월 연금 · 오늘 돈' : capitalLabel(l.id)}</span>{l.id === 2 && layerCapital(2) != null && dbSaved > 0 && <span className="tower-layer-caption">DB {monthly(dbSaved)}만 원 별도</span>}</span>
            <span className="tower-layer-projection">{l.id !== 1 && <span className="tower-layer-income"><ArrowRight size={12}/>{l.id === 4 ? '수령 계산 미연결' : layerText(l.id)}</span>}

            {l.id > 1 && l.id < 4 && scopedStreams.some(s => s.layer === l.id) && <span className="tower-layer-period">{activePeople.map(([who, label]) => { const periods = streams(data, who, l.id).map(s => s.payout_years).filter((v): v is number => v != null); return periods.length ? `${label} ${[...new Set(periods)].join('·')}년 수령` : '' }).filter(Boolean).join(' · ')}</span>}</span>
            <span className="tower-layer-gauge" aria-label={hidden ? '금액 숨김' : share(l.id) == null ? '생활비 기여율 계산 전' : `목표 생활비의 ${percent(share(l.id)!)}% 담당`}><span className="tower-layer-track"><i style={{ width: `${hidden ? 0 : Math.min(100, share(l.id) ?? 0)}%`, background: `var(--tower-fill-${l.id})` }}/></span><span>{hidden ? '•••' : share(l.id) != null ? <>생활비의 <b>{percent(share(l.id)!)}%</b></> : l.id === 4 ? '월 연금 연결 전' : owner !== 'together' ? '기여율은 함께 보기에서' : partial ? '가족 정보 확인 필요' : data.plan.monthly_need == null || data.plan.monthly_need === 0 ? '생활비 목표 설정 필요' : !row?.retired ? '은퇴 전' : '연금 정보 확인 필요'}</span></span>
          </button>)}</div>
        </div>
      </div>
      <aside className="tower-summary" aria-label="선택 연도의 연금 요약"><div className="tower-summary-kicker"><i/>{scopeLabel} · {row ? `${year}년` : '계산 전'}</div><p className="tower-summary-ages">{ageLabel}</p><div className="tower-total"><small>월</small><strong data-testid="pension-total" data-won={hidden ? undefined : total ?? undefined}>{monthly(total)}</strong><small>만 원</small></div><p className="tower-summary-note">{partial ? '계산 가능한 가족의 연금만 포함' : '입력된 연금 기준 · 세전 / 오늘의 돈'}</p>
        <div className="tower-coverage">{pct != null && !hidden && <div className="tower-coverage-track" aria-hidden="true">{LAYERS.slice(0, 3).map(l => <i key={l.id} style={{ width: `${(amount(row, owner, l.id) ?? 0) / Math.max(1, total ?? 0, need ?? 0) * 100}%`, background: `var(--tower-layer-${l.id})` }}/>)}</div>}
          <div className="tower-coverage-label"><button onClick={() => setEditor('goal')}><span>{owner !== 'together' ? '부부 생활비' : '생활비 · 오늘 돈'} {data.plan.monthly_need == null ? '입력하기' : money(data.plan.monthly_need)}</span><Settings2 size={12}/></button>{pct != null && <span>{hidden ? '•••' : percent(pct)}% 충당</span>}</div></div>
        <div className="tower-gap"><h3>{!ready ? '연금 정보를 채워 주세요.' : partial ? '가족 정보를 먼저 채워 주세요.' : owner !== 'together' ? '각자의 준비를 함께 살펴요.' : !row?.retired ? '은퇴 전 수령하는 금액이에요.' : gap == null ? '바라는 한 달을 정해 볼까요?' : gap < 0 ? <>생활비까지<br/><em>월 {monthly(-gap)}만 원</em>이 더 필요해요.</> : <>입력된 연금으로<br/><em>{gap === 0 ? '생활비를 채우고 있어요.' : `월 ${monthly(gap)}만 원의 여유가 있어요.`}</em></>}</h3>{(!ready || owner !== 'together' || gap == null) && <p>{!ready ? '국민연금 예상액과 퇴직금, 연금저축 납입 계획을 알려 주세요.' : owner !== 'together' ? '생활비는 부부의 합계와 비교해요. 우리 함께 보기에서 확인하세요.' : gap != null ? '수령 시점에 따라 달라져요. 다른 나이의 흐름도 함께 살펴보세요.' : '은퇴 후 부부가 필요한 월 생활비를 입력하면 연금과 비교할 수 있어요.'}</p>}
          <button className="tower-summary-action" onClick={() => !hasPerson ? setProfileOpen(true) : !hasInputs ? setEditor(1) : owner !== 'together' ? onOwnerChange('together') : setEditor('goal')}>{!hasPerson ? '내 정보 입력하기' : !hasInputs ? '연금 정보 입력하기' : owner !== 'together' ? '우리 함께 보기' : '생활비 목표 바꾸기'}<ArrowRight size={15}/></button></div>
        {need != null && row?.need_nominal != null && <div className="tower-nominal-summary" aria-label="선택 연도의 명목 금액 비교"><small>{year}년 그해의 돈으로 보면</small><div><span>월 연금 · 세전</span><b data-testid="selected-nominal-income" data-won={hidden ? undefined : row.total_nominal}>{monthly(row.total_nominal)}만 원</b></div><div><span>필요한 월 생활비</span><b data-testid="selected-nominal-need" data-won={hidden ? undefined : row.need_nominal}>{monthly(row.need_nominal)}만 원</b></div></div>}
        <p className="tower-excluded">4층 추가연금은 월 수령 합계에서 제외</p>
      </aside>
    </section>
    <section className="tower-detail" aria-labelledby={`${uid}-detail`}><div className="tower-detail-heading"><span className="tower-detail-icon"><Icon size={20}/></span><div><h2 id={`${uid}-detail`}>{selected}층 · {currentLayer.name}</h2><p>{currentLayer.description}</p></div></div>
      <div className="tower-members">{activePeople.length ? activePeople.map(([who, label]) => <div className="tower-member" key={who}>
        <small>{label} · {selected === 1 ? `${year}년 월 연금 · 오늘 돈` : '현재 계좌 적립금'}</small>
        <strong>{error ? '확인 필요' : selected === 1 ? !data.projection || !streams(data, who, 1).length ? '계산 전' : money(amount(row, who, 1)) : capital(data, who, selected) == null ? '등록 내역 없음' : money(capital(data, who, selected))}</strong>
        {selected === 2 && !error && accruedDb(data, who) > 0 && <span>현재 DB 퇴직금 {money(accruedDb(data, who))} 별도</span>}
        {selected > 1 && selected < 4 && <span className="tower-member-payout">→ {year}년 월 {error || !streams(data, who, selected).length ? '계산 전' : money(amount(row, who, selected))} · 오늘 돈</span>}
        <span>{selected === 4 ? '수령 계산 미연결' : periodText(who, selected) || '준비 정보를 입력해 주세요'}</span>
        {selected === 1 && <span>화면 계산은 {data.assumptions.end_age}세 직전까지</span>}
      </div>) : <p className="tower-muted">나이와 은퇴 목표를 입력하면 각자의 계획을 볼 수 있어요.</p>}</div>
      <Button variant="outline" onClick={() => selected === 4 ? onAssets() : !hasPerson ? setProfileOpen(true) : setEditor(selected as Editor)} aria-label={selected === 4 ? '추가 자금 자산 보기' : `${currentLayer.name} 입력하기`}><Settings2 size={14}/>{selected === 4 ? '자산에서 확인' : '입력·수정하기'}</Button>
      {selected === 4 && <p className="tower-detail-note"><Info size={15}/>추가연금은 별도 연금 제도가 아닌 추가 준비 자금이에요. 현재는 등록한 금액만 보여주며, 월 수령액으로 전환하는 계산은 아직 연결되지 않았어요.</p>}
      {selected !== 4 && currentStatus === '준비 정보 없음' && <p className="tower-detail-note">정보가 없다는 뜻이며, 실제 받을 연금이 0원이라는 뜻은 아니에요.</p>}
    </section>
    <SpendingGoal data={data} hidden={hidden} error={error} onGoal={() => setEditor('goal')} onAssumptions={() => setEditor('assumptions')} onTiming={() => { if (data.used.me) { setEditorScope('me'); setEditor('timing') } else setProfileOpen(true) }}/>
    <section className="tower-flow" id={`${uid}-flow`} aria-labelledby={`${uid}-flow-title`}><div className="tower-section-heading"><div><h2 id={`${uid}-flow-title`}>탑은 하나, 받는 시간은 다르게.</h2><p>연도를 움직여 두 사람의 나이와 월 연금을 함께 살펴보세요.</p></div><strong>{row ? `${year}년` : '계산 전'}</strong></div>
      {row && hasInputs && !error ? <div className="tower-timeline"><div className="tower-year-control"><label htmlFor={`${uid}-year`}>{ageLabel}</label><input id={`${uid}-year`} aria-label="살펴보는 연도" type="range" min={firstYear} max={lastYear} step={1} value={year} disabled={firstYear === lastYear} aria-valuetext={`${year}년, ${ageLabel}${hidden ? '' : `, 월 ${monthly(total)}만 원`}`} onChange={e => setChosenYear(Number(e.target.value))}/><div className="tower-year-ticks"><span>{firstYear}</span><span>{Math.round((firstYear + lastYear) / 2)}</span><span>{lastYear}</span></div></div>
        <div className="tower-time-rows">{LAYERS.map(l => <div className="tower-time-row" key={l.id}><button onClick={() => setSelected(l.id)}><i style={{ background: `var(--tower-layer-${l.id})` }}/>{l.name}</button><div className="tower-time-lanes">{l.id === 4 ? <div className="tower-band-empty">수령 계산 미연결</div> : activePeople.map(([who, label]) => {
          const personStreams = streams(data, who, l.id)
          if (!personStreams.length) return <div className="tower-band-empty" key={who}>{label} · 준비 정보 없음</div>
          const start = Math.min(...personStreams.map(s => s.start_year)), end = data.base_year + data.assumptions.end_age - data.used[who]!.age
          return <div className="tower-band-track" key={who}><span className="tower-band" style={{ left: `${scale(start)}%`, width: `${Math.max(0, scale(end) - scale(start))}%`, background: `var(--tower-layer-${l.id})` }} title={`${label} ${l.name}: ${personStreams.map(s => `${s.label} ${s.start_year}년부터`).join(', ')}${l.id === 1 ? ' (끝은 계산 범위)' : ''}`}><span>{label}</span><small>{start}년부터{l.id === 1 ? ' · 계산 범위까지' : ''}</small></span></div>
        })}<i className="tower-year-cursor" aria-hidden="true" style={{ left: `${scale(year)}%` }}/></div></div>)}</div>
        <div className="tower-milestones">{milestones.map(y => <button key={y} aria-pressed={year === y} onClick={() => setChosenYear(y)}>{y}년 · {y === defaultYear ? '은퇴 첫해' : y === lastYear ? '계산 마지막 해' : [...new Set(scopedStreams.filter(s => s.start_year === y).map(s => s.label.replace(/\(.+\)/, '')))].join('·') + ' 시작'}</button>)}</div>
        <p className="tower-flow-note"><Info size={16}/>국민연금 막대의 오른쪽 끝은 계산 범위이며 수령 종료가 아니에요. 가족의 계산 기간이 모두 겹치는 범위만 함께 보여줍니다.</p>
      </div> : <div className="tower-flow-empty"><Sprout size={24}/><p>{data.error ? '수령 시점의 입력 오류를 수정하면 시간표를 볼 수 있어요.' : '가족 정보와 연금 계획이 준비되면 수령 시간표가 나타나요.'}</p><Button variant="outline" onClick={() => !hasPerson ? setProfileOpen(true) : setEditor(data.error ? 'timing' : 1)}>{!hasPerson ? '내 정보 입력' : '연금 정보 입력'}</Button></div>}
    </section>
    <div className="tower-assumptions-summary"><div><strong>이렇게 계산했어요</strong><button onClick={() => setEditor('assumptions')}>가정 수정<Settings2 size={13}/></button></div><p>연 수익률 {(data.assumptions.return_rate * 100).toFixed(1)}% · 물가 {(data.assumptions.inflation * 100).toFixed(1)}%</p>
      <ul>{scopedStreams.filter(s => s.layer > 1).map((s, i) => <li key={i}><span>{s.person === 'me' ? '나' : '배우자'} · {s.label}</span><strong>{s.start_age}세부터 {s.end_age_exclusive}세 직전까지, 총 {s.payout_years}년 수령</strong></li>)}</ul>
      <p>국민연금은 종신 · 화면 계산은 {data.assumptions.end_age}세 직전까지. 세금·수령한도·추가연금은 반영하지 않았어요.</p>
    </div>
    <div className="tower-footnote"><p>층별 게이지 = 해당 층의 월 연금 ÷ 목표 월 생활비. 각 층이 생활비에서 담당하는 몫이며, 층마다 100%를 채우는 목표가 아닙니다. 현재 적립금에는 앞으로 넣을 돈과 예상 수익을 더하지 않았어요.</p><p>예측이 아닌 입력한 가정의 계산 결과입니다. 석가탑을 재해석한 조형과 동전 개수는 금액 비중이 아니며, 기여율은 게이지와 숫자로 확인해 주세요.</p></div>
    {details && <details className="tower-sheet-detail"><summary>입력값·연도별 계산을 표로 보기<ChevronDown size={16}/></summary><div className="tower-sheet-grid">{details}</div></details>}
    {editor !== null && <PlanDialog data={data} scope={editorScope ?? owner} section={editor} save={save} close={() => { setEditor(null); setEditorScope(null) }}/>}
    {profileOpen && <RetirementProfile close={() => setProfileOpen(false)} onSaved={() => { setProfileOpen(false); reload(); onProfileChanged?.() }}/>}
  </div>
}

function RetirementProfile({ close, onSaved }: { close: () => void; onSaved: () => void }) {
  const [family, setFamily] = useState<Family | null | undefined>()
  const [error, setError] = useState('')
  useEffect(() => { const controller = new AbortController(); api<Family | null>('/family', 'GET', undefined, controller.signal).then(setFamily).catch(e => { if (!controller.signal.aborted) setError(e.message) }); return () => controller.abort() }, [])
  return <Dialog open onOpenChange={open => { if (!open) close() }}><DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>내 정보 · 배우자 정보</DialogTitle><DialogDescription>각자의 나이와 은퇴 목표를 알려 주세요.</DialogDescription></DialogHeader>{error ? <p role="alert">{error}</p> : family === undefined ? <p>불러오는 중…</p> : <ProfileForm family={family} onSaved={onSaved}/>}</DialogContent></Dialog>
}
