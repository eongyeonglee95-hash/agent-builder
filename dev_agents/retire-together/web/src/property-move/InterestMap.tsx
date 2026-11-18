import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Candidate } from './types'
import type { Owner } from '../model'
import { useRead } from './ObservationBoard'

type Locations = { configured: boolean; items: { id:string; point:{lat:number;lng:number;approx?:boolean}|null }[] }
export function InterestMap({ owner, candidates, activeId, onSelect, revision }: { owner:Owner; candidates:Candidate[]; activeId?:string; onSelect:(id:string)=>void; revision:number }) {
  const locations=useRead<Locations>(`/property-move/places?owner=${owner}`,revision)
  const element=useRef<HTMLDivElement>(null)
  const map=useRef<L.Map|null>(null)
  const markers=useRef(new Map<string,L.CircleMarker>())
  const select=useRef(onSelect)
  select.current=onSelect
  const [tileError,setTileError]=useState(false)
  useEffect(()=>{
    if(!element.current)return
    const instance=L.map(element.current,{scrollWheelZoom:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false}).setView([37.505,127.035],12)
    map.current=instance
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>'}).addTo(instance)
    tiles.on('tileerror',()=>setTileError(true))
    const observer=new ResizeObserver(()=>instance.invalidateSize({pan:false}))
    observer.observe(element.current)
    return()=>{observer.disconnect();instance.stop();instance.remove();map.current=null;markers.current.clear()}
  },[])
  const signature=candidates.map(c=>`${c.id}:${c.name}`).join('|')
  useEffect(()=>{
    const instance=map.current
    if(!instance)return
    markers.current.forEach(marker=>marker.remove());markers.current.clear()
    const points:L.LatLngExpression[]=[]
    for(const c of candidates){
      const point=locations.data?.items.find(p=>p.id===c.id)?.point
      if(!point||!Number.isFinite(point.lat)||!Number.isFinite(point.lng))continue
      const label=document.createElement('span');label.textContent=c.name+(point.approx?' · 근사 위치':'')
      const marker=L.circleMarker([point.lat,point.lng],{radius:8,color:'#fff',weight:2,fillColor:'#6083ad',fillOpacity:.9}).addTo(instance)
      marker.bindTooltip(label,{permanent:candidates.length<=8,direction:'top',offset:[0,-7],className:'interest-map-label'})
      marker.on('click',()=>select.current(c.id))
      markers.current.set(c.id,marker);points.push([point.lat,point.lng])
    }
    if(points.length)instance.fitBounds(L.latLngBounds(points),{padding:[45,40],maxZoom:15,animate:false})
  // Labels and coordinates are the only dependencies that rebuild the geographic layer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[locations.data,signature])
  useEffect(()=>{markers.current.forEach((marker,id)=>{marker.setStyle({fillColor:id===activeId?'#3d50c7':'#6083ad',radius:id===activeId?11:8});const tooltip=marker.getTooltip();if(tooltip){tooltip.options.permanent=candidates.length<=8||id===activeId;if(tooltip.options.permanent)marker.openTooltip();else marker.closeTooltip()}if(id===activeId)marker.bringToFront()})},[activeId,locations.data,signature])
  const located=candidates.filter(c=>locations.data?.items.some(p=>p.id===c.id&&p.point))
  const missing=candidates.filter(c=>!located.includes(c))
  return <section className="interest-map-panel" aria-label="관심 단지 지도">
    <div className="research-toolbar"><h3>관심 지역</h3><small>{locations.loading?'위치 조회 중':`${located.length}곳 표시`}</small></div>
    <div ref={element} className="interest-map" aria-label="관심 단지 실제 위치 지도"/>
    {tileError&&<p role="status">지도 배경을 불러오지 못했어요. 위치 목록에서 단지를 선택할 수 있습니다.</p>}
    {locations.error?<p role="alert">위치 조회 실패</p>:!locations.loading&&!locations.data?.configured?<p>주소 좌표 연결 전 · 단지를 선택해 주소를 확인하세요.</p>:null}
    <div className="interest-map-picks" aria-label="지도 단지 선택">{candidates.map(c=><button key={c.id} aria-pressed={c.id===activeId} onClick={()=>onSelect(c.id)}>{c.name}{!locations.loading&&missing.includes(c)?' · 위치 미확인':''}</button>)}</div>
    {!candidates.length&&<p>비교할 단지를 선택해 주세요.</p>}
  </section>
}
