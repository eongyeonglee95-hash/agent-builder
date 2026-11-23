import { NativeSelect } from './components/ui/native-select'
import { createContext, useEffect, useState, type ReactNode } from 'react'
import { SectionMenu } from './components/ui/section-menu'
import { ResearchBoard } from './property-move/ResearchBoard'
import { MarketResearch } from './property-move/MarketResearch'
import { ownerLabels, type Owner } from './model'

const menus = [{id:'move',label:'내 부동산'},{id:'watch',label:'관심 단지'},{id:'market',label:'시황'},{id:'sentiment',label:'심리·금리'},{id:'experts',label:'전문가 소식'}] as const
function normalize(id:string){if(id==='sentiment'||id==='experts')return id;return ['map','watch','compare','signals','voices'].includes(id)?'watch':['market','journal','reports','research'].includes(id)?'market':'move'}
export const PropertyPageContext=createContext<'move'|'plan'>('move')
export function openPropertyMenu(id:string){try{sessionStorage.setItem('property-menu',normalize(id))}catch{/* optional preference */}window.dispatchEvent(new CustomEvent('property-menu',{detail:id}))}
function lastPage(){try{return normalize(sessionStorage.getItem('property-menu')??'move')}catch{return 'move'}}
export function PropertyObservatory({children,owner,hidden,onOwner}:{children:ReactNode;owner:Owner;hidden:boolean;onOwner:(owner:Owner)=>void}){
  const [page,setPage]=useState(lastPage)
  const [selectedId,setSelectedId]=useState('')
  useEffect(()=>{const pick=(e:Event)=>setPage(normalize((e as CustomEvent<string>).detail));window.addEventListener('property-menu',pick);return()=>window.removeEventListener('property-menu',pick)},[])
  useEffect(()=>{try{sessionStorage.setItem('property-menu',page)}catch{/* optional preference */}},[page])
  return <section className="min-w-0 space-y-4 font-sans text-sm text-grey-900" aria-label="부동산 관측실">
    <header className="property-nav-header"><h1>부동산</h1><SectionMenu label="부동산 메뉴" items={menus} value={page} onChange={setPage}/><NativeSelect aria-label="자산 소유자 선택" value={owner} onChange={e=>onOwner(e.target.value as Owner)}>{Object.entries(ownerLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</NativeSelect></header>
    {page==='move'&&<PropertyPageContext.Provider value="move">{children}</PropertyPageContext.Provider>}
    {page==='watch'&&<ResearchBoard key={owner} owner={owner} hidden={hidden} initialFocus={selectedId} onManage={()=>setPage('move')}/>}
    {['market','sentiment','experts'].includes(page)&&<MarketResearch tab={page==='sentiment'?'sentiment':page==='experts'?'experts':'flow'} key={owner} owner={owner} hidden={hidden} onSelect={id=>{setSelectedId(id);setPage('watch')}}/>}
  </section>
}
