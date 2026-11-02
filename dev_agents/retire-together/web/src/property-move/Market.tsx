import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '../local-data'
import { money } from '../model'
import type { Address } from '../property-entry'
import type { PriceCheck } from './types'

export type Trade = { name: string; area: number; price: number; date: string; floor: number | null; kind: string }
type TradeState = { loading: boolean; configured?: boolean; trades: Trade[]; error?: string }
export function useTrades(address: Address | null | undefined, name: string, area: number | null | undefined) {
  const [state, setState] = useState<TradeState>({ loading: false, trades: [] })
  const [rev, setRev] = useState(0)
  const sigungu = address?.sigungu_code, building = address?.building || name
  const dong = address?.jibun.split(' ').reverse().find(w => /\S+(동|가|리)$/.test(w))
  useEffect(() => {
    if (!sigungu || !area) { setState({ loading: false, trades: [] }); return }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    let live = true
    setState({ loading: true, trades: [] })
    api<{ configured: boolean; trades: Trade[] }>(`/property/trades?${new URLSearchParams({ sigungu, name: building, area: String(area), ...(dong ? { dong } : {}) })}`, 'GET', undefined, controller.signal)
      .then(r => { if (live) setState({ loading: false, ...r }) })
      .catch(e => { if (live) setState({ loading: false, trades: [], error: controller.signal.aborted ? '조회 시간이 길어지고 있어요. 다시 조회해 주세요.' : e.message }) })
      .finally(() => clearTimeout(timeout))
    return () => { live = false; clearTimeout(timeout); controller.abort() }
  }, [sigungu, building, area, dong, rev])
  return { ...state, ready: !!sigungu && !!area, retry: () => setRev(v => v + 1) }
}
export type MarketState = ReturnType<typeof useTrades>
export function TradePrice({ market, hidden }: { market: MarketState; hidden: boolean }) {
  const latest = market.trades[0]
  return <><strong>{hidden ? '••••' : latest ? money(latest.price) : market.loading ? '조회 중…' : '—'}</strong><small>{latest ? `${latest.date.replaceAll('-', '.')} · ${latest.floor ?? '—'}층 · ${latest.area}㎡` : !market.ready ? '주소·전용면적 입력 필요' : market.loading ? '국토교통부 조회 중' : market.configured === false ? '실거래 연결 설정 필요' : market.error ? '조회 실패 · 다시 확인' : '최근 12개월 거래 없음'}</small></>
}
export function TradeReport({ market, hidden, purchase, onPick }: { market: MarketState; hidden: boolean; purchase?: number | null; onPick?: (t: Trade) => void }) {
  const [selected, setSelected] = useState(0)
  const t = market.trades[Math.min(selected, market.trades.length - 1)]
  const series = [...market.trades].reverse()
  const prices = series.map(t => t.price)
  const low = Math.min(...prices), high = Math.max(...prices)
  const min = Math.min(low, purchase || low) * .95, max = Math.max(high, purchase || high) * 1.05
  const y = (value: number) => 132 - (value - min) / (max - min || 1) * 104
  const dates = series.map(t => Date.parse(t.date)), start = Math.min(...dates), end = Math.max(...dates)
  const x = (date: string) => end === start ? 260 : 32 + (Date.parse(date) - start) / (end - start) * 456
  return <div className="property-move-report">
    <div className="property-move-section-head"><div><h3>실거래 리포트</h3><p>국토교통부 · 최근 12개월, 최대 30건 · 전용면적 ±2㎡</p></div><button className="property-move-icon-button" aria-label="실거래 다시 조회" disabled={!market.ready || market.loading} onClick={market.retry}><RefreshCw size={16}/></button></div>
    {market.error && <p className="property-move-notice" role="alert">{market.error}</p>}
    {!market.trades.length ? <p className="property-move-empty-copy">{!market.ready ? '주소와 전용면적을 저장하면 같은 단지의 거래를 확인할 수 있어요.' : market.loading ? '실거래를 조회하고 있어요.' : market.configured === false ? '실거래 연결 설정 후 거래를 확인할 수 있어요.' : market.error ? '다시 조회하거나 나중에 확인해 주세요.' : '이 단지·면적의 최근 12개월 거래가 없어요.'}</p> : <>
      {!hidden && <svg className="property-move-trade-chart" viewBox="0 0 520 160" role="img" aria-label={`최근 ${series.length}건 실거래, 최저 ${money(low)}, 최고 ${money(high)}`}>
        {[30, 80, 130].map(y => <path key={y} d={`M24 ${y}H496`} stroke="var(--border)"/>)}
        {purchase && <><path d={`M24 ${y(purchase)}H496`} stroke="var(--grey-500)" strokeDasharray="4 4"/><text x="26" y={y(purchase) - 7}>매입가 {money(purchase)}</text></>}
        <polyline points={series.map(t => `${x(t.date)},${y(t.price)}`).join(' ')} fill="none" stroke="var(--cls-long-bond)" strokeWidth="2"/>
        {series.map((t, i) => <circle key={i} cx={x(t.date)} cy={y(t.price)} r="4" fill="var(--cls-long-bond)"><title>{t.date} · {t.floor}층 · {money(t.price)}</title></circle>)}
        <text x="24" y="154">{series[0].date}</text><text x="496" y="154" textAnchor="end">{series[series.length - 1].date}</text>
      </svg>}
      <div className="property-move-trade-stats"><span>조회 기간 최저 <b>{hidden ? '••••' : money(low)}</b></span><span>조회 기간 최고 <b>{hidden ? '••••' : money(high)}</b></span></div>
      <div className="property-move-trade-list" aria-label="실거래 내역">{market.trades.slice(0, 8).map((t, i) => <button type="button" key={i} className={selected === i ? 'on' : ''} aria-pressed={selected === i} onClick={() => setSelected(i)}><span>{t.date}</span><span>{t.floor ?? '—'}층 · {t.area}㎡</span><b>{hidden ? '••••' : money(t.price)}</b></button>)}</div>
      {onPick && t && <button type="button" className="property-move-button" onClick={() => onPick(t)}>선택한 실거래를 계획 매수가로 사용</button>}
    </>}
  </div>
}

// 호가 vs 과거 실거래: 서버가 숫자만 돌려준다(적정 판단 없음). 패널을 펼쳤을 때만 조회한다.
export function usePriceCheck(address: Address | null | undefined, name: string, area: number | null | undefined, asking: number | null, months: number) {
  const [state, setState] = useState<{ loading: boolean; data: PriceCheck | null; error?: string }>({ loading: false, data: null })
  const [rev, setRev] = useState(0)
  const sigungu = address?.sigungu_code, building = address?.building || name
  const dong = address?.jibun.split(' ').reverse().find(w => /\S+(동|가|리)$/.test(w))
  useEffect(() => {
    if (!sigungu || !area) { setState({ loading: false, data: null }); return }
    const controller = new AbortController()
    let live = true
    setState(s => ({ loading: true, data: s.data }))
    api<PriceCheck>(`/property-move/price-check?${new URLSearchParams({ sigungu, name: building, area: String(area), months: String(months), ...(asking ? { asking: String(asking) } : {}), ...(dong ? { dong } : {}) })}`, 'GET', undefined, controller.signal)
      .then(d => { if (live) setState({ loading: false, data: d }) })
      .catch(e => { if (live) setState({ loading: false, data: null, error: controller.signal.aborted ? '조회 시간이 길어지고 있어요. 다시 조회해 주세요.' : e.message }) })
    return () => { live = false; controller.abort() }
  }, [sigungu, building, area, asking, months, dong, rev])
  return { ...state, ready: !!sigungu && !!area, retry: () => setRev(v => v + 1) }
}
