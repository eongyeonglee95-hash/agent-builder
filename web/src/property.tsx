import { useState } from 'react'
import { ArrowRight, Check, CirclePlus, ChevronRight, Compass, Heart, House, MapPin, MoveRight, SlidersHorizontal, Sprout, Target } from 'lucide-react'
import { PanelHeading } from './components'
import { money } from './model'

// Fictional places and assumptions for template review; never saved to the ledger.
const homes = [
  { id: 'riverside', name: '강변의 여유를 담은 집', area: '강변 생활권', size: '84㎡', price: 950_000_000, color: 'river', tag: '산책이 일상이 되는', floors: [8, 12, 9] },
  { id: 'city', name: '일상에 가까운 도심의 집', area: '도심 생활권', size: '84㎡', price: 1_050_000_000, color: 'city', tag: '편리함을 가까이에', floors: [12, 9, 14] },
  { id: 'forest', name: '초록을 마주하는 집', area: '공원 생활권', size: '74㎡', price: 870_000_000, color: 'forest', tag: '조금 더 느긋한 매일', floors: [7, 10, 6] },
]

function Neighborhood({ theme = 'river', floors = [8, 12, 9] }: { theme?: string; floors?: number[] }) {
  return <div className={`neighborhood ${theme}`} aria-hidden="true"><span className="neighborhood-sun"/><span className="neighborhood-cloud cloud-one"/><span className="neighborhood-cloud cloud-two"/><div className="building-row">{floors.map((floor, i) => <div className={`building building-${i}`} key={i} style={{ height: `${floor * 7 + 18}px` }}>{Array.from({ length: floor > 10 ? 18 : 12 }, (_, k) => <i key={k}/>)}</div>)}</div><span className="neighborhood-tree tree-one"/><span className="neighborhood-tree tree-two"/><span className="neighborhood-ground"/></div>
}

export function PropertyPlan({ value, registered, isDemo, onPreview, onDemo, onRegister }: {
  value: string; registered: boolean; isDemo: boolean; onPreview: () => void; onDemo: () => void; onRegister: () => void
}) {
  const [selected, setSelected] = useState(homes[0].id)
  const [saved, setSaved] = useState<string[]>([homes[0].id, homes[2].id])
  const [years, setYears] = useState(4)
  const [monthly, setMonthly] = useState(3_000_000)
  const target = homes.find(home => home.id === selected)!
  const needed = target.price + 35_000_000 - (600_000_000 - 100_000_000) - 200_000_000
  const projected = monthly * years * 12
  const gap = Math.max(0, needed - projected)
  if (!isDemo) return <section className="panel actual-workspace property-actual"><div><span className="editorial-kicker">OUR HOME TODAY</span><h2>우리 집, 그다음 이야기</h2><strong>{registered ? value : '보유 부동산 미등록'}</strong><p>등록한 부동산 지분의 합계예요. 아래 내역에서 금액과 기준일을 갱신할 수 있어요.</p></div><div className="actual-workspace-actions"><button className="primary-button" onClick={onRegister}><CirclePlus size={14}/>자산 등록</button><button className="secondary-button" onClick={onPreview}>집·대출 요약 보기 <ArrowRight size={14}/></button><button className="text-link" onClick={onDemo}>관심 집·갈아타기 예시 <ArrowRight size={13}/></button></div></section>
  return <div className="property-workspace">
    <section className="property-editorial"><div><span className="editorial-kicker"><Compass size={13}/>A PLACE FOR OUR NEXT CHAPTER</span><h2>다음 집을 꿈꾸는 일도,<br/><em>우리의 계획이 됩니다.</em></h2><p>살고 싶은 동네와, 함께 보내고 싶은 시간.<br/>지금의 집에서 다음 삶으로 이어지는 지도를 그려요.</p><button className="primary-button" onClick={onRegister}><CirclePlus size={14}/>자산 등록</button><div className="property-hero-status"><span/><span>{isDemo ? '가상 생활권 · 예시 가격으로 살펴보는 갈아타기' : '우리 집 자산 관리 · 갈아타기 기능은 고도화 예정'}</span></div></div><Neighborhood theme="hero" floors={[10, 14, 11]}/></section>
    <section className="property-next-chapter"><div className="chapter-number">01<span>지금, 그리고 다음</span></div><PanelHeading title="우리 집, 그다음 이야기" detail="얼마짜리 집보다, 어떤 일상을 원하는지부터."/><div className="home-journey-cards">
      <div className="home-current"><span className="home-card-icon"><House size={21}/></span><span className="editorial-kicker">OUR HOME TODAY</span><h3>지금의 우리 집</h3><strong>{registered ? value : '첫 집 정보를 알려주세요'}</strong><p>{isDemo ? '예시 부동산의 보유 지분 합계' : '직접 등록한 부동산의 보유 지분 합계'}</p><div className="home-card-bottom"><span>집은 자산이자, 우리의 일상.</span><Sprout size={20}/></div></div>
      <span className="journey-link"><MoveRight size={23}/></span>
      <div className="home-next"><span className="home-card-icon"><Target size={21}/></span><span className="editorial-kicker">OUR NEXT HOME</span><h3>{isDemo ? target.name : '어떤 집을 꿈꾸고 있나요?'}</h3>{isDemo ? <><strong>{money(target.price)}<small>가상 목표 가격</small></strong><p><MapPin size={12}/>{target.area} · {target.size} · 가상 주거지</p></> : <p>원하는 동네와 평형, 이사하고 싶은 시점.<br/>우리의 다음 목표가 들어갈 자리예요.</p>}<button className="home-card-bottom" onClick={isDemo ? onPreview : onDemo}><span>{isDemo ? '갈아타기 계획 안내' : '목표 집 화면 예시 보기'}</span><ArrowRight size={16}/></button></div>
    </div></section>
    <section className="home-discovery"><div className="chapter-number">02<span>마음이 향하는 곳</span></div><PanelHeading title="우리의 다음 주소 후보" detail="좋아하는 일상의 기준으로, 나란히 놓고 비교해요."><span className="outline-tag">{isDemo ? '가상 주거지 3곳' : '관심 단지 연결 전'}</span></PanelHeading>
      {isDemo ? <><div className="dream-home-grid">{homes.map(home => <article className={`dream-home ${selected === home.id ? 'selected' : ''}`} key={home.id}><div className="dream-home-image"><Neighborhood theme={home.color} floors={home.floors}/><span className="home-image-label">가상 주거지 · 디자인 예시</span><button className={`save-home ${saved.includes(home.id) ? 'saved' : ''}`} aria-label={`${home.name} 관심 ${saved.includes(home.id) ? '해제' : '등록'}`} aria-pressed={saved.includes(home.id)} onClick={() => setSaved(old => old.includes(home.id) ? old.filter(id => id !== home.id) : [...old, home.id])}><Heart size={16} fill={saved.includes(home.id) ? 'currentColor' : 'none'}/></button></div><div className="dream-home-content"><span className="home-lifestyle">{home.tag}</span><h3>{home.name}</h3><p><MapPin size={12}/>{home.area} · {home.size}</p><div className="dream-home-price"><strong>{money(home.price)}</strong><span>예시 가격</span></div><button className={selected === home.id ? 'home-chosen' : 'home-choose'} aria-pressed={selected === home.id} onClick={() => setSelected(home.id)}>{selected === home.id ? <><Check size={14}/>비교 중인 목표 집</> : <>이 집으로 비교하기<ChevronRight size={14}/></>}</button></div></article>)}</div><p className="card-footnote">위 주거지는 모두 가상이며 실제 단지·매물·실거래가가 아닙니다. 관심 선택은 현재 화면에서만 유지됩니다.</p></> : <div className="home-discovery-empty"><Neighborhood theme="forest"/><div><span className="editorial-kicker">A LITTLE ROOM TO DREAM</span><h3>언젠가 살고 싶은 집,<br/>함께 모아둘 수 있도록.</h3><p>관심 단지와 실거래가를 연결할 자리입니다.<br/>먼저 예시로 다음 집을 비교하는 화면을 살펴보세요.</p><button className="secondary-button" onClick={onDemo}>관심 집 예시 살펴보기 <ArrowRight size={14}/></button></div></div>}
    </section>
    <section className="move-plan"><div className="move-plan-intro"><div className="chapter-number">03<span>꿈을 숫자로 바꾸는 시간</span></div><h3>그 집까지,<br/>얼마나 더 준비하면 될까요?</h3><p>집을 바꾸는 선택이 노후를 흔들지 않도록.<br/>우리의 자금과 시간을 함께 놓고 봐요.</p><span className="plan-mode"><SlidersHorizontal size={14}/>{isDemo ? '가정을 바꿔보는 화면 예시' : '실제 자금 계산 연결 전'}</span></div>
      {isDemo ? <div className="move-plan-calculator"><div className="funding-lines"><div><span>목표 집 · 예시 가격</span><b>{money(target.price)}</b></div><div><span>거래·이사 비용 가정</span><b>3,500만원</b></div><div><span>지금 집 매도 후 자금 가정</span><b>− 5억원</b></div><div><span>이사에 쓸 현금 가정</span><b>− 2억원</b></div><div className="funding-total"><span>추가로 준비할 자금</span><strong>{money(needed)}</strong></div></div><label className="plan-slider">이사까지 남은 시간<strong>{years}년</strong><input type="range" min="1" max="10" step="1" value={years} onChange={e => setYears(Number(e.target.value))}/></label><label className="plan-slider">매달 준비할 금액<strong>{money(monthly)}</strong><input type="range" min="500000" max="10000000" step="500000" value={monthly} onChange={e => setMonthly(Number(e.target.value))}/></label><div className="move-plan-result" role="status"><span>{years}년 동안 {money(projected)}을 모으면</span><strong>{gap ? `${money(gap)} 더 준비해야 해요` : '예시 목표 자금에 도달해요'}</strong><div><i style={{ width: `${Math.min(100, projected / needed * 100)}%` }}/></div></div><p className="card-footnote">현재 집 매도 6억−주택 대출 1억 가정. 실제 장부와 별개인 화면 예시이며 수익률·물가·개별 세금은 반영하지 않습니다.</p></div> : <div className="move-plan-placeholder"><Target size={30}/><h4>우리의 속도에 맞춘 갈아타기.</h4><p>목표 집과 매도 자금, 연결된 대출과 이사 비용을<br/>정확히 입력한 뒤 계획을 계산할 예정이에요.</p><button onClick={onDemo}>가정 슬라이더 체험하기 <ArrowRight size={15}/></button></div>}
    </section>
    <div className="property-source-note"><span><MapPin size={17}/>동네의 변화도, 놓치지 않도록.</span><p>실거래가 · 전세가 · 분양 · 교통 · 정비사업 뉴스는 출처와 기준일을 확인할 수 있도록 연결할 예정입니다.</p></div>
  </div>
}
