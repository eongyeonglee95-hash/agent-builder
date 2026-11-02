import { useState } from 'react'
import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronRight, CirclePlus, Clock3, Info, Newspaper, Sparkles, TrendingUp } from 'lucide-react'
import { Modal, PanelHeading } from './components'
import { money, type Asset } from './model'

// Fictional positions reconcile to the existing synthetic ledger in example mode.
const examples: Record<string, { name: string; code: string; initials: string; average: number; price: number; quantity: number; day: number; color: string }> = {
  'm-stock': { name: '글로벌 주식 ETF', code: '가상 ETF · 노후', initials: 'G', average: 95_000, price: 102_000, quantity: 1000, day: 1.2, color: 'blue' },
  'p-stock': { name: '성장 주식 ETF', code: '가상 ETF · 노후', initials: 'E', average: 68_000, price: 64_000, quantity: 1000, day: -.8, color: 'violet' },
  'm-cash-stock': { name: '샘플테크', code: '가상 종목 · 일반', initials: 'S', average: 80_000, price: 85_000, quantity: 1000, day: 2.1, color: 'mint' },
  'p-cash-stock': { name: '샘플모빌리티', code: '가상 종목 · 일반', initials: 'M', average: 75_000, price: 72_000, quantity: 1000, day: -.4, color: 'sand' },
}
const stories = [
  { id: 1, type: 'positive', tag: '긍정 요인', company: '샘플테크', title: '매출 증가 발표, 숫자 뒤의 수익성도 함께 확인해요', text: '성장 소식은 긍정적이지만, 영업이익과 일회성 매출 여부를 같이 살펴보는 장면입니다.', time: '어제 18:20', detail: '매출 증가가 반복되는지, 원가 상승이 이익을 줄이지 않았는지 확인하는 흐름을 보여줍니다.' },
  { id: 2, type: 'negative', tag: '주의 요인', company: '샘플모빌리티', title: '원재료 비용 상승, 이익률에 미치는 영향은?', text: '비용 증가라는 부담과 판매가격 조정 가능성을 나란히 비교하는 장면입니다.', time: '어제 16:40', detail: '단기 비용 부담과 장기 계약 조건을 함께 검토합니다. 제목 하나만으로 주가 방향을 결정하지 않습니다.' },
  { id: 3, type: 'neutral', tag: '지켜볼 소식', company: '시장 공통', title: '금리 발표를 앞둔 한 주, 변동성보다 우리의 비중부터', text: '같은 뉴스가 주식·채권·환율에 서로 다르게 작용할 수 있음을 설명하는 장면입니다.', time: '어제 09:10', detail: '시장 전체의 소식이 보유 종목에 어떤 경로로 연결되는지 구분합니다. 기존 투자 전략을 자동으로 변경하지 않습니다.' },
] as const
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

function Sparkline({ negative = false, period }: { negative?: boolean; period: string }) {
  const points = period === '1W' ? [25, 20, 23, 13, 16, 8] : period === '3M' ? [32, 26, 30, 18, 23, 12, 18, 9, 13, 3] : [30, 27, 31, 20, 23, 13, 17, 8, 12, 3]
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${i * 108 / (points.length - 1)} ${negative ? 36 - p : p}`).join(' ')
  return <svg viewBox="0 0 110 38" className={`position-spark ${negative ? 'negative' : ''}`} aria-label={`${period} 가격 흐름 예시`}><path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

export function StockWorkspace({ assets, isDemo, hidden, onDemo, onRegister, onSelect }: {
  assets: Asset[]; isDemo: boolean; hidden: boolean; onDemo: () => void; onRegister: () => void; onSelect: (asset: Asset) => void
}) {
  const [filter, setFilter] = useState('all')
  const [activeStory, setActiveStory] = useState<(typeof stories)[number] | null>(null)
  const [period, setPeriod] = useState('1M')
  const [activePosition, setActivePosition] = useState<((typeof examples)[string] & { asset: Asset }) | null>(null)
  const positions = isDemo ? assets.filter(a => examples[a.id]).map(a => ({ ...examples[a.id], asset: a })) : []
  const total = assets.reduce((n, a) => n + a.amount, 0)
  const cost = positions.reduce((n, p) => n + p.average * p.quantity, 0)
  const profit = positions.reduce((n, p) => n + (p.price - p.average) * p.quantity, 0)
  const show = (value: number) => hidden ? '••••••' : money(value)
  const news = stories.filter(story => filter === 'all' || story.type === filter)
  if (!isDemo) return <section className="panel actual-workspace"><div><span className="editorial-kicker">OUR INVESTMENT JOURNAL</span><h2>등록한 주식형 자산</h2><strong>{show(total)}</strong><p>직접 입력한 총액까지 합친 주식형 자산이에요. 사진·파일로 등록한 종목의 손익과 현재가는 위 ‘보유 주식’에서 볼 수 있어요.</p></div><div className="actual-workspace-actions"><button className="primary-button" onClick={onRegister}>자산 등록 <CirclePlus size={14}/></button><button className="text-link" onClick={onDemo}>종목·뉴스 화면 예시 <ArrowRight size={13}/></button></div></section>
  return <div className="stock-workspace">
    <section className="portfolio-hero">
      <div className="portfolio-copy"><span className="editorial-kicker"><span/>OUR INVESTMENT JOURNAL</span><h2>숫자로 살펴보고,<br/><em>근거로 판단해요.</em></h2><p>얼마에 샀는지부터, 어제 무슨 일이 있었는지까지.<br/>우리의 투자에 필요한 이야기를 한곳에.</p><button onClick={onRegister}><CirclePlus size={15}/>자산 등록 <ArrowRight size={15}/></button></div>
      <div className="portfolio-value"><span>{isDemo ? '가상 포트폴리오 평가액' : '등록한 주식형 자산'}</span><strong>{show(total)}</strong>{isDemo && cost > 0 ? <p className={profit >= 0 ? 'positive' : 'negative'}>{profit >= 0 ? <ArrowUpRight size={17}/> : <ArrowDownRight size={17}/>} {hidden ? '••••' : `${profit >= 0 ? '+' : '−'}${money(Math.abs(profit))} (${(profit / cost * 100).toFixed(2)}%)`}<small>매입 대비 · 예시</small></p> : <p className="portfolio-pending">평단가·현재가 연결 후 손익 표시</p>}<div className="portfolio-mini-bars" aria-hidden="true">{[24, 32, 29, 41, 35, 49, 44, 56, 50, 66, 58, 73, 65, 82, 77, 96].map((h, i) => <i key={i} style={{ height: `${h}%` }}/>)}</div><span className="hero-data-note">{isDemo ? '가상 종목과 고정 가격으로 만든 화면 예시' : '직접 입력한 금액 · 현재가 자동 조회 전'}</span></div>
    </section>
    <div className="stock-main-grid">
      <section className="panel position-panel"><PanelHeading title="나의 투자 노트" detail="평단가와 현재가, 두 숫자 사이의 변화."><span className="outline-tag">{isDemo ? '종목 상세 예시' : '시세 연결 전'}</span></PanelHeading>
        {isDemo ? <><div className="position-period" role="group" aria-label="가격 흐름 예시 기간"><span>가상 종목 · 가격 흐름 예시</span>{['1W', '1M', '3M'].map(p => <button key={p} aria-pressed={p === period} className={p === period ? 'active' : ''} onClick={() => setPeriod(p)}>{p}</button>)}</div><div className="position-list">{positions.map(p => <button className="position-card" key={p.asset.id} onClick={() => setActivePosition(p)}><span className={`company-mark ${p.color}`}>{p.initials}</span><span className="position-identity"><strong>{p.name}</strong><small>{p.code}</small></span><span className="position-price"><strong>{hidden ? '••••' : won(p.price)}</strong><small className={p.day >= 0 ? 'positive' : 'negative'}>{p.day > 0 ? '+' : ''}{p.day}% · 예시</small></span><Sparkline negative={p.day < 0} period={period}/><span className="position-cost"><small>평단가 {hidden ? '••••' : won(p.average)}</small><span>{p.quantity.toLocaleString()}주 · <b className={p.price >= p.average ? 'positive' : 'negative'}>{hidden ? '•••' : `${((p.price / p.average - 1) * 100).toFixed(1)}%`}</b></span></span><ChevronRight size={14}/></button>)}</div><p className="card-footnote">수량 × 현재가 = 평가금액. 손익은 매입단가 기준이며 수수료·세금은 제외한 예시입니다.</p></> : <div className="workspace-empty"><div className="empty-orbit"><TrendingUp size={28}/></div><h3>종목 하나부터, 차근차근.</h3><p>종목·수량·평단가를 등록하고 현재가를 연결하면<br/>우리의 투자 현황을 이곳에서 확인할 수 있어요.</p><button className="secondary-button" onClick={onDemo}>종목 화면 예시 보기 <ArrowRight size={14}/></button><small>현재 등록은 자산 총액 기준입니다.</small></div>}
      </section>
      <aside className="investment-side"><section className="panel briefing-note"><span className="briefing-symbol"><Sparkles size={22}/></span><span className="editorial-kicker">A MOMENT TO REFLECT</span><h3>뉴스를 읽기 전,<br/>우리의 기준부터.</h3><p>오늘의 소식이 달라져도<br/>처음 정한 투자 목적은 기억해요.</p><div className="journal-rule"><Check size={14}/><span>사실과 해석을 구분하기</span></div><div className="journal-rule"><Check size={14}/><span>긍정·부정 요인을 함께 보기</span></div><div className="journal-rule"><Check size={14}/><span>가격보다 보유 목적 점검하기</span></div></section><section className="journal-source"><Clock3 size={16}/><div><strong>언제 나온 정보인지, 함께.</strong><p>시세 기준 시각 · 뉴스 발표 시각 · 원문 출처를<br/>데이터 연결 시 함께 표시할 예정이에요.</p></div></section></aside>
    </div>
    <section className="panel news-workspace"><PanelHeading title="어제부터, 우리 종목에 무슨 일이?" detail="소식의 크기보다, 나의 투자와의 연결을 살펴봐요."><span className="news-badge"><Newspaper size={13}/>{isDemo ? '가상 뉴스 시나리오' : '뉴스 연결 전'}</span></PanelHeading>
      {isDemo ? <><div className="news-filter" role="group" aria-label="뉴스 요인 필터">{[['all', '전체 소식'], ['positive', '긍정 요인'], ['negative', '주의 요인'], ['neutral', '지켜볼 소식']].map(([key, label]) => <button key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}<span>실제 기사가 아닌 디자인 예시</span></div><div className="news-card-grid">{news.map(story => <button className={`journal-news ${story.type}`} key={story.id} onClick={() => setActiveStory(story)}><span className="news-tag">{story.tag}</span><span className="news-company">{story.company}</span><h3>{story.title}</h3><p>{story.text}</p><span className="news-card-footer"><span>{story.time} · 예시</span><span>영향 살펴보기 <ArrowRight size={13}/></span></span></button>)}</div></> : <div className="news-empty"><Newspaper size={27}/><div><h3>보유 종목의 소식을 모아둘게요.</h3><p>실제 기사 수집·분석은 연결 전입니다. 예시 화면에서 뉴스 요약과 영향 설명의 구성을 살펴보세요.</p></div><button className="secondary-button" onClick={onDemo}>브리핑 예시 보기 <ArrowRight size={14}/></button></div>}
    </section>
    {activePosition && <Modal title={`${activePosition.name} · 종목 예시`} onClose={() => setActivePosition(null)}><span className="outline-tag">가상 종목 · 고정 가격</span><div className="detail-list"><div><span>보유 수량</span><strong>{activePosition.quantity.toLocaleString()}주</strong></div><div><span>평균 매입단가</span><strong>{hidden ? '••••' : won(activePosition.average)}</strong></div><div><span>현재가 예시</span><strong>{hidden ? '••••' : won(activePosition.price)}</strong></div><div><span>평가금액</span><strong>{show(activePosition.price * activePosition.quantity)}</strong></div><div><span>평가손익</span><strong>{show((activePosition.price - activePosition.average) * activePosition.quantity)}</strong></div></div><p className="form-help">종목별 화면을 살펴보기 위한 가상 보유 내역입니다. 실제 시세나 보유 종목이 아니며 수수료·세금을 제외한 예시입니다.</p><button className="secondary-button full-width" onClick={() => { const asset = activePosition.asset; setActivePosition(null); onSelect(asset) }}>연결된 예시 자산 보기 <ArrowRight size={14}/></button></Modal>}
    {activeStory && <Modal title="뉴스 영향 살펴보기 · 예시" onClose={() => setActiveStory(null)}><span className="outline-tag">가상 종목 · 가상 시나리오</span><p className="modal-lead">{activeStory.title}</p><p>{activeStory.detail}</p><div className="info-note"><Info size={18}/><p>실제 기사나 전망이 아닙니다. 뉴스 원문·발표 시각·판단 근거를 연결할 화면의 디자인 예시입니다.</p></div></Modal>}
  </div>
}
