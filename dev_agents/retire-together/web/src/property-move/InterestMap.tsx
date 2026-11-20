import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { FeatureCollection } from 'geojson'
import districts from './seoul-districts.json'
import 'leaflet/dist/leaflet.css'
import { pirStatus } from './Pir'
import type { PirResult } from './types'
import type { Candidate } from './types'
import { money, type Owner } from '../model'
import { useRead } from './ObservationBoard'

const districtColors: Record<string,string> = {강남구:'#3d50c7',서초구:'#087b75',송파구:'#a46328'}
const districtOf = (c:Candidate) => /^(서울특별시|서울시|서울)\s/.test(c.address?.jibun ?? '') ? c.address?.jibun.match(/(?:^|\s)(\S+구)(?:\s|$)/)?.[1] : undefined

type Locations = { configured: boolean; items: { id:string; point:{lat:number;lng:number;approx?:boolean}|null }[] }
export function InterestMap({ owner, candidates: allCandidates, activeId, onSelect, revision, prices, hidden, suppliedLocations, fitCandidates = false, districtControls = false, numbered = false }: { suppliedLocations?: Locations; fitCandidates?: boolean; districtControls?: boolean; numbered?: boolean; prices:Record<string,{price?:number;date?:string;area:number|null;status?:string;pir?:PirResult}>; hidden:boolean; owner:Owner; candidates:Candidate[]; activeId?:string; onSelect:(id:string)=>void; revision:number }) {
  const [district,setDistrict]=useState(()=>{
    try {const saved=sessionStorage.getItem(`property-map-district:${owner}`);return districtControls&&saved&&['전체','강남구','서초구','송파구'].includes(saved)?saved:'전체'}catch{return '전체'}
  })
  function chooseDistrict(value:string){
    setDistrict(value);setFitRevision(v=>v+1)
    if(districtControls)try{sessionStorage.setItem(`property-map-district:${owner}`,value)}catch{/* optional preference */}
  }
  const [fitRevision,setFitRevision]=useState(0)
  const candidates=districtControls&&district!=='전체'?allCandidates.filter(c=>districtOf(c)===district):allCandidates
  function focusCandidate(id:string){
    onSelect(id)
    const marker=markers.current.get(id)
    if(marker&&map.current){map.current.setView(marker.getLatLng(),Math.max(map.current.getZoom(),16),{animate:false});marker.openTooltip()}
  }
  const fetched=useRead<Locations>(`/property-move/places?owner=${owner}`,revision,!suppliedLocations)
  const locations=suppliedLocations?{data:suppliedLocations,loading:false,error:false}:fetched
  const element=useRef<HTMLDivElement>(null)
  const map=useRef<L.Map|null>(null)
  const boundaries=useRef<L.GeoJSON|null>(null)
  const markers=useRef(new Map<string,L.CircleMarker>())
  const select=useRef(onSelect)
  select.current=focusCandidate
  const [tileError,setTileError]=useState(false)
  useEffect(()=>{
    if(!element.current)return
    const instance=L.map(element.current,{scrollWheelZoom:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false}).setView([37.505,127.035],12)
    map.current=instance
    instance.createPane('district-boundaries').style.zIndex='350'
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'}).addTo(instance)
    instance.attributionControl.addAttribution('<a href="https://github.com/southkorea/seoul-maps" target="_blank" rel="noreferrer">구 경계: 통계청 2013 · 단순화</a>')
    tiles.on('tileerror',()=>setTileError(true))
    const observer=new ResizeObserver(()=>instance.invalidateSize({pan:false}))
    observer.observe(element.current)
    return()=>{observer.disconnect();instance.stop();instance.remove();map.current=null;markers.current.clear()}
  },[])
  const signature=candidates.map(c=>`${c.id}:${c.name}:${c.address?.jibun}`).join('|')
  const selectedDistricts=[...new Set(candidates.map(districtOf).filter((g):g is string=>!!g))].sort()
  useEffect(()=>{
    const instance=map.current
    if(!instance)return
    markers.current.forEach(marker=>marker.remove());markers.current.clear()
    boundaries.current?.remove()
    const features=districts.features.filter(f=>selectedDistricts.includes(f.properties.name))
    const boundaryLayer=L.geoJSON({type:'FeatureCollection',features} as FeatureCollection,{pane:'district-boundaries',interactive:false,style:f=>({color:districtColors[f?.properties.name]??'#6083ad',weight:2.5,opacity:.85,fillOpacity:.08,className:'interest-district-boundary'}),onEachFeature:(f,layer)=>{layer.bindTooltip(f.properties.name,{permanent:true,direction:'center',className:'interest-district-label'})}}).addTo(instance)
    boundaries.current=boundaryLayer
    const points:L.LatLngExpression[]=[]
    for(const c of candidates){
      const point=locations.data?.items.find(p=>p.id===c.id)?.point
      if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lng))continue
      const label=document.createElement('span');label.textContent=c.name+(point.approx?' · 근사 위치':'')
      const marker=L.circleMarker([point.lat,point.lng],{radius:8,color:'#fff',weight:2,fillColor:'#6083ad',fillOpacity:.9}).addTo(instance)
      marker.bindTooltip(label,{permanent:candidates.length<=8,direction:candidates.indexOf(c)%2?'left':'right',offset:[candidates.indexOf(c)%2?-10:10,0],className:'interest-map-label'})
      marker.on('click',()=>select.current(c.id))
      markers.current.set(c.id,marker);points.push([point.lat,point.lng])
    }
    const bounds=fitCandidates&&points.length?L.latLngBounds(points):boundaryLayer.getBounds()
    points.forEach(point=>bounds.extend(point))
    if(bounds.isValid())instance.fitBounds(bounds,{padding:[Math.min(130,(element.current?.clientWidth??400)/4),45],maxZoom:16,animate:false})
  // Labels and coordinates are the only dependencies that rebuild the geographic layer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[locations.data,signature,fitCandidates,fitRevision])
  useEffect(()=>{markers.current.forEach((marker,id)=>{marker.setStyle({fillColor:id===activeId?'#3d50c7':'#6083ad',radius:id===activeId?11:8});const tooltip=marker.getTooltip();if(tooltip){tooltip.options.permanent=candidates.length<=8||id===activeId;if(tooltip.options.permanent)marker.openTooltip();else marker.closeTooltip()}if(id===activeId)marker.bringToFront()})},[activeId,locations.data,signature,fitRevision])
  // Update price labels without resetting the user's map position.
  useEffect(()=>{
    markers.current.forEach((marker,id)=>{
      const candidate=candidates.find(c=>c.id===id)
      if(!candidate)return
      const quote=prices[id]
      const label=document.createElement('span')
      const name=document.createElement('span');name.textContent=(numbered?`${candidates.indexOf(candidate)+1}. `:'')+candidate.name
      const amount=document.createElement('strong');amount.textContent=hidden?'••••':quote?.price==null?(quote?.status??'실거래 없음'):`실거래 ${money(quote.price)}`
      const detail=document.createElement('small');detail.textContent=[quote?.area==null?'':`${quote.area}㎡대`,quote?.price==null?'':quote.date,locations.data?.items.find(p=>p.id===id)?.point?.approx?'근사 위치':''].filter(Boolean).join(' · ')
      label.append(name,amount,detail)
      if(!hidden&&quote?.pir?.ratio!=null){const pir=document.createElement('small');pir.textContent=`PIR ${quote.pir.ratio.toFixed(1)}배 · ${pirStatus(quote.pir.status)}`;label.append(pir)}
      marker.setTooltipContent(label)
    })
  },[prices,hidden,locations.data,signature,fitRevision,numbered])
  const located=candidates.filter(c=>locations.data?.items.some(p=>p.id===c.id&&p.point))
  const missing=candidates.filter(c=>!located.includes(c))
  return <section className="interest-map-panel" aria-label="관심 단지 지도">
    <div className="research-toolbar"><h3>관심 단지 지도</h3>{districtControls&&<div className="research-modes" aria-label="지도 지역 선택">{['전체','강남구','서초구','송파구'].map(g=><button key={g} aria-label={g} aria-pressed={district===g} onClick={()=>chooseDistrict(g)}>{g}<span className="interest-district-count">{g==='전체'?allCandidates.length:allCandidates.filter(c=>districtOf(c)===g).length}</span></button>)}</div>}{!districtControls&&<div className="interest-district-legend" aria-label="표시 중인 구 경계">{selectedDistricts.filter(g=>districts.features.some(f=>f.properties.name===g)).map(g=><span key={g}><i style={{background:districtColors[g]??'#6083ad'}}/>{g}</span>)}</div>}<button type="button" onClick={()=>setFitRevision(v=>v+1)}>단지에 맞추기</button><small>{locations.loading?'위치 조회 중':`${located.length}곳 표시`}</small></div>
    <div className="interest-map-stage"><div ref={element} className="interest-map" aria-label="관심 단지 실제 위치 지도"/>
      {!candidates.length&&<div className="interest-map-empty"><span>{district==='전체'?'표시할 관심단지를 선택해 주세요.':`${district}에 표시할 관심단지가 없어요.`}</span>{district!=='전체'&&<button type="button" onClick={()=>chooseDistrict('전체')}>전체 관심단지 보기</button>}</div>}
    </div>
    {tileError&&<p role="status">지도 배경을 불러오지 못했어요. 위치 목록에서 단지를 선택할 수 있습니다.</p>}
    {locations.error?<p role="alert">위치 조회 실패</p>:!locations.loading&&!locations.data?.configured?<p>주소 좌표 연결 전 · 단지를 선택해 주소를 확인하세요.</p>:null}
    <div className="interest-map-picks" aria-label="지도 단지 선택">{candidates.map(c=><button key={c.id} aria-pressed={c.id===activeId} onClick={()=>focusCandidate(c.id)}>{c.name}{!locations.loading&&missing.includes(c)?' · 위치 미확인':''}</button>)}</div>
  </section>
}
