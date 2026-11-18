import { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { Amount } from '../components/ui/amount'
import { day } from '../lib/format'
import { api } from '../local-data'
import { money, type Owner } from '../model'
import type { Address, HomeList } from '../property-entry'
import './home-market.css'

type PublicListing = { id: string; name: string; price: number; monthly?: number; area: number; supply_area: number; floor_direction: string; checked_on: string; url: string }
type ListingsData = { stale?: boolean; rent_offer?: { deposit: number; monthly: number } | null; status: 'matched' | 'unmatched'; source: string; source_url: string; fetched_at: string; partial: boolean; listings: PublicListing[]; summary: { low: number; high: number; count: number } | null }

export function usePublicListings(address: Address | null | undefined, name: string, area: number | null | undefined, kind: 'P' | 'L' | 'M' = 'P') {
  const [state, setState] = useState<{ loading: boolean; data: ListingsData | null; error?: string }>({ loading: false, data: null })
  const [rev, setRev] = useState(0)
  const bcode = address?.bcode, building = address?.building || name, jibun = address?.jibun
  useEffect(() => {
    if (!bcode || !area) { setState({ loading: false, data: null }); return }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    let live = true
    setState({ loading: true, data: null })
    api<ListingsData>(`/property/market/listings?${new URLSearchParams({ bcode, name: building, area: String(area), kind, ...(jibun ? { jibun } : {}) })}`, 'GET', undefined, controller.signal)
      .then(data => { if (live) setState({ loading: false, data }) })
      .catch(e => { if (live) setState({ loading: false, data: null, error: controller.signal.aborted ? '조회 시간이 길어지고 있어요.' : e.message }) })
      .finally(() => clearTimeout(timeout))
    return () => { live = false; clearTimeout(timeout); controller.abort() }
  }, [bcode, building, jibun, area, kind, rev])
  return { ...state, ready: !!bcode && !!area, retry: () => setRev(n => n + 1) }
}

export function PublicListings({ market, hidden, onManual }: { market: ReturnType<typeof usePublicListings>; hidden: boolean; onManual: () => void }) {
  const { data } = market
  const [all, setAll] = useState(false)
  return <div className="property-public-listings">
    <div className="property-public-heading"><h3>매물 목록 <span>{data?.summary ? `광고 ${data.summary.count}건${data.partial ? ' · 일부 조회' : ''}` : ''}</span></h3><div><button type="button" className="property-move-link" onClick={onManual}>직접 기록·시세 관리</button>{data && <a className="property-move-link" href={data.source_url} target="_blank" rel="noreferrer">{data.source} ↗</a>}</div></div>
    {market.loading ? <p className="property-move-note" role="status">같은 전용면적의 공개 매물을 불러오고 있어요.</p>
      : market.error ? <p className="property-move-note">{market.error} <button type="button" className="property-move-link" onClick={market.retry}>다시 조회</button></p>
      : !market.ready ? <p className="property-move-note">집 정보에서 단지 주소와 전용면적을 선택하면 공개 매물을 연결해요.</p>
      : !data?.listings.length ? <p className="property-move-note">{data?.status === 'unmatched' ? '공개 매물 출처에서 이 단지를 정확히 연결하지 못했어요.' : '이 출처에서 같은 전용면적의 매물을 확인하지 못했어요.'}</p>
      : <>
        <div className="property-public-rows">{data.listings.slice(0, all ? undefined : 3).map(l => <a href={l.url} target="_blank" rel="noreferrer" className="property-public-row" key={l.id} aria-label={`${l.name} 매물 원문`}><strong>{hidden ? '••••' : l.monthly != null ? `${money(l.price)} / 월 ${money(l.monthly)}` : money(l.price)}</strong><span>{l.name}<small>전용 {l.area}㎡ · {l.floor_direction}</small></span><time dateTime={l.checked_on}>{l.checked_on.slice(2).replaceAll('-', '.')} 확인 ↗</time></a>)}</div>
        {data.listings.length > 3 && <button type="button" className="property-move-link property-public-more" onClick={() => setAll(v => !v)}>{all ? '접기' : `조회한 매물 ${data.listings.length}건 모두 보기`}</button>}
      </>}
    {data && <p className="property-move-note property-public-source">{new Date(data.fetched_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 조회{data.partial ? ' · 일부 페이지만 조회했어요. 전체는 출처에서 확인해 주세요.' : ''}{data.stale ? ' · 갱신 실패, 이전 자료' : ''}</p>}
  </div>
}

export function HomeListingSummary({ sale, address, name, area, hidden, onManual }: {
  sale: ReturnType<typeof usePublicListings>; address: Address | null | undefined; name: string; area: number | null | undefined; hidden: boolean; onManual: () => void
}) {
  const lease = usePublicListings(address, name, area, 'L')
  const monthly = usePublicListings(address, name, area, 'M')
  const [expanded, setExpanded] = useState<string | null>(null)
  const groups = [{ id: 'P', label: '최근 매매 호가', market: sale }, { id: 'L', label: '전세', market: lease }, { id: 'M', label: '월세', market: monthly }]
  const selected = groups.find(g => g.id === expanded)
  return <div className="border-t border-grey-200">
    <div className="grid grid-cols-1 gap-3 bg-grey-50 px-4 py-3 sm:grid-cols-3">
      {groups.map(({ id, label, market }) => <div key={id} className="min-w-0">
        <div className="flex items-center justify-between gap-2"><span className="text-xs text-grey-600">{label}</span><Button variant="ghost" size="xs" aria-label={label + (expanded === id ? ' 접기' : ' 더보기')} aria-expanded={expanded === id} onClick={() => setExpanded(expanded === id ? null : id)}>{expanded === id ? '접기' : '더보기'}</Button></div>
        <div className="mt-1 text-base font-semibold">{market.loading ? '조회 중…' : id === 'M' ? market.data?.rent_offer ? <><Amount value={market.data.rent_offer.deposit} fmt="manwon" hidden={hidden}/><span className="mx-1 text-xs font-normal">/ 월</span><Amount value={market.data.rent_offer.monthly} fmt="manwon" hidden={hidden}/></> : '—' : <Amount value={market.data?.summary?.low} fmt="manwon" hidden={hidden}/>}</div>
        <div className="mt-1 text-xs text-grey-600">{market.error ? '조회 실패' : market.data ? `${market.data.status === 'matched' ? `${id === 'M' ? '월 최저' : '최저'} · 광고 ${market.data.listings.length}건` : '단지 미연결'} · ${day(market.data.fetched_at)} 조회${market.data.stale ? ' · 이전 자료' : ''}${market.data.partial ? ' · 일부 조회' : ''}` : '—'}</div>
      </div>)}
    </div>
    {selected && <PublicListings market={selected.market} hidden={hidden} onManual={onManual}/>}
  </div>
}

export function HomeSaleSummary({ homes, hidden, owner }: { homes: HomeList; hidden: boolean; owner: Owner }) {
  if (!homes.homes.length) return null
  const show = (n: number) => hidden ? '••••' : money(n)
  const missing = homes.homes.some(h => h.detail?.value_source?.kind === 'none' || h.full_value <= 0)
  const review = homes.homes.filter(h => h.detail?.value_source?.kind === 'purchase' || (Date.now() - Date.parse(h.asset.as_of)) / 86_400_000 > 90).length
  return <div className="property-sale-summary" aria-label="전체 매도 합계">
    <div className="property-sale-net"><span>{owner === 'together' ? '순자산' : '선택 지분 순자산'}</span><strong>{missing ? '시세 확인 필요' : show(homes.total.equity)}</strong><small>등록 시세 기준 · 세금·중개비 제외</small></div>
    <dl><div><dt>등록 시세 · {homes.homes.length}채</dt><dd>{missing ? '미확인 시세 포함' : show(homes.total.value)}</dd></div><div><dt>대출</dt><dd>{show(homes.total.loans)}</dd></div><div><dt>반환 보증금</dt><dd>{show(homes.total.deposit)}</dd></div></dl>
    {(missing || review > 0) && <p>{missing ? '시세 미등록' : `시세 확인 필요 ${review}채 · 매입가 또는 90일 경과`}</p>}
  </div>
}
