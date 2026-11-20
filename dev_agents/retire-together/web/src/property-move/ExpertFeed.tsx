import {useState} from 'react'
import {api} from '../local-data'
import {Button} from '../components/ui/button'
const known=[{id:'udaro',name:'유다로'},{id:'ppasson',name:'빠숑 김학렬'},{id:'samtoshi',name:'삼토시'},{id:'wooseok',name:'우석 브라운스톤'}]
const storeKey='observatory-layout-v3'
function read(){try{return JSON.parse(localStorage.getItem(storeKey)||'{}')}catch{return {}}}
type News={text:string;sources:{title:string;url:string}[];as_of:string;since:string}
export function ExpertFeed({candidate=''}:{candidate?:string}){
 const [follow,setFollow]=useState<string[]>(()=>{const x=read();return Array.isArray(x?.follow)?x.follow:[]})
 const [days,setDays]=useState(7)
 const [news,setNews]=useState<News|null>(null)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 function toggle(id:string){const next=follow.includes(id)?follow.filter(x=>x!==id):[...follow,id];try{localStorage.setItem(storeKey,JSON.stringify({...read(),follow:next}));setFollow(next);setNews(null);setError('')}catch{setError('팔로우 선택을 저장하지 못했습니다.')}}
 return <section className="expert-feed"><div className="research-toolbar"><h3>{candidate?'이 단지를 언급한 소식':'팔로우 · 최신 부동산 소식'}</h3><Button size="sm" variant="outline" disabled={busy||!follow.length} onClick={async()=>{setBusy(true);setNews(null);setError('');try{setNews(await api<News>('/property-move/expert-news','POST',{sources:known.filter(x=>follow.includes(x.id)).map(x=>x.name),days,candidate}))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>{busy?'검색 중…':'새 소식 찾기'}</Button></div>
 <div className="expert-follow">{known.map(x=><label key={x.id}><input type="checkbox" checked={follow.includes(x.id)} onChange={()=>toggle(x.id)}/>{x.name}</label>)}<select aria-label="소식 기간" value={days} onChange={e=>{setDays(Number(e.target.value));setNews(null)}}><option value={7}>최근 7일</option><option value={30}>최근 30일</option></select></div>
 <p className="research-caption">공개 글·영상 검색 · 실행 시 API 사용 · 급매 언급은 작성자의 의견</p>{error&&<p role="alert">{error}</p>}{busy&&<p role="status">원문과 게시일을 확인하고 있습니다.</p>}
 {news&&<><small>{news.since}~{news.as_of} 검색</small><div className="expert-report">{news.text}</div><details><summary>확인한 원문 {news.sources.length}개</summary>{news.sources.map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a>)}</details></>}
 </section>
}
