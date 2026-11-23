import { Input } from '../components/ui/input'
import { Sentiment } from './Sentiment'
import { ExpertFeed } from './ExpertFeed'
import { useState } from 'react'
import { Button } from '../components/ui/button'
import { money, type Owner } from '../model'
import { useRead } from './ObservationBoard'
import type { MoveState } from './types'

type Row={id:string;name:string;area:number|null;current_count:number|null;previous_count:number|null;price_change:number|null;latest:{price:number;date:string}|null;asking:number|null;asking_date:string|null;asking_difference:number|null;missing:boolean;sparse:boolean}
type Heatmap={months:string[];rows:{id:string;name:string;area:number|null;cells:{month:string;volume_shade?:number;change_shade?:number;count:number|null;price:number|null;change_pct:number|null}[]}[]}
type Research={heatmap?:Heatmap;as_of:string;recent:string[];previous:string[];rows:Row[];summary:{total:number;missing:number;volume_up:number;price_down:number;asking_below_trade:number}}
export function MarketResearch({owner,hidden,onSelect,tab='flow'}:{tab?:'flow'|'sentiment'|'experts';owner:Owner;hidden:boolean;onSelect:(id:string)=>void}){
  const [revision,setRevision]=useState(0)
  const research=useRead<Research>(`/property-move/research?owner=${owner}`,revision)
  const plan=useRead<MoveState>(`/property-move?owner=${owner}`,revision)
  const [heatMode,setHeatMode]=useState<'price'|'volume'>('price')
  const [filter,setFilter]=useState('all')
  const [period,setPeriod]=useState(7)
  const [query,setQuery]=useState('')
  const data=research.data
  const show=(v:number|null|undefined)=>hidden?'••••':v==null?'—':money(v)
  const signed=(v:number|null)=>hidden?'••••':v==null?'—':`${v>0?'+':v<0?'−':''}${money(Math.abs(v))}`
  const rows=(data?.rows??[]).filter(r=>r.name.replaceAll(' ','').includes(query.replaceAll(' ',''))).filter(r=>filter==='all'||filter==='volume'&&r.current_count!=null&&r.previous_count!=null&&r.current_count>r.previous_count||filter==='price'&&r.price_change!=null&&r.price_change<0||filter==='asking'&&r.asking_difference!=null&&r.asking_difference<0||filter==='missing'&&r.missing)
  const cutoff=new Date();cutoff.setDate(cutoff.getDate()-period+1)
  const since=cutoff.toLocaleDateString('sv-SE')
  const changes=Object.entries(plan.data?.track??{}).flatMap(([id,entries])=>entries.filter(e=>e.day>=since).map(e=>({...e,id,name:plan.data?.plan.candidates.find(c=>c.id===id)?.name??'삭제된 단지'}))).sort((a,b)=>b.day.localeCompare(a.day))
  return <div className="property-research market-research">
    <div className="research-toolbar"><h2>{tab==='flow'?'시황':tab==='sentiment'?'심리·금리':'전문가 소식'}</h2>{tab==='flow'&&<Button variant="outline" size="sm" disabled={research.loading} onClick={()=>setRevision(v=>v+1)}>자료 다시 조회</Button>}</div>
    <div role="region" aria-label="심리·금리 내용" hidden={tab!=='sentiment'}><Sentiment/></div>
    <div role="region" aria-label="전문가 소식 내용" hidden={tab!=='experts'}><ExpertFeed/></div>
    <div role="region" aria-label="시황 내용" hidden={tab!=='flow'}>
    {research.loading?<p role="status">관심 단지의 거래 변화를 비교하고 있어요…</p>:research.error||!data?<p role="alert">리서치 자료 조회 실패 · 다시 조회해 주세요.</p>:<>
      {data.heatmap&&<section className="research-heatmap"><div className="research-toolbar"><h3>관심 단지 월별 흐름</h3><div className="research-modes"><button aria-pressed={heatMode==='price'} onClick={()=>setHeatMode('price')}>가격 변화</button><button aria-pressed={heatMode==='volume'} onClick={()=>setHeatMode('volume')}>거래량</button></div></div><div className="research-table-scroll"><table><thead><tr><th>단지</th>{data.heatmap.months.map(m=><th key={m}>{m.slice(2).replace('-','.')}</th>)}</tr></thead><tbody>{data.heatmap.rows.map(r=><tr key={r.id}><th><button onClick={()=>onSelect(r.id)}>{r.name}</button><small>{r.area}㎡대</small></th>{r.cells.map(c=>{const v=heatMode==='price'?c.change_pct:c.count;return <td key={c.month} style={hidden||v==null?undefined:{background:`color-mix(in srgb, var(${heatMode==='volume'?'--grey-500':v>0?'--up':'--down'}) ${heatMode==='volume'?c.volume_shade??0:c.change_shade??0}%, transparent)`}} className={hidden||v==null?'heat-missing':heatMode==='price'?(v>0?'heat-up':v<0?'heat-down':''):'heat-volume'} title={hidden?'금액 숨김':`${c.month} · ${c.count??'미확인'}건 · ${c.price==null?'거래 없음':money(c.price)}`}><span>{hidden?'••':v==null?'—':heatMode==='price'?`${v>0?'+':''}${v}%`:`${v}건`}</span>{heatMode==='price'&&!hidden&&c.count!=null&&c.count>0&&<small>{c.count}건</small>}</td>})}</tr>)}</tbody></table></div><p className="research-caption">선택 평형 월 중간값의 전월 대비 변화 · 거래 없는 달은 비교 안 함 · 이번 달 집계 중 · 적은 거래는 층·동 차이에 민감</p></section>}
      <div className="research-screeners" role="group" aria-label="리서치 조건">{[['all','전체',data.summary.total],['volume','거래 증가',data.summary.volume_up],['price','월 중간값 하락',data.summary.price_down],['asking','호가가 최근 거래보다 낮음',data.summary.asking_below_trade],['missing','자료 보완',data.summary.missing]].map(([id,label,count])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(String(id))}><span>{label}</span><b>{count}</b></button>)}</div>
      <div className="research-toolbar"><p className="research-caption">{data.recent[0]}~{data.recent[2]} / {data.previous[0]}~{data.previous[2]} 비교 · 진행 중인 이번 달 제외</p><Input type="search" aria-label="리서치 단지 검색" placeholder="단지 검색" value={query} onChange={e=>setQuery(e.target.value)}/></div>
      <div className="research-table-scroll"><table><thead><tr><th>단지·전용면적</th><th>최근 3개월 거래</th><th>이전 3개월</th><th>월 중간값 변화</th><th>기록 호가 − 최근 거래</th><th>확인</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><th>{r.name}<small>{r.area??'—'}㎡대</small></th><td>{r.current_count==null?'—':`${r.current_count}건`}{r.sparse&&<small>거래 적음</small>}</td><td>{r.previous_count==null?'—':`${r.previous_count}건`}</td><td>{signed(r.price_change)}<small>{data.previous[2]} → {data.recent[2]}</small></td><td>{signed(r.asking_difference)}<small>호가 {r.asking_date??'미기록'} / 거래 {r.latest?.date??'없음'}</small></td><td><Button variant="outline" size="sm" onClick={()=>onSelect(r.id)}>지도·매물 확인</Button></td></tr>)}</tbody></table>{!rows.length&&<p className="research-empty">조건에 맞는 단지가 없습니다.</p>}</div>
      <details className="research-data"><summary>비교 기준</summary><p>등록 관심 단지의 선택 평형만 비교합니다. 월 중간값 변화는 두 기준월에 모두 거래가 있을 때만 표시합니다. 기록 호가와 실거래는 시점·층·상태가 달라 저평가 판정이 아닙니다. 관심 단지 변화로 서울 전체의 매수·매도 우위를 판정하지 않습니다.</p></details>
    </>}
    <section className="research-record-review"><div className="research-toolbar"><h3>내 기록 돌아보기</h3><div className="research-modes"><button aria-pressed={period===7} onClick={()=>setPeriod(7)}>최근 7일</button><button aria-pressed={period===30} onClick={()=>setPeriod(30)}>최근 30일</button></div></div>
      {plan.loading?<p role="status">기록 조회 중…</p>:plan.error?<p role="alert">기록을 불러오지 못했어요.</p>:changes.length?<ul>{changes.map(e=><li key={`${e.id}:${e.day}`}><time>{e.day}</time><button onClick={()=>onSelect(e.id)}>{e.name}</button><strong>{show(e.price)}</strong>{!hidden&&e.note&&<span>{e.note}</span>}</li>)}</ul>:<p className="research-caption">이 기간에 저장한 가격 기록이 없습니다.</p>}
    </section>
    <details className="research-official"><summary>세금·정책 원문 확인</summary><div><a href="https://www.nts.go.kr/" target="_blank" rel="noreferrer">국세청 · 양도세·종부세 ↗</a><a href="https://www.wetax.go.kr/" target="_blank" rel="noreferrer">위택스 · 취득세·재산세 ↗</a><a href="https://www.molit.go.kr/" target="_blank" rel="noreferrer">국토교통부 · 주택 정책 ↗</a><a href="https://www.law.go.kr/" target="_blank" rel="noreferrer">국가법령정보센터 · 시행일 확인 ↗</a></div><p>최신 개정 요약·자동 주간 리포트는 아직 연결 전입니다.</p></details>
    <details className="research-data"><summary>이전 리서치 노트</summary><a href="/previews/property-observatory/index.html#research" target="_blank" rel="noreferrer">보관한 시안·노트 열기 ↗</a></details>
    </div>
  </div>
}
