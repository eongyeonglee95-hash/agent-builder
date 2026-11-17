import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { api } from '../local-data'
import type { Owner } from '../model'
import { Amount } from '../components/ui/amount'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ObservationRow } from '../components/ui/observation-row'
import { day } from '../lib/format'
import type { MoveState } from './types'

type Area = { area: number; count: number; median: number; latest: { price: number; date: string; area: number; floor: number | null } }
type Watch = { configured: boolean; months?: number; watch: { id: string; name: string; missing?: string; summary: { count: number; excluded_large: number; areas: Area[] } | null }[] }
type Load<T> = { data: T | null; loading: boolean; error: boolean }
type Place = { name: string; distance_m: number }
type Places = { radius_m: number; fetched_at: Record<string, string>; items: { id: string; places: { department: Place | null; park_large: Place | null; hospital_tertiary: Place | null; hospital_general: Place | null; parks_within: number | null } | null }[] }

function useRead<T>(path: string, revision: number) {
  const [state, setState] = useState<Load<T>>({ data: null, loading: true, error: false })
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState({ data: null, loading: true, error: false })
    const timer = setTimeout(() => { if (active) { setState({ data: null, loading: false, error: true }); controller.abort() } }, 120000)
    api<T>(path, 'GET', undefined, controller.signal)
      .then(data => { if (active) setState({ data, loading: false, error: false }) })
      .catch(() => { if (active) setState({ data: null, loading: false, error: true }) })
      .finally(() => clearTimeout(timer))
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [path, revision])
  return state
}

function NearbyPlaces({ owner, id }: { owner: Owner; id: string }) {
  const result = useRead<Places>(`/property-move/places?owner=${owner}`, 0)
  if (result.loading) return <p role="status" className="text-xs text-grey-600">입지 조회 중…</p>
  if (result.error) return <p className="text-xs text-grey-600">입지 조회 실패</p>
  const places = result.data?.items.find(item => item.id === id)?.places
  if (!places) return null
  return <div className="space-y-2">
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{([
      ['백화점', places.department], ['큰 공원', places.park_large], ['상급종합병원', places.hospital_tertiary], ['종합병원', places.hospital_general],
    ] as [string, Place | null][]).map(([label, place]) => <div key={label}><dt className="text-xs text-grey-600">{label}</dt><dd className="mt-1">{place?.name ?? '—'}</dd>{place && <dd className="text-xs text-grey-600">직선 {place.distance_m.toLocaleString('ko-KR')}m</dd>}</div>)}</dl>
    <p className="text-xs text-grey-600">반경 {result.data?.radius_m.toLocaleString('ko-KR')}m 공원 {places.parks_within ?? '—'}곳</p>
    <details className="text-xs text-grey-600"><summary className="cursor-pointer">입지 출처</summary><p className="mt-2">좌표: 브이월드 · 백화점: 등록 목록 ({day(result.data?.fetched_at.department)}) · 공원: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">© OpenStreetMap contributors</a> ({day(result.data?.fetched_at.park)}) · 병원: 심평원 ({day(result.data?.fetched_at.hospital)})</p></details>
  </div>
}

export function ObservationBoard({ owner, hidden, brief, onManage }: { owner: Owner; hidden: boolean; brief: boolean; onManage: () => void }) {
  const [revision, setRevision] = useState(0)
  const state = useRead<MoveState>(`/property-move?owner=${owner}`, revision)
  const trades = useRead<Watch>(`/property-move/watch?owner=${owner}`, revision)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('name')
  const [open, setOpen] = useState<string | null>(null)
  const [areas, setAreas] = useState<Record<string, number>>({})
  const data = state.data
  if (state.loading) return <p role="status" className="py-8 text-sm text-grey-600">불러오는 중…</p>
  if (state.error || !data) return <div role="alert" className="flex items-center gap-3 py-8 text-sm">관심 단지를 불러오지 못했어요.<Button variant="outline" onClick={() => setRevision(n => n + 1)}>다시 조회</Button></div>
  const validFunds = !data.missing_home_ids.length && !data.valuation_needs_review.length
  const candidates = data.plan.candidates.filter(c => `${c.name} ${c.address?.jibun ?? ''}`.replaceAll(' ', '').includes(query.replaceAll(' ', '')))
    .sort((a, b) => {
      if (sort === 'asking') return (a.asking_low ?? Infinity) - (b.asking_low ?? Infinity) || a.name.localeCompare(b.name, 'ko')
      if (sort === 'gap') return (data.comparisons.find(x => x.id === a.id)?.gap ?? Infinity) - (data.comparisons.find(x => x.id === b.id)?.gap ?? Infinity) || a.name.localeCompare(b.name, 'ko')
      return a.name.localeCompare(b.name, 'ko')
    })
  return <div className="min-w-0 space-y-4" aria-label={brief ? '실제 자료 브리핑' : '등록 관심 단지'}>
    {brief && <div className="grid grid-cols-2 gap-4 rounded-md border border-grey-200 bg-background p-4 sm:grid-cols-3">
      {[{ label: '매도 후 남는 돈', value: data.plan.source_home_ids.length && validFunds ? data.funds.sale_net : null, detail: data.plan.sale_costs == null ? '매도비용 미입력' : '등록 시세 기준' },
        { label: '이사에 쓸 현금', value: data.plan.cash, detail: '' },
        { label: '추가 대출 계획', value: data.plan.new_loan, detail: '' }].map((m, i) => <div key={m.label} className={i === 0 ? 'col-span-2 sm:col-span-1' : undefined}><div className="text-xs text-grey-600">{m.label}</div><div className="mt-2 text-xl font-semibold sm:text-2xl"><Amount value={m.value} fmt="manwon" hidden={hidden}/></div>{m.detail && <div className="mt-1 text-xs text-grey-600">{m.detail}</div>}</div>)}
    </div>}
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col text-xs text-grey-600">단지·지역<Input aria-label="관심 단지 검색" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="단지명 또는 지역" className="mt-1 w-full sm:w-60"/></label>
        <label className="text-xs text-grey-600">정렬<select aria-label="관심 단지 정렬" className="mt-1 block h-9 rounded-md border border-input bg-background px-2 text-sm text-grey-900" value={sort} onChange={e => setSort(e.target.value)}><option value="name">단지명</option><option value="asking">기록 호가 낮은 순</option><option value="gap">추가 자금 적은 순</option></select></label>
      </div>
      <div className="flex gap-2"><Button variant="outline" size="sm" disabled={trades.loading} onClick={() => setRevision(n => n + 1)}><RefreshCw className="size-3.5"/>새로고침</Button><Button size="sm" onClick={onManage}>단지·자금 관리</Button></div>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-grey-600"><span>관심 {data.plan.candidates.length}곳</span>
      {trades.loading ? <span role="status">실거래 조회 중…</span> : trades.error ? <span role="alert">실거래 조회 실패</span> : trades.data?.configured ? <span>국토교통부 · 최근 {trades.data.months}개월</span> : <button onClick={onManage} className="underline">실거래 연결 설정</button>}
      {!validFunds && <button className="underline" onClick={onManage}>내 집 시세·자금 확인</button>}
    </div>
    <div className="overflow-hidden rounded-md border border-grey-200">
      {!candidates.length && <div className="bg-background p-8 text-sm text-grey-600">{query ? '검색 결과가 없어요.' : '등록한 관심 단지가 없어요.'}</div>}
      {candidates.map(c => {
        const summary = trades.data?.watch.find(w => w.id === c.id)
        const chosenArea = areas[c.id] ?? (c.area_m2 == null ? null : Math.floor(c.area_m2))
        const area = summary?.summary?.areas.find(a => a.area === chosenArea)
        const originalArea = areas[c.id] == null || (c.area_m2 != null && areas[c.id] === Math.floor(c.area_m2))
        const comparison = data.comparisons.find(b => b.id === c.id)
        const expanded = open === c.id
        return <ObservationRow key={c.id}
          title={<button className="flex w-full items-start justify-between gap-2 text-left" aria-expanded={expanded} aria-controls={`observation-${c.id}`} onClick={() => setOpen(expanded ? null : c.id)}>{c.name}{expanded ? <ChevronUp className="size-4 shrink-0"/> : <ChevronDown className="size-4 shrink-0"/>}</button>}
          subtitle={summary?.summary?.areas.length ? <select aria-label={`${c.name} 전용면적`} className="mt-1 max-w-full rounded-md border border-input bg-background p-1 text-xs" value={chosenArea ?? ''} onChange={e => setAreas(old => ({ ...old, [c.id]: Number(e.target.value) }))}><option value="" disabled>평형 선택</option>{chosenArea != null && !area && <option value={chosenArea}>전용 {chosenArea}㎡대 · 거래 없음</option>}{summary.summary.areas.map(a => <option value={a.area} key={a.area}>전용 {a.area}㎡대</option>)}</select> : c.area_m2 ? `전용 ${c.area_m2}㎡` : '평형 미지정'}
          metrics={[
            { label: '기록 호가', value: <Amount value={originalArea ? c.asking_low : null} fmt="manwon" hidden={hidden}/>, detail: originalArea && c.asking_low != null ? day(c.asking_date) : undefined },
            { label: '최근 실거래', value: <Amount value={area?.latest.price} fmt="manwon" hidden={hidden}/>, detail: area ? `${day(area.latest.date)} · ${area.latest.floor ?? '—'}층` : summary?.missing },
            { label: `거래 중간값 · ${trades.data?.months ?? 12}개월`, value: <Amount value={area?.median} fmt="manwon" hidden={hidden}/>, detail: area ? `${area.count}건 · 전용 ${area.area}㎡대` : undefined },
            { label: '추가 자금 · 계획가 기준', value: <Amount value={validFunds && originalArea ? comparison?.gap : null} fmt="manwon" hidden={hidden}/>, detail: comparison?.gap != null && validFunds && originalArea && !comparison.costs_complete ? '미입력 비용 제외' : undefined },
          ]}>
          {expanded && <div id={`observation-${c.id}`} className="mt-4 space-y-4 border-t border-grey-200 pt-4">
            <div className="grid gap-4 sm:grid-cols-2"><div className="text-xs text-grey-600">계획 매수가 <Amount value={c.price} fmt="manwon" hidden={hidden}/> · {day(c.price_date)}</div><div className="text-xs text-grey-600">{c.address?.jibun || '주소 미등록'}</div></div>
            {!!summary?.summary?.areas.length && <div className="overflow-x-auto"><table className="w-full text-right text-sm tabular-nums"><caption className="mb-2 text-left text-xs text-grey-600">평형별 실거래 · 국토교통부</caption><thead className="bg-grey-50 text-xs text-grey-600"><tr>{['전용면적', '최근 거래', '계약일·층', '중간값', '거래 수'].map(t => <th className="whitespace-nowrap p-2 font-medium" key={t}>{t}</th>)}</tr></thead><tbody>{summary.summary.areas.map(a => <tr key={a.area} className="border-t border-grey-200"><td className="p-2">{a.area}㎡대</td><td className="p-2"><Amount value={a.latest.price} hidden={hidden} fmt="manwon"/></td><td className="whitespace-nowrap p-2 text-xs">{day(a.latest.date)} · {a.latest.floor ?? '—'}층</td><td className="p-2"><Amount value={a.median} hidden={hidden} fmt="manwon"/></td><td className="p-2">{a.count}건</td></tr>)}</tbody></table></div>}
            {!hidden && <dl className="grid gap-3 text-sm sm:grid-cols-2">{[['교통·출퇴근', c.living?.commute], ['학교', c.living?.school], ['생활·입지', c.living?.life], ['확인할 점', c.living?.concerns], ['메모', c.memo]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs text-grey-600">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>}
            <NearbyPlaces owner={owner} id={c.id}/>
            <Button size="sm" variant="outline" onClick={onManage}>등록 정보 수정</Button>
          </div>}
        </ObservationRow>
      })}
    </div>
  </div>
}
