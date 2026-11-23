import { NativeSelect } from '../components/ui/native-select'
import { Input } from '../components/ui/input'
import { useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw, Settings2 } from 'lucide-react'
import { Modal } from '../components'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { money, type Owner } from '../model'
import { api } from '../local-data'
import type { HomeList } from '../property-entry'
import { CandidateForm } from './Forms'
import { NearbyPlaces, useRead, type Watch } from './ObservationBoard'
import { emptyLiving, type Candidate, type Capital, type Monthly, type MoveState } from './types'
import './research-board.css'
import { InterestMap } from './InterestMap'
import { PirBadge } from './Pir'
import { CandidateUpdates } from './CandidateUpdates'

export function CapitalStrip({ capital, hidden, onManage }: { capital?: Capital; hidden: boolean; onManage: () => void }) {
  const show = (n?: number) => hidden ? '••••' : n == null ? '—' : money(n)
  return <section className="research-capital" aria-label="부동산과 현금 합계">
    <div><span>부동산 순자산 + 보유 현금</span><strong>{capital?.valuation_missing ? '시세 확인 필요' : show(capital?.net)}</strong><small>등록 시세 기준 · 매도세금·비용 차감 전</small></div>
    <dl>{[['부동산', capital?.value], ['대출·보증금', capital ? capital.loans + capital.deposit : undefined], ['보유 현금', capital?.cash]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{show(value as number | undefined)}</dd></div>)}</dl>
    <Button variant="outline" onClick={onManage}><Settings2 size={15}/>자금 계획</Button>
  </section>
}
const district = (c: Candidate) => c.address?.jibun.match(/(?:^|\s)(\S+구)(?:\s|$)/)?.[1] ?? '지역 미등록'
function Check({ checked, partial, label, onChange }: { checked: boolean; partial?: boolean; label: string; onChange: (checked: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!partial }, [partial])
  return <label><input ref={ref} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/>{label}</label>
}

export function ResearchBoard({ owner, hidden, onManage, initialFocus = '' }: { owner: Owner; hidden: boolean; onManage: () => void; initialFocus?: string }) {
  const [revision, setRevision] = useState(0)
  const chartRef = useRef<HTMLElement>(null)
  const [chartWidth, setChartWidth] = useState(760)
  const state = useRead<MoveState>(`/property-move?owner=${owner}`, revision, true, true)
  const watch = useRead<Watch>(`/property-move/watch?owner=${owner}`, revision)
  const homes = useRead<HomeList>(`/property?owner=${owner}`, revision)
  const [selection, setSelection] = useState<Set<string> | null>(null)
  const [focus, setFocus] = useState(initialFocus)
  const [baseId, setBaseId] = useState('')
  const [query, setQuery] = useState('')
  const [areas, setAreas] = useState<Record<string, number>>({})
  const [mode, setMode] = useState<'price' | 'index' | 'gap'>('price')
  const [period, setPeriod] = useState(12)
  const [edit, setEdit] = useState<Candidate | 'new' | null>(null)
  const data = state.data
  useEffect(() => {
    const el = chartRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setChartWidth(Math.max(250, entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [state.loading])
  const candidates = data?.plan.candidates ?? []
  const selected = candidates.filter(c => selection === null || selection.has(c.id))
  const active = selected.find(c => c.id === focus) ?? selected[0]
  const home = homes.data?.homes.find(h => h.asset.id === baseId) ?? homes.data?.homes.find(h => h.detail?.tenure === 'live') ?? homes.data?.homes[0]
  const address = home?.detail?.address
  const params = new URLSearchParams({ sigungu: address?.sigungu_code ?? '', name: address?.building || home?.asset.name || '', area: String(home?.detail?.area_m2 ?? ''), jibun: address?.jibun ?? '' })
  const baseline = useRead<{ configured: boolean; monthly?: Monthly[] }>(`/property/trades?${params}`, revision, !!address?.sigungu_code && !!home?.detail?.area_m2)
  const allIds = () => new Set(candidates.map(c => c.id))
  function toggle(ids: string[], checked: boolean) { setSelection(old => { const next = new Set(old ?? allIds()); ids.forEach(id => checked ? next.add(id) : next.delete(id)); return next }) }
  const areaFor = (c: Candidate) => areas[c.id] ?? (c.area_m2 == null ? null : Math.floor(c.area_m2))
  const resultFor = (c: Candidate) => watch.data?.watch.find(w => w.id === c.id)
  const areaData = (c: Candidate) => resultFor(c)?.summary?.areas.find(a => a.area === areaFor(c))
  const show = (n: number | null | undefined) => hidden ? '••••' : n == null ? '—' : money(n)
  const now = new Date()
  const months = Array.from({ length: period }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - period + 1 + i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` })
  const baseSeries = months.map(m => baseline.data?.monthly?.find(v => v.month === m)?.median ?? null)
  const series = [
    ...(home ? [{ id: 'baseline', name: home.asset.name, values: baseSeries, color: '#64748b' }] : []),
    ...selected.map(c => ({ id: c.id, name: `${c.name} · ${areaFor(c)}㎡`, values: months.map(m => areaData(c)?.monthly?.find(v => v.month === m)?.median ?? null), color: c.id === active?.id ? '#3d50c7' : district(c) === '서초구' ? '#087b75' : '#6083ad' })),
  ].map(s => ({ ...s, values: s.values.map((v, i) => v == null ? null : mode === 'index' ? s.values[0] == null ? null : v / s.values[0] * 100 : mode === 'gap' ? baseSeries[i] == null ? null : v - baseSeries[i] : v) }))
  const values = series.flatMap(s => s.values.filter((v): v is number => v != null))
  const low = Math.min(...values), high = Math.max(...values)
  const pad = Math.max((high - low) * .12, mode === 'index' ? 1 : 10_000_000)
  const y = (v: number) => 220 - (v - low + pad) / (high - low + pad * 2) * 180
  const x = (i: number) => 62 + i / (period - 1) * (chartWidth - 84)
  // Duplicate saved candidates for the same physical unit must not multiply counts.
  const unique = new Map(selected.map(c => [JSON.stringify([c.address?.sigungu_code, c.members ?? [[c.address?.building || c.name, c.address?.jibun]], areaFor(c)]), c]))
  const counted = [...unique.values()].filter(c => resultFor(c)?.summary != null && areaFor(c) != null && areaFor(c)! <= (watch.data?.large_area_m2 ?? 135) && (!areaData(c) || areaData(c)?.monthly != null))
  const volumes = months.map(m => counted.reduce((n, c) => n + (areaData(c)?.monthly?.find(v => v.month === m)?.count ?? 0), 0))
  const maxVolume = Math.max(1, ...volumes)
  const groups = [...new Set(candidates.map(district))].sort((a,b) => a.localeCompare(b, 'ko'))
  const filtered = candidates.filter(c => `${c.name}${c.address?.jibun ?? ''}`.replaceAll(' ', '').includes(query.replaceAll(' ', '')))
  if (state.loading && !data) return <p role="status">관심 단지 불러오는 중…</p>
  if (!data || state.error) return <div role="alert">관심 단지를 불러오지 못했어요. <Button onClick={() => setRevision(v => v + 1)}>다시 조회</Button></div>
  return <div className="property-research">
    <header className="research-heading"><div><h2>관심 단지 <small>{candidates.length}</small></h2></div><div className="research-heading-actions"><Button disabled={candidates.length >= 50} onClick={() => setEdit('new')}><Plus size={16}/>단지 추가</Button></div></header>
    <div className="research-selection"><div className="research-toolbar"><span className="research-selection-count">{selected.length}개 비교 중</span><div><Button variant="ghost" size="sm" onClick={() => setSelection(allIds())}>전체 표시</Button><Button variant="ghost" size="sm" onClick={() => setSelection(new Set())}>전체 제외</Button></div></div>
      <div className="research-districts">{groups.map(g => { const list = candidates.filter(c => district(c) === g); const n = list.filter(c => selected.includes(c)).length; return <div key={g}><Check checked={n === list.length} partial={n > 0 && n < list.length} label={`${g} · ${n}/${list.length}`} onChange={checked => toggle(list.map(c => c.id), checked)}/><details><summary>단지별 선택</summary>{list.map(c => <Check key={c.id} checked={selected.includes(c)} label={`${c.name} · ${c.area_m2 ?? '—'}㎡`} onChange={v => toggle([c.id], v)}/>)}</details></div> })}</div>
      {!candidates.length && <p>관심 단지를 추가하면 가격 흐름을 함께 비교할 수 있어요.</p>}
    </div>
    <InterestMap fitCandidates districtControls hidden={hidden} prices={Object.fromEntries(selected.map(c=>[c.id,{price:watch.error||watch.loading?undefined:areaData(c)?.latest.price,date:areaData(c)?.latest.date,area:areaFor(c),pir:watch.loading||watch.error?undefined:areaData(c)?.pir,status:watch.loading?'조회 중':watch.error?'조회 실패':'실거래 없음'}]))} owner={owner} candidates={selected} activeId={active?.id} onSelect={setFocus} revision={revision}/><div className="research-workbench"><div className="research-visuals"><section className="research-chart" ref={chartRef}>
      <h3 className="research-chart-title">가격과 거래량</h3>
      <div className="research-chart-controls">
        <div className="research-chart-modes" role="group" aria-label="가격 표시 방식">{([['price','가격'],['index','시작점 100'],['gap','내 집과 차액']] as const).map(([id,label]) => <Button key={id} variant={mode === id ? 'secondary' : 'ghost'} aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</Button>)}</div>
        <div className="research-chart-filters">
          <div className="research-chart-field"><span id="research-home-label">비교 기준 집</span><Select value={home?.asset.id ?? ''} onValueChange={setBaseId} disabled={!homes.data?.homes.length}><SelectTrigger aria-labelledby="research-home-label"><SelectValue placeholder="등록한 집 없음"/></SelectTrigger><SelectContent>{homes.data?.homes.map(h => <SelectItem value={h.asset.id} key={h.asset.id}>{h.asset.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="research-chart-field"><span id="research-period-label">조회 기간</span><Select value={String(period)} onValueChange={value => setPeriod(Number(value))}><SelectTrigger aria-labelledby="research-period-label"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="6">최근 6개월</SelectItem><SelectItem value="12">최근 12개월</SelectItem></SelectContent></Select></div>
        </div>
      </div>
      <div className="research-legend" role="group" aria-label="비교 단지 범례" tabIndex={0}>{series.map(s => <button key={s.id} disabled={s.id === 'baseline'} aria-pressed={s.id === active?.id} onClick={() => setFocus(s.id)}><i style={{ background: s.color }}/>{s.name}{s.id === 'baseline' ? baseline.loading ? ' · 조회 중' : baseline.error ? ' · 조회 실패' : ' · 기준' : ''}</button>)}</div>
      {hidden ? <p className="research-empty">금액 숨김 상태입니다.</p> : watch.loading ? <p className="research-empty" role="status">월별 거래 자료 조회 중…</p> : watch.error ? <p className="research-empty" role="alert">실거래 조회 실패 <Button onClick={() => setRevision(v => v+1)}>다시 조회</Button></p> : !watch.data?.configured ? <p className="research-empty">실거래 연결이 필요합니다. <Button variant="outline" onClick={onManage}>연결 설정</Button></p> : <>
        {!values.length && <p className="research-empty">{mode === 'index' ? '시작월에 거래가 있는 단지를 선택해 주세요.' : mode === 'gap' ? '기준 집과 같은 달의 거래가 필요해요.' : '선택한 단지·평형의 거래 자료가 없습니다.'}</p>}
        <div className="research-chart-scroll"><svg viewBox={`0 0 ${chartWidth} 350`} role="img" aria-label="관심 단지 월별 가격과 합산 거래량">
          {values.length > 0 && [0, .5, 1].map(t => { const v = low + (high-low)*t; return <g key={t}><path d={`M62 ${y(v)}H${chartWidth-22}`} stroke="#dce2ec"/><text x="52" y={y(v)+4} textAnchor="end">{mode === 'index' ? v.toFixed(0) : `${(v/1e8).toFixed(1)}억`}</text></g> })}
          {series.map(s => { let drawing = false; const path = s.values.map((v,i) => { if(v==null) {drawing=false;return ''} const cmd=drawing?'L':'M';drawing=true;return `${cmd}${x(i)},${y(v)}` }).join(' '); return <g key={s.id} opacity={s.id === active?.id || s.id === 'baseline' ? 1 : .4}><path d={path} stroke={s.color} strokeWidth={s.id === active?.id?3:2} strokeDasharray={s.id==='baseline'?'5 4':undefined} fill="none"/>{s.values.map((v,i) => v==null?null:<circle key={i} cx={x(i)} cy={y(v)} r={s.id===active?.id?4:2.5} fill={s.color}><title>{s.name} · {months[i]} · {mode==='index'?v.toFixed(1):money(v)}</title></circle>)}</g> })}
          <text x="62" y="253">합산 거래량 · {counted.length}개 단지·평형{counted.length<unique.size?' (일부 자료 미확인)':''}</text>
          {months.map((m,i) => <g key={m}>{counted.length>0 && <><rect x={x(i)-10} y={310-volumes[i]/maxVolume*38} width="20" height={volumes[i]/maxVolume*38} rx="2" fill="#a8b4dc"/><text x={x(i)} y={303-volumes[i]/maxVolume*38} textAnchor="middle">{volumes[i] || ''}</text></>}{(chartWidth >= 500 || period === 6 || i % 2 === 1) && <text x={x(i)} y="332" textAnchor="middle">{m.slice(2).replace('-','.')}</text>}</g>)}
        </svg></div>
        <div className="research-caption">계약월 기준 · 월 중간값 · 이번 달 집계 중{baseline.error ? ' · 기준 집 조회 실패' : ''}</div>
        <details className="research-data"><summary>월별 수치·출처</summary><p>국토교통부 조회 거래 기준. 관심 단지는 전용면적 정수 구간, 기준 집은 등록 면적 ±2㎡로 집계합니다. 거래 없는 달은 연결하지 않습니다. 매일 자동 수집은 연결 전입니다.</p><div className="research-table-scroll"><table><thead><tr><th>계약월</th>{series.map(s=><th key={s.id}>{s.name}</th>)}<th>합산 거래</th></tr></thead><tbody>{months.map((m,i)=><tr key={m}><th>{m}</th>{series.map(s=><td key={s.id}>{s.values[i]==null?'—':mode==='index'?s.values[i]!.toFixed(1):money(s.values[i]!)}</td>)}<td>{counted.length?`${volumes[i]}건`:'미확인'}</td></tr>)}</tbody></table></div></details>
      </>}
    </section></div><aside className="research-insight"><h3>{active?.name ?? '비교 단지 선택'}</h3><p>{active ? `전용 ${areaFor(active) ?? '—'}㎡대 · ${district(active)}` : '구 또는 단지를 체크해 주세요.'}</p>{active && <><dl><div><dt>최근 실거래</dt><dd>{show(areaData(active)?.latest.price)}</dd><small>{areaData(active)?.latest.date ?? resultFor(active)?.missing}</small></div><div><dt>기록 호가</dt><dd>{show(areaFor(active)===Math.floor(active.area_m2 ?? -1)?active.asking_low:null)}</dd></div><div><dt>조회 거래</dt><dd>{watch.loading?'조회 중':areaData(active)?`${areaData(active)!.count}건`:'—'}</dd></div></dl>{!hidden && active.memo && <p>{active.memo}</p>}<div className="research-needed-detail"><span>추가 필요 · 실거래 기준</span><strong>{show(watch.loading||watch.error?null:areaData(active)?.funding?.needed)}</strong></div><PirBadge value={watch.loading||watch.error?undefined:areaData(active)?.pir} hidden={hidden}/><Button variant="outline" onClick={() => setEdit(active)}>단지 정보 수정</Button><CandidateUpdates key={active.id} candidate={active} area={areaFor(active)} hidden={hidden} track={data.track[active.id] ?? []} onEdit={() => setEdit(active)}/><details><summary>생활 입지</summary><NearbyPlaces owner={owner} id={active.id}/></details></>}</aside></div>
    <section className="research-list"><div className="research-toolbar"><h3>관심 단지 {candidates.length}</h3><div><Input aria-label="관심 단지 검색" type="search" placeholder="단지·지역 검색" value={query} onChange={e=>setQuery(e.target.value)}/><Button aria-label="관심 단지 새로고침" variant="ghost" disabled={watch.loading} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16}/></Button></div></div>
      <div className="research-table-scroll"><table><thead><tr><th>표시</th><th>단지</th><th>평형</th><th>최근 실거래</th><th>기록 호가</th><th>추가 필요 · 실거래 기준</th><th>부부 소득 대비</th><th>거래 수</th><th>관리</th></tr></thead>{groups.map(g=><tbody key={g}>{filtered.some(c=>district(c)===g) && <tr className="research-group-row"><th colSpan={9}>{g}</th></tr>}{filtered.filter(c=>district(c)===g).map(c=>{const a=areaData(c);return <tr key={c.id} className={active?.id===c.id?'is-active':''}><td><input type="checkbox" aria-label={`${c.name} 차트 표시`} checked={selected.includes(c)} onChange={e=>toggle([c.id],e.target.checked)}/></td><th><button onClick={()=>{toggle([c.id],true);setFocus(c.id)}}>{c.name}</button></th><td><NativeSelect aria-label={`${c.name} 비교 평형`} value={areaFor(c)??''} onChange={e=>setAreas(old=>({...old,[c.id]:Number(e.target.value)}))}><option value={areaFor(c)??''}>{areaFor(c)==null?'평형 선택':`${areaFor(c)}㎡대`}</option>{resultFor(c)?.summary?.areas.filter(a=>a.area!==areaFor(c)).map(a=><option key={a.area} value={a.area}>{a.area}㎡대</option>)}</NativeSelect></td><td>{show(a?.latest.price)}<small>{a?.latest.date}</small></td><td>{show(areaFor(c)===Math.floor(c.area_m2??-1)?c.asking_low:null)}</td><td className="research-needed">{show(watch.loading||watch.error?null:a?.funding?.needed)}</td><td><PirBadge value={watch.loading||watch.error?undefined:a?.pir} hidden={hidden}/></td><td>{a?`${a.count}건`:'—'}</td><td><Button variant="ghost" size="sm" onClick={()=>setEdit(c)}>수정</Button></td></tr>})}</tbody>)}</table></div>{!filtered.length && <p className="research-empty">{query?'검색 결과가 없습니다.':'관심 단지를 추가해 주세요.'}</p>}
    </section>

    {edit && <Modal title={edit==='new'?'관심 단지 추가':'관심 단지 수정'} onClose={()=>setEdit(null)}><CandidateForm initial={edit==='new'?undefined:{...edit,living:{...emptyLiving(),...edit.living}}} onSave={async additions=>{const next=edit==='new'?[...candidates,...additions]:[...candidates.filter(old=>old.id!==edit.id),...additions];if(next.length>50)throw new Error('관심 평형은 최대 50개까지 등록할 수 있어요.');await api(`/property-move?owner=${owner}`,'PUT',{...data.plan,candidates:next});if(edit==='new'){setSelection(old=>old?new Set([...old,...additions.map(c=>c.id)]):old);setFocus(additions[0].id)}setEdit(null);setRevision(v=>v+1)}} onDelete={edit==='new'?undefined:async()=>{await api(`/property-move?owner=${owner}`,'PUT',{...data.plan,candidates:candidates.filter(c=>c.id!==edit.id),target_id:data.plan.target_id===edit.id?null:data.plan.target_id});setEdit(null);setRevision(v=>v+1)}}/></Modal>}
  </div>
}
