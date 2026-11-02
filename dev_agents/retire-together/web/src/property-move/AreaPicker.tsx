import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { api } from '../local-data'
import type { Address } from '../property-entry'

type Area = { area: number; min: number; max: number; supply_pyeong: number[] }
type Areas = { areas: Area[]; sources: string[]; warnings: string[] }

export function AreaPicker({ address, name, value, onChange }: { address: Address | null; name: string; value: number | null; onChange: (area: number | null) => void }) {
  const [data, setData] = useState<Areas | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [manual, setManual] = useState(false)
  const [rev, setRev] = useState(0)
  const bcode = address?.bcode, building = address?.building || name, jibun = address?.jibun
  useEffect(() => {
    setData(null); setError(''); setLoading(false); setManual(false)
    if (!bcode) return
    let live = true
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    setLoading(true)
    api<Areas>(`/property/market/areas?${new URLSearchParams({ bcode, name: building, ...(jibun ? { jibun } : {}) })}`, 'GET', undefined, controller.signal)
      .then(r => { if (live) setData(r) })
      .catch(() => { if (live) setError('면적 목록을 불러오지 못했어요. 직접 입력할 수 있어요.') })
      .finally(() => { clearTimeout(timeout); if (live) setLoading(false) })
    return () => { live = false; clearTimeout(timeout); controller.abort() }
  }, [bcode, building, jibun, rev])
  const matched = data?.areas.some(a => value !== null && Math.floor(a.area) === Math.floor(value))
  return <fieldset className="property-area-picker"><legend>추적할 평형</legend>
    {loading && <p className="property-move-note" role="status">이 단지의 거래·매물에서 전용면적을 찾고 있어요.</p>}
    {!!data?.areas.length && <><div className="property-area-options">{data.areas.map(a => <button type="button" key={a.area} aria-pressed={value !== null && Math.floor(value) === Math.floor(a.area)} onClick={() => { onChange(a.area); setManual(false) }}><strong>전용 {Math.floor(a.area)}㎡ {value !== null && Math.floor(value) === Math.floor(a.area) && <Check size={14} aria-hidden="true"/>}</strong><span>{a.supply_pyeong.length ? `공급 약 ${a.supply_pyeong.join('·')}평형` : '공급면적 미확인'}</span><small>{a.min === a.max ? a.min : `${a.min}~${a.max}`}㎡</small></button>)}</div><p className="property-move-note">거래·매물에서 확인한 평형입니다. 같은 전용면적의 타입은 함께 추적해요.</p></>}
    {error && <p className="property-move-note">{error} <button className="property-move-link" type="button" onClick={() => setRev(n => n + 1)}>다시 조회</button></p>}
    {!!data?.warnings.length && <p className="property-move-note">{data.warnings.join(' · ')} · 확인된 자료만 표시해요.</p>}
    {data && !data.areas.length && <p className="property-move-note">이 단지에서 확인된 면적이 없어요. 알고 있는 전용면적을 입력해 주세요.</p>}
    {!bcode && <p className="property-move-note">단지를 검색하면 실제 확인된 평형을 고를 수 있어요.</p>}
    {(manual || !data?.areas.length || (value !== null && !matched)) ? <label className="property-move-field"><span>전용면적 (㎡)</span><input type="number" min="1" max="2000" step="0.01" value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} placeholder="예: 84.99"/></label> : <button type="button" className="property-move-link" onClick={() => setManual(true)}>다른 전용면적 직접 입력</button>}
  </fieldset>
}
