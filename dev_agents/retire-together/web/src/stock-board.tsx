import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/ui/tabs'
import { PageHero, type HeroMetric } from './components/ui/page-hero'
import { Input } from './components/ui/input'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './components/ui/button'
import { HoldingsPanel, type HoldingsData } from './holdings'
import type { Owner } from './model'
import './stock-board.css'
import { api } from './local-data'

export type StockDiagnostics = {
  positions: { name: string; value: number; weight: number }[]
  top_one_weight: number | null; top_three_weight: number | null
  quote_covered: number; quote_total: number; daily_rate: number | null
  daily_drivers: { name: string; account_id: string; amount: number; contribution_pp: number }[]
}
type Indicator = { symbol: string; label: string; kind: string; value: number | null; as_of: string | null; change?: number | null; change_rate?: number | null; change_bp?: number | null; source_url?: string; status: string }
function MacroStrip() {
  const [items, setItems] = useState<Indicator[]>([])
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setError(false)
    api<{ items: Indicator[] }>('/stock-market').then(result => { if (active) setItems(result.items) }).catch(() => { if (active) { setError(true); setItems([]) } })
    return () => { active = false }
  }, [revision])
  const signed = (n: number | null | undefined, suffix: string) => n == null ? '변화 미확인' : `${n > 0 ? '+' : ''}${n.toFixed(2)}${suffix}`
  return <section aria-label="매크로 지표" className="sq-macro">
    <div className="sq-macro-values">{items.length ? items.map(item => <div key={item.symbol}><span>{item.label}</span><strong>{item.value == null ? '—' : item.value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{item.value != null && item.kind === 'yield' ? '%' : ''}</strong><b className={(item.change ?? 0) < 0 ? 'sq-down' : (item.change ?? 0) > 0 ? 'sq-up' : ''}>{item.status !== 'ok' ? '조회 불가' : item.kind === 'yield' ? signed(item.change_bp, 'bp') : item.kind === 'fx' ? signed(item.change, '원') : signed(item.change_rate, '%')}</b>{item.as_of && <time dateTime={item.as_of}>{new Date(item.as_of).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} KST</time>}{item.source_url && <a href={item.source_url} target="_blank" rel="noopener noreferrer" aria-label={`${item.label} 시세 출처`}>출처</a>}</div>) : <p role="status">{error ? '매크로 지표를 불러오지 못했어요.' : 'S&P 500 · 나스닥 100 · 코스피 · 원/달러 · 미국 10년물 조회 중…'}</p>}</div>
    <div className="sq-macro-foot"><small>Yahoo Finance · 전일 종가 대비 · 지연 가능 · 최대 5분 캐시 · 지표별 기준 시각 확인</small><Button variant="ghost" size="sm" onClick={() => setRevision(n => n + 1)}>다시 조회</Button></div>
  </section>
}

// Public symbols only. No balances, ownership, or account details are sent to the provider.
function MarketWidget({ index = 'SPX500' }: { index?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [waiting, setWaiting] = useState(true)
  useEffect(() => {
    const node = host.current
    if (!node) return
    setFailed(false); setWaiting(true)
    const mount = document.createElement('div')
    mount.className = 'tradingview-widget-container__widget'
    node.replaceChildren(mount)
    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js'
    script.async = true
    script.textContent = JSON.stringify({
      dataSource: index, blockSize: 'market_cap_basic', blockColor: 'change', grouping: 'sector',
      locale: 'kr', colorTheme: 'light', exchanges: [], hasTopBar: false, isDataSetEnabled: false,
      isZoomEnabled: true, hasSymbolTooltip: true, isMonoSize: false, width: '100%', height: '100%',
    })
    let disposed = false
    script.onerror = () => { if (!disposed) setFailed(true) }
    let frameLoaded = false
    const timer = window.setTimeout(() => { if (!disposed && !frameLoaded) { setFailed(true); setWaiting(false) } }, 15000)
    const observer = new MutationObserver(() => {
      node.querySelectorAll('iframe').forEach(frame => { frame.title = 'TradingView 주식 시장 히트맵'; frame.onload = () => { if (!disposed) { frameLoaded = true; setWaiting(false) } } })
    })
    observer.observe(node, { childList: true, subtree: true })
    node.appendChild(script)
    return () => { disposed = true; clearTimeout(timer); observer.disconnect(); node.replaceChildren() }
  }, [index, attempt])
  return <div className="sq-widget sq-heatmap">
    <div ref={host} className="tradingview-widget-container" hidden={failed}/>
    {waiting && !failed && <p className="sq-widget-loading" role="status">시장 히트맵을 불러오는 중…</p>}
    {failed && <div className="sq-widget-error" role="status"><p>시장 데이터를 불러오지 못했어요.</p><Button variant="outline" onClick={() => setAttempt(n => n + 1)}>다시 불러오기</Button></div>}
    <div className="sq-widget-foot"><a className="sq-attribution" href="https://www.tradingview.com/heatmap/stock/" target="_blank" rel="noopener noreferrer">Stock Heatmap by TradingView · 원문 보기</a><Button variant="ghost" size="sm" onClick={() => setAttempt(n => n + 1)}>히트맵 다시 불러오기</Button></div>
  </div>
}

const percent = (n: number | null | undefined) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
export function StockOverview({ data, hidden = false, actions, footer, market = false }: { market?: boolean; data: HoldingsData | null; hidden?: boolean; actions?: ReactNode; footer?: ReactNode }) {
  const t = data?.total
  const show = (n: number | null) => hidden ? '••••••' : n == null ? '—' : `${n.toLocaleString('ko-KR')}원`
  const tone = (n: number | null | undefined): 'up' | 'down' | undefined => n == null || n === 0 ? undefined : n < 0 ? 'down' : 'up'
  const dates = [...new Set(data?.accounts.map(a => a.as_of).filter(Boolean))]
  const source = data?.accounts.length === 1 ? data.accounts[0].label : data?.accounts.length ? `${data.accounts.length}개 계좌` : '일반계좌'
  const basis = dates.length === 1 ? `${dates[0]?.replaceAll('-', '.')} 잔고` : dates.length > 1 ? '계좌별 기준일 다름' : '기준일 미확인'
  const metrics: HeroMetric[] = t && t.count > 0 ? [
    { label: '주식 평가액', value: show(t.value), primary: true, detail: `${t.count}개 보유 내역 · 예수금 제외` },
    { label: '평가손익 · 매입 대비', value: `${!hidden && t.total_return != null && t.total_return > 0 ? '+' : ''}${show(t.total_return)}`, tone: tone(t.total_return), detail: hidden ? '•••' : percent(t.total_rate) },
    { label: '전일 종가 대비', value: hidden ? '•••' : percent(data?.diagnostics?.daily_rate), tone: tone(data?.diagnostics?.daily_rate), detail: data?.diagnostics?.daily_rate == null ? '전체 종목 시세 확인 후 표시' : '현재 보유수량 기준' },
  ] : []
  return <PageHero title="주식" label="내 주식 요약" context={market ? '시장·매크로' : `${source} · ${basis}${data?.live ? ' · 시세 반영' : ''}`} actions={actions} metrics={market ? undefined : metrics} footer={footer}
    note={!market && t && t.cost_known < t.count ? `평가손익은 매입금액이 확인된 ${t.cost_known}/${t.count}개 보유 내역 기준입니다.` : undefined}>{market && <MacroStrip/>}</PageHero>
}

export function StockDiagnosis({ data, hidden = false }: { data: HoldingsData | null; hidden?: boolean }) {
  const d = data?.diagnostics
  const weight = (n: number | null | undefined) => hidden ? '•••' : n == null ? '—' : `${n.toFixed(1)}%`
  return <section className="sq-section sq-allocation"><div><h2>보유 비중</h2><p>같은 종목은 계좌 간 합산 · 등록 주식 평가액 기준</p>
    <dl className="sq-concentration"><div><dt>상위 1종목</dt><dd>{weight(d?.top_one_weight)}</dd></div><div><dt>상위 3종목</dt><dd>{weight(d?.top_three_weight)}</dd></div></dl>
    </div><div className="sq-position-bars">{d?.positions.length ? d.positions.slice(0, 5).map((p, i) => <div className="sq-position" key={`${p.name}:${i}`}><div><span>{p.name}</span><b>{weight(p.weight)}</b></div><div className="sq-track"><i style={{ width: hidden ? '0%' : `${p.weight}%` }}/></div></div>) : <p>종목 잔고가 등록되면 보유 비중을 표시합니다.</p>}</div>
  </section>
}

export function StockBoard({ owner, hidden, onRegister, onChanged, scopeControl }: { scopeControl?: ReactNode; owner: Owner; hidden: boolean; onRegister: () => void; onChanged: () => void }) {
  const [data, setData] = useState<HoldingsData | null>(null)
  const [tab, setTab] = useState('holdings')
  const [index, setIndex] = useState('SPX500')
  const [threshold, setThreshold] = useState('')
  const [showAnalysis, setShowAnalysis] = useState(false)
  const d = data?.diagnostics
  const valid = threshold.trim() !== '' && Number.isFinite(Number(threshold)) && Number(threshold) > 0 && Number(threshold) <= 100
  const triggered = valid && d?.daily_rate != null && d.daily_rate <= -Number(threshold)
  const navigation = <TabsList variant="line" aria-label="주식 화면"><TabsTrigger value="holdings">내 주식</TabsTrigger><TabsTrigger value="market">시장·매크로</TabsTrigger></TabsList>
  const actions = <>{scopeControl}{!!data?.holdings.length && <Button variant="outline" size="sm" onClick={onRegister}>잔고 등록</Button>}</>
  return <div className="sq-board">
    <Tabs value={tab} onValueChange={setTab} className="sq-tabs">
      <StockOverview data={data} hidden={hidden} actions={tab === 'holdings' ? actions : scopeControl} footer={navigation} market={tab === 'market'}/>
      <TabsContent value="holdings" forceMount className="sq-tab-content">
        <HoldingsPanel owner={owner} hidden={hidden} stockOnly compactSummary onRegister={onRegister} onChanged={onChanged} onData={setData}/>
        {!!data?.holdings.length && <StockDiagnosis data={data} hidden={hidden}/>}
        <details className="sq-extra"><summary>추가 점검 · 하락 기준과 분석 준비 상태</summary>
    <section className="sq-section"><div className="sq-heading"><div><h2>하락 원인 점검</h2><p>수치로 영향을 확인하고, 뉴스·공시로 원인을 구분해요.</p></div><Button variant="outline" aria-expanded={showAnalysis} onClick={() => setShowAnalysis(v => !v)}>{showAnalysis ? '근거 접기' : '근거 확인'}</Button></div>
      <label className="sq-threshold">전일 종가 대비 <Input aria-label="하락 점검 기준" type="number" min="0.1" max="100" step="0.1" placeholder="직접 설정" value={threshold} onChange={e => setThreshold(e.target.value)}/> % 이상 하락 시 점검 <small>이 화면에서만 적용</small></label>
      <p className="sq-condition" role="status">{!data?.holdings.length ? '잔고를 등록하면 하락 조건을 점검할 수 있어요.' : !valid ? '0보다 크고 100 이하인 하락 기준을 입력하세요.' : d?.daily_rate == null ? `전체 종목의 전일 비교 시세가 필요합니다${d ? ` · ${d.quote_covered}/${d.quote_total}종목 확인` : ''}. 보유 주식의 ‘현재가로 보기’에서 확인하세요.` : triggered ? '설정한 하락 기준에 도달했습니다. 아래 종목별 영향을 확인하세요.' : '설정한 하락 기준에 도달하지 않았습니다.'}</p>
      {(showAnalysis || triggered) && <div className="sq-evidence"><div><h3>계좌에 미친 영향</h3>{d?.daily_drivers.length ? d.daily_drivers.map(r => <div className="sq-driver" key={`${r.account_id}:${r.name}`}><span>{r.name}</span><b className={r.contribution_pp < 0 ? 'sq-down' : ''}>{hidden ? '•••' : `${r.contribution_pp > 0 ? '+' : ''}${r.contribution_pp.toFixed(2)}%p`}</b></div>) : <p>일부 종목의 시세만으로 전체 계좌의 하락 기여도를 추정하지 않습니다.</p>}<small>현재 보유수량 기준 가격 변화 · 입출금/일중 거래 영향 제외</small></div><div><h3>시장·업종·기업 원인</h3><p>뉴스·공시 원문과 발표 시각을 연결하기 전이라 원인을 확정할 수 없습니다.</p><small>AI 원인 분석 미연결 · 실제 기사를 확인하지 않은 해석은 표시하지 않습니다.</small></div></div>}
    </section>
        <p className="sq-history-note">지수 대비 성과·고점 대비 낙폭은 가격·입출금 이력이 연결된 뒤 표시합니다. 퀀트 전략 설정은 아직 제공하지 않습니다.</p>
        </details>
      </TabsContent>
      <TabsContent value="market" className="sq-tab-content">
    <section className="sq-section"><div className="sq-heading"><div><h2>시장 히트맵</h2><p>면적은 시가총액 · 색은 당일 등락 · 빨강 하락 / 초록 상승 (외부 위젯)</p></div><div className="sq-index" role="group" aria-label="시장 선택"><Button variant={index === 'SPX500' ? 'default' : 'outline'} aria-pressed={index === 'SPX500'} onClick={() => setIndex('SPX500')}>S&P 500</Button><Button variant={index === 'NASDAQ100' ? 'default' : 'outline'} aria-pressed={index === 'NASDAQ100'} onClick={() => setIndex('NASDAQ100')}>나스닥 100</Button></div></div><MarketWidget index={index}/><small>보유 종목 강조는 아직 지원하지 않습니다. 내 종목 비중은 ‘내 주식’ 탭에서 확인하세요.</small></section>
      </TabsContent>
    </Tabs>
  </div>
}
