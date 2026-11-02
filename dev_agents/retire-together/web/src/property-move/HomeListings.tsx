import { useEffect, useState } from 'react'
import { api } from '../local-data'
import { money, type Owner } from '../model'
import type { Address, HomeList } from '../property-entry'
import './home-market.css'

type PublicListing = { id: string; name: string; price: number; area: number; supply_area: number; floor_direction: string; checked_on: string; url: string }
type ListingsData = { status: 'matched' | 'unmatched'; source: string; source_url: string; fetched_at: string; partial: boolean; listings: PublicListing[]; summary: { low: number; high: number; count: number } | null }

export function usePublicListings(address: Address | null | undefined, name: string, area: number | null | undefined) {
  const [state, setState] = useState<{ loading: boolean; data: ListingsData | null; error?: string }>({ loading: false, data: null })
  const [rev, setRev] = useState(0)
  const bcode = address?.bcode, building = address?.building || name, jibun = address?.jibun
  useEffect(() => {
    if (!bcode || !area) { setState({ loading: false, data: null }); return }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    let live = true
    setState({ loading: true, data: null })
    api<ListingsData>(`/property/market/listings?${new URLSearchParams({ bcode, name: building, area: String(area), ...(jibun ? { jibun } : {}) })}`, 'GET', undefined, controller.signal)
      .then(data => { if (live) setState({ loading: false, data }) })
      .catch(e => { if (live) setState({ loading: false, data: null, error: controller.signal.aborted ? '조회 시간이 길어지고 있어요.' : e.message }) })
      .finally(() => clearTimeout(timeout))
    return () => { live = false; clearTimeout(timeout); controller.abort() }
  }, [bcode, building, jibun, area, rev])
  return { ...state, ready: !!bcode && !!area, retry: () => setRev(n => n + 1) }
}

export function PublicListings({ market, hidden, onManual }: { market: ReturnType<typeof usePublicListings>; hidden: boolean; onManual: () => void }) {
  const { data } = market
  const [all, setAll] = useState(false)
  return <div className="property-public-listings">
    <div className="property-public-heading"><h3>현재 매도 호가 <span>{data?.summary ? `광고 ${data.summary.count}건${data.partial ? ' · 일부 조회' : ''}` : ''}</span></h3><div><button type="button" className="property-move-link" onClick={onManual}>직접 기록·시세 관리</button>{data && <a className="property-move-link" href={data.source_url} target="_blank" rel="noreferrer">{data.source} ↗</a>}</div></div>
    {market.loading ? <p className="property-move-note" role="status">같은 전용면적의 공개 매물을 불러오고 있어요.</p>
      : market.error ? <p className="property-move-note">{market.error} <button type="button" className="property-move-link" onClick={market.retry}>다시 조회</button></p>
      : !market.ready ? <p className="property-move-note">집 정보에서 단지 주소와 전용면적을 선택하면 공개 매물을 연결해요.</p>
      : !data?.listings.length ? <p className="property-move-note">{data?.status === 'unmatched' ? '공개 매물 출처에서 이 단지를 정확히 연결하지 못했어요.' : '이 출처에서 같은 전용면적의 매물을 확인하지 못했어요.'}</p>
      : <>
        <div className="property-public-rows">{data.listings.slice(0, all ? undefined : 3).map(l => <a href={l.url} target="_blank" rel="noreferrer" className="property-public-row" key={l.id} aria-label={`${l.name} 매물 원문`}><strong>{hidden ? '••••' : money(l.price)}</strong><span>{l.name}<small>전용 {l.area}㎡ · {l.floor_direction}</small></span><time dateTime={l.checked_on}>{l.checked_on.slice(2).replaceAll('-', '.')} 확인 ↗</time></a>)}</div>
        {data.listings.length > 3 && <button type="button" className="property-move-link property-public-more" onClick={() => setAll(v => !v)}>{all ? '접기' : `조회한 매물 ${data.listings.length}건 모두 보기`}</button>}
      </>}
    {data && <p className="property-move-note property-public-source">전용면적 ±2㎡ · 광고 중복 가능 · {new Date(data.fetched_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 조회{data.partial ? ' · 일부 페이지만 조회했어요. 전체는 출처에서 확인해 주세요.' : ''} · 실제 매도금액과 다를 수 있어요.</p>}
  </div>
}

export function HomeSaleSummary({ homes, hidden, owner }: { homes: HomeList; hidden: boolean; owner: Owner }) {
  if (!homes.homes.length) return null
  const show = (n: number) => hidden ? '••••' : money(n)
  const missing = homes.homes.some(h => h.detail?.value_source?.kind === 'none' || h.full_value <= 0)
  const review = homes.homes.filter(h => h.detail?.value_source?.kind === 'purchase' || (Date.now() - Date.parse(h.asset.as_of)) / 86_400_000 > 90).length
  return <div className="property-sale-summary" aria-label="전체 매도 합계">
    <div className="property-sale-net"><span>{owner === 'together' ? '우리 집을 모두 팔면 남는 금액' : '선택한 소유자 지분을 팔면 남는 금액'}</span><strong>{missing ? '시세 확인 필요' : show(homes.total.equity)}</strong><small>등록 시세 기준 · 매도세금·중개비 차감 전</small></div>
    <dl><div><dt>매도금액 합계 · {homes.homes.length}채</dt><dd>{missing ? '미확인 시세 포함' : show(homes.total.value)}</dd></div><div><dt>− 연결 대출</dt><dd>{show(homes.total.loans)}</dd></div><div><dt>− 반환할 보증금</dt><dd>{show(homes.total.deposit)}</dd></div></dl>
    {(missing || review > 0) && <p>{missing ? '시세가 없는 집이 있어 전체 매도 합계를 확정할 수 없어요.' : `${review}채는 매입가 또는 90일이 지난 등록 시세를 사용해요.`} 아래 실거래·호가를 확인하고 시세를 갱신해 주세요.</p>}
  </div>
}
