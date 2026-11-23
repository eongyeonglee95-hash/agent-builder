import { Input } from '../components/ui/input'
import { useState, type FormEvent } from 'react'
import { Amount } from './Forms'
import type { PirResult, PirSettings } from './types'

export const pirStatus = (status: PirResult['status']) => status === 'within' ? '설정 범위 내' : status === 'below' ? '설정 범위 미만' : status === 'above' ? '설정 범위 초과' : '연봉 입력 필요'
export function PirBadge({value,hidden}:{value?:PirResult;hidden:boolean}) {
  if(hidden)return <span className="pir-badge">PIR ••••</span>
  if(value?.ratio==null)return <span className="pir-badge">PIR —</span>
  return <span className={`pir-badge pir-${value.status}`}>PIR {value.ratio.toFixed(1)}배 <small>{pirStatus(value.status)}</small></span>
}
export function PirForm({initial,onSave}:{initial:PirSettings;onSave:(value:PirSettings)=>Promise<void>}) {
  const [value,setValue]=useState(initial)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function submit(e:FormEvent){e.preventDefault();setError('');if(value.lower>=value.upper){setError('최솟값은 최댓값보다 작아야 합니다.');return}setBusy(true);try{await onSave(value)}catch(e){setError((e as Error).message);setBusy(false)}}
  return <form className="property-move property-move-form pir-inline-form" onSubmit={submit}>
    <div className="property-move-form-grid"><Amount label="내 세전 연봉" value={value.annual_me} onChange={annual_me=>setValue(v=>({...v,annual_me}))}/><Amount label="배우자 세전 연봉" value={value.annual_partner} onChange={annual_partner=>setValue(v=>({...v,annual_partner}))}/></div>
    <div className="property-move-form-grid">{(['lower','upper'] as const).map((key,i)=><label className="property-move-field" key={key}><span>{i?'PIR 최댓값':'PIR 최솟값'}</span><Input required type="number" min="0.1" max="100" step="0.1" value={value[key]||''} onChange={e=>setValue(v=>({...v,[key]:Number(e.target.value)}))}/></label>)}</div>
    <p className="property-move-note">PIR = 집값 ÷ 부부 세전 연봉 · 소득이 없으면 0 입력</p>
    {error&&<p role="alert" className="property-move-error">{error}</p>}
    <button className="property-move-button primary" disabled={busy}>{busy?'저장 중…':'연봉·PIR 저장'}</button>
  </form>
}
