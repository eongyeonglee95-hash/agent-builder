import { NativeSelect } from '../components/ui/native-select'
import { PirBadge } from './Pir'
import { eok } from '../lib/format'
import { CandidateOrb } from '../components/ui/candidate-orb'
import { openPropertyMenu } from '../property-observatory'
import { useState, useRef, type ReactNode } from 'react'
import { Sparkles, Plus } from 'lucide-react'
import { Button } from '../components/ui/button'
import { api } from '../local-data'
import { money, type Owner } from '../model'
import type { HomeList } from '../property-entry'
import type { Candidate, PirResult } from './types'
type Claim={text:string;source_url:string;kind:string;date:string}
type Item = {build_year?:number|null;age_years?:number|null;households?:{count:number;source_url:string;evidence_quote:string}|null;analysis_date?:string;spotlight?:boolean;point?:{lat:number;lng:number;approx?:boolean}|null;id:string;name:string;district:string;area:number;price:number;date:string;count:number;funding:{needed:number};pir:PirResult;reason?:string;check?:string;pros?:Claim[];cons?:Claim[];popularity?:Claim[];home_gap?:number;relative?:{peer_count:number;median:number|null;discount_pct:number|null;month:string;peers:{name:string;median:number}[]};candidate:Candidate}
export type DiscoveryResult = {cached_count?:number;available_capital?:number;items:Item[];total:number;as_of:string;months:number;area_min:number;area_max:number;missing:string[];ai_status:string;ai_error:string|null;source_url:string;baseline?:{id?:string;name:string;value:number;date:string};research_error?:string;verified_claims?:number;research_failures?:{id:string;name:string;message:string}[]}
export function Discovery({owner,hidden,incomeControls,criteriaEditing,incomeReady,onAdd,saved,result,setResult,homes,baseId,onBusyChange}:{owner:Owner;hidden:boolean;incomeControls:ReactNode;criteriaEditing:boolean;incomeReady:boolean;onAdd:(c:Candidate[])=>Promise<void>;saved:Candidate[];result:DiscoveryResult|null;setResult:(r:DiscoveryResult|null)=>void;homes:HomeList["homes"];baseId:string;onBusyChange:(busy:boolean)=>void}) {
  const base=homes.find(h=>h.asset.id===baseId)??homes.find(h=>h.detail?.tenure==='live')
  const [busy,setBusy]=useState(false)
  const [adding,setAdding]=useState('')
  const saving = useRef(false)
  const [selected,setSelected]=useState<Set<string>>(new Set())
  const [addedIds,setAddedIds]=useState<Set<string>>(new Set())
  const [sort,setSort]=useState('price-high')
  const [active,setActive]=useState('')
  const [error,setError]=useState('')
  const [open,setOpen]=useState(true)
  const [stage,setStage]=useState<'trades'|'research'>('trades')
  async function discover(refresh=false){
    setBusy(true);onBusyChange(true);setError('');setOpen(true);setStage('trades');setSelected(new Set());setActive('')
    const path=`/property-move/discover?owner=${owner}&home_id=${encodeURIComponent(base?.asset.id??'')}&refresh=${refresh}`
    try {
      const candidates=await api<DiscoveryResult>(`${path}&analyze=false`,'POST',{})
      setResult(candidates)
      if(candidates.items.length && candidates.ai_status!=='cached'){setStage('research');const analysis=await api<DiscoveryResult>(path,'POST',{});setResult({...analysis,items:candidates.items.map(item=>({...item,...analysis.items.find(a=>a.id===item.id),candidate:item.candidate,point:item.point}))})}
    } catch(e){setError((e as Error).message)}finally{setBusy(false);onBusyChange(false)}
  }

  const ordered=[...(result?.items??[])].sort((a,b)=>a.district.localeCompare(b.district,'ko')||(sort==='fit'?Math.abs(a.price-(result?.available_capital??0))-Math.abs(b.price-(result?.available_capital??0)):sort==='price-low'?a.price-b.price:sort==='price-high'?b.price-a.price:b.area-a.area)||b.price-a.price)
  const show=(n:number)=>hidden?'••••':money(n)
  const isSaved=(item:Item)=>addedIds.has(item.id)||saved.some(c=>c.id===item.candidate.id||(c.name===item.name&&c.address?.jibun===item.candidate.address?.jibun&&Math.floor(c.area_m2??0)===Math.floor(item.area)))
  const selectable=ordered.filter(item=>!isSaved(item))
  const picked=selectable.filter(item=>selected.has(item.id))
  async function addItems(items:Item[]) {
    if(saving.current||!items.length)return
    saving.current=true;setAdding(items.length===1?items[0].id:'batch');setError('')
    try {await onAdd(items.map(item=>item.candidate));setAddedIds(old=>new Set([...old,...items.map(item=>item.id)]));setSelected(old=>new Set([...old].filter(id=>!items.some(item=>item.id===id))))}
    catch(e){setError((e as Error).message)}finally{saving.current=false;setAdding('')}
  }
  return <section className="research-discovery home-discovery" aria-label="AI 후보 추천">
    <div className="research-toolbar"><h3><Sparkles size={16}/> 다음 집 후보</h3><div>{result&&<Button variant="ghost" size="sm" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'접기':'펼치기'}</Button>}<Button variant="outline" size="sm" disabled={busy||!!adding||!base||criteriaEditing||!incomeReady} onClick={()=>discover()}>{busy?stage==='trades'?'실거래 후보 찾는 중…':'AI 근거 조사 중…':'상급지 후보 찾기'}</Button></div></div>
    {incomeControls}
    {!!result?.cached_count&&<div className="research-toolbar"><span className="research-caption">저장된 분석 {result.cached_count}곳</span><Button variant="ghost" size="sm" disabled={busy||!!adding||criteriaEditing} onClick={()=>discover(true)}>분석 새로 갱신</Button></div>}
    {error&&<p role="alert">{error}</p>}
    {busy&&<p className="research-caption" role="status">{stage==='trades'?'실거래 후보 조회 중':'후보 선택 가능 · AI 근거 조사 중'}</p>}
    {result&&open&&<><div className="research-toolbar"><span className="research-caption">새 후보 {ordered.length}곳</span><NativeSelect aria-label="후보 정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="fit">가용자금 가까운 순</option><option value="area">큰 면적순</option><option value="price-high">높은 가격순</option><option value="price-low">낮은 가격순</option></NativeSelect></div>
      <div className="research-toolbar" aria-label="후보 여러 개 선택"><label className="home-baseline-choice"><input type="checkbox" aria-label="새 후보 전체 선택" checked={selectable.length>0&&picked.length===selectable.length} disabled={!!adding||!selectable.length} onChange={e=>setSelected(new Set(e.target.checked?selectable.map(item=>item.id):[]))}/>전체 선택</label><Button size="sm" disabled={!!adding||!picked.length} onClick={()=>addItems(picked)}>{adding==='batch'?'저장 중…':`선택 ${picked.length}곳 관심 추가`}</Button></div>
      <div className="candidate-collections">{['강남구','서초구','송파구'].map(g=><section className="candidate-collection" key={g} aria-label={`${g} 후보`}><h4>{g}</h4><div className="candidate-collection-orbs">{ordered.filter(item=>item.district===g).map(item=><div className="candidate-pick" key={item.id}><label className="home-baseline-choice"><input type="checkbox" aria-label={`${item.name} 관심 선택`} checked={isSaved(item)||selected.has(item.id)} disabled={!!adding||isSaved(item)} onChange={e=>{const checked=e.target.checked;setSelected(old=>{const next=new Set(old);checked?next.add(item.id):next.delete(item.id);return next})}}/></label><CandidateOrb name={item.name} area={`전용 ${item.area}㎡`} price={eok(item.price,{hidden})} facts={[item.households?`${item.households.count.toLocaleString('ko-KR')}세대`:null,item.build_year?`${item.build_year}년${item.age_years==null?' 건축':item.age_years===0?' (신축)':` (${item.age_years}년차)`}`:null].filter(Boolean).join(' · ')} detail={`추가 ${eok(item.funding.needed,{hidden})}`} spotlight={item.spotlight} saved={isSaved(item)} selected={active===item.id} onSelect={()=>setActive(active===item.id?'':item.id)}/></div>)}</div>{!ordered.some(item=>item.district===g)&&<p className="research-caption">조건에 맞는 새 후보가 없어요.</p>}</section>)}</div>
      <details className="research-caption"><summary>조회 기준·상태</summary><p>강남·서초·송파 · PIR 가격 범위 안 · 기준 집보다 높은 실거래가 순 · 구별 최대 3곳. 가격만으로 상급지나 저평가를 판정하지 않습니다.</p><p>전체 주택 매각 가정 · 신규 대출 없음 · 세금·거래비용 별도. 실거래는 현재 매물 가격과 다를 수 있어요.</p><p>{result.as_of} · 최근 {result.months}개월 · 전용 {result.area_min}–{result.area_max}㎡ · 가격 조건 충족 {result.total}곳</p><a href={result.source_url} target="_blank" rel="noreferrer">국토부 실거래 ↗</a>{result.missing.length>0&&<p>조회 누락: {result.missing.join(', ')}</p>}<p>검증된 설명 {result.verified_claims??0}개</p>{result.research_failures?.map(f=><p key={f.id}>{f.name} · {f.message}</p>)}</details>
      {result.research_error&&<p role="status">{result.research_error}</p>}
      {result.ai_error&&<p role="alert">{result.ai_error} AI 설명 없이 계산 결과만 표시합니다.</p>}
      {!result.items.length&&<p>조회 기간과 가격 범위에 맞는 새 후보가 없습니다.</p>}
      <ul>{ordered.filter(item=>item.id===active).map((item)=>{const added=isSaved(item);return <li key={item.id}>
        <div><button aria-pressed={active===item.id} onClick={()=>setActive(item.id)}><strong>{item.name}</strong></button><small>{item.district} · 전용 {item.area}㎡</small><PirBadge value={item.pir} hidden={hidden}/></div>
        <div><small>최근 실거래</small><strong>{show(item.price)}</strong><small>{item.date}</small></div>
        <div><small>추가 필요</small><strong>{show(item.funding.needed)}</strong></div>
        <Button variant="outline" size="sm" disabled={!!adding||added||saved.length>=50} onClick={()=>addItems([item])}><Plus size={14}/>{added?'추가됨':adding===item.id?'저장 중…':'관심 추가'}</Button>
        {!hidden&&<details open className="discovery-evidence"><summary>분석 보기{item.analysis_date?` · ${item.analysis_date}`:''}</summary>{item.spotlight&&<p><strong>주목 후보</strong> · 유사 단지 대비 상대 가격 차이가 가장 큰 후보입니다. 거래 표본이 있는 후보끼리 비교한 관측이며 상승 예측이 아닙니다.</p>}<p>{item.reason}</p>{item.households&&<a href={item.households.source_url} target="_blank" rel="noreferrer">{item.households.count.toLocaleString('ko-KR')}세대 · 출처 ↗</a>}<small>{item.check}</small>
          {item.relative&&<div><strong>상대 가격 · {item.relative.month}</strong><p>{item.relative.median==null?'비교 가능한 유사 단지가 부족합니다.':`같은 동·면적·유사 연식 ${item.relative.peer_count}곳 대비 ${item.relative.discount_pct!>0?'낮게':'높거나 같게'} 관측 · 차이 ${Math.abs(item.relative.discount_pct!)}%`}</p><small>동일 거래월 비교. 층·동·세대수·입지 차이가 남아 저평가 판정은 아닙니다.</small>{item.relative.peers.map(p=><small key={p.name}>{p.name} · {money(p.median)}</small>)}</div>}
          <div className="discovery-claims">{([['pros','장점'],['cons','단점'],['popularity','관심받는 이유']] as const).map(([key,label])=><section key={key}><strong>{label}</strong>{item[key]?.length?<ol>{item[key]!.map((c,i)=><li key={i}><p>{c.text}</p><a href={c.source_url} target="_blank" rel="noreferrer">{c.kind} · {c.date} · 출처 ↗</a></li>)}</ol>:<p>확인된 근거가 부족합니다.</p>}</section>)}</div>
        </details>}
      </li>})}</ul>
    </>}
    <div className="candidate-discovery-footer"><span className="research-caption">관심 단지 {saved.length}곳</span><Button variant="ghost" size="sm" onClick={()=>openPropertyMenu('watch')}>관심 단지에서 보기 →</Button></div>
  </section>
}
