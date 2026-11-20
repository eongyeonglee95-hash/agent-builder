import { ExpertFeed } from './ExpertFeed'
import { useState } from 'react'
import { money } from '../model'
import { usePublicListings } from './HomeListings'
import type { Candidate, TrackEntry } from './types'
import captured from './captured-listings.json'

const sources = [
  { id: 'udaro', name: '유다로', url: 'https://litt.ly/udaro' },
  { id: 'ppasson', name: '빠숑 · 김학렬', url: 'https://www.youtube.com/channel/UCKosTo5bqKm4v264z2zDnFQ' },
  { id: 'samtoshi', name: '삼토시', url: 'https://weolbu.com/profile/793008' },
  { id: 'wooseok', name: '우석 · 브라운스톤', url: 'https://m.yes24.com/goods/detail/122434990' },
]
const storeKey = 'observatory-layout-v3'
function stored() { try { const value = JSON.parse(localStorage.getItem(storeKey) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} } }
const normalize = (s: string) => s.replace(/\s/g, '').replace(/아파트$/, '')

export function CandidateUpdates({ candidate: c, area, hidden, track, onEdit }: { candidate: Candidate; area: number | null; hidden: boolean; track: TrackEntry[]; onEdit: () => void }) {
  const [tab, setTab] = useState<'listings' | 'news'>('listings')
  return <section className="candidate-updates" aria-label={`${c.name} 매물·소식`}>
    <div className="research-modes" role="group" aria-label="단지 매물·소식 보기"><button aria-pressed={tab==='listings'} onClick={()=>setTab('listings')}>매물</button><button aria-pressed={tab==='news'} onClick={()=>setTab('news')}>소식·기록</button></div>
    {tab==='listings' ? <ListingFeed candidate={c} area={area} hidden={hidden} onEdit={onEdit}/> : <NewsFeed candidate={c} hidden={hidden} track={track}/>}
  </section>
}
function ListingFeed({ candidate:c, area, hidden, onEdit }: { candidate: Candidate; area: number | null; hidden: boolean; onEdit: () => void }) {
  const [kind,setKind] = useState<'P'|'L'|'M'>('P')
  const [all,setAll] = useState(false)
  const market = usePublicListings(c.address,c.name,area,kind)
  return <div className="candidate-feed"><div className="candidate-feed-types">{([['P','매매'],['L','전세'],['M','월세']] as const).map(([id,label])=><button key={id} aria-pressed={kind===id} onClick={()=>{setKind(id);setAll(false)}}>{label}</button>)}</div>
    {market.loading ? <p role="status">매물 조회 중…</p> : market.error ? <p role="alert">매물을 불러오지 못했어요. <button onClick={market.retry}>다시 조회</button></p> : !market.ready ? <p>주소·전용면적 등록 필요 <button onClick={onEdit}>수정</button></p> : !market.data?.listings.length ? <p>{market.data?.status==='unmatched'?'연결된 매물 없음':'조회한 매물 없음'}</p> : <>
      <ul>{market.data.listings.slice(0,all?undefined:3).map(l=><li key={l.id}><a href={l.url} target="_blank" rel="noreferrer"><strong>{hidden?'••••':`${money(l.price)}${l.monthly!=null?` / 월 ${money(l.monthly)}`:''}`}</strong><span>전용 {l.area}㎡ · {l.floor_direction}</span><small>{l.checked_on} 확인 ↗</small></a></li>)}</ul>
      {market.data.listings.length>3 && <button onClick={()=>setAll(v=>!v)}>{all?'접기':`${market.data.listings.length}건 더보기`}</button>}
    </>}
    {market.data && <small>{market.data.source} · {market.data.fetched_at?.slice(0,10)}{market.data.stale?' · 이전 자료':''}{market.data.partial?' · 일부 조회':''}</small>}
    <a className="candidate-source-link" href={`https://m.land.naver.com/search/result/${encodeURIComponent(c.name)}`} target="_blank" rel="noreferrer">{c.name} 매물 검색 ↗</a>
  </div>
}
function NewsFeed({ candidate:c, hidden, track }: { candidate: Candidate; hidden: boolean; track: TrackEntry[] }) {
  const [saved] = useState(stored)
  const matching = captured.filter(r=>normalize(r.name)===normalize(c.name))
  const captureRow = (r: typeof captured[number]) => <li key={r.id}><strong>{r.name} · {hidden?'••••':`${r.price}억`}</strong><span>{r.area} · {r.floor}</span><small>유다로 제공 캡처 · 게시일·현재 매물 여부 미확인</small>{!hidden && typeof saved.interestNotes?.[r.id]==='string' && <p>{saved.interestNotes[r.id]}</p>}</li>
  return <div className="candidate-feed">
    <ExpertFeed candidate={c.name}/>
    {!!track.length && <ul>{track.slice(0,5).map(r=><li key={r.day}><strong>{r.day} · {r.price_basis==='asking'?'호가 기록':r.price_basis==='trade'?'실거래 기록':'가격 기록'}</strong><span>{hidden?'••••':money(r.price)}</span>{!hidden && r.note && <p>{r.note}</p>}</li>)}</ul>}
    {!!matching.length && <ul>{matching.map(captureRow)}</ul>}
    {!track.length && !matching.length && <p>이 단지에 연결된 소식이 없습니다.</p>}
    <a className="candidate-source-link" href={`https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(c.name)}`} target="_blank" rel="noreferrer">{c.name} 뉴스 검색 ↗</a>
    <details><summary>채널 원문</summary>{sources.map(s=><a className="candidate-source-link" key={s.id} href={s.url} target="_blank" rel="noreferrer">{s.name} ↗</a>)}</details>
    <details><summary>이전 캡처 {captured.length}건</summary><ul className="candidate-archive">{captured.map(captureRow)}</ul></details>
  </div>
}
