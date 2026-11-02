import { useState } from 'react'
import { ArrowDownRight, ArrowRight, BookOpen, Check, PencilLine, Plus } from 'lucide-react'
import { money } from '../model'
import { orderedTrack, TrackChart, trackBasis, trackSigned } from './TrackChart'
import type { Budget, Candidate, MoveState, TrackEntry } from './types'
import './analysis-hero.css'

type Props = { data: MoveState; hidden: boolean; onEdit: (candidate: Candidate) => void; onAdd: () => void; onDetails: (id: string) => void }
const kinds: TrackEntry['price_basis'][] = ['asking', 'trade', 'manual']

export function AnalysisHero({ data, hidden, onEdit, onAdd, onDetails }: Props) {
  const [candidateId, setCandidateId] = useState<string | null>(null)
  const candidate = data.plan.candidates.find(c => c.id === candidateId) ?? data.plan.candidates[0]
  return <section className="property-analysis-hero" aria-label="관심 부동산 분석">
    <header className="property-hero-heading"><div><span className="property-hero-eyebrow"><BookOpen size={14}/>우리의 다음 집 · 분석 노트</span><h2>관심 있는 집, 기록에서 판단의 근거까지.</h2><p>가격의 변화와 우리 집과의 거리를 함께 살펴봐요.</p></div>
      <button className="property-move-button primary" onClick={() => candidate ? onEdit(candidate) : onAdd()}><PencilLine size={14}/>입력·수정하기</button>
    </header>
    {candidate ? <div className="property-hero-layout"><aside className="property-hero-candidates" aria-label="분석할 관심 단지">
      <div className="property-hero-list-heading"><span>트래킹하는 단지</span><b>{data.plan.candidates.length}</b></div>
      <div className="property-hero-candidate-list">{data.plan.candidates.map(c => {
        const entries = orderedTrack(data.track[c.id] ?? []), latest = entries.at(-1)
        return <button type="button" key={c.id} className="property-hero-candidate" aria-pressed={candidate.id === c.id} onClick={() => setCandidateId(c.id)}>
          <span className="property-hero-candidate-name"><b>{c.name}</b>{candidate.id === c.id && <Check size={14} aria-hidden="true"/>}</span>
          <small>{c.area_m2 ? `전용 ${c.area_m2}㎡` : '전용면적 미입력'} · 기록 {entries.length}건</small>
          <span className="property-hero-candidate-value"><span>{latest ? `${trackBasis[latest.price_basis]} 격차` : '계획 매수가'}</span><strong>{hidden ? '••••' : latest ? trackSigned(latest.gap) : c.price == null ? '미입력' : money(c.price)}</strong></span>
        </button>
      })}</div>
      <button type="button" className="property-hero-add" disabled={data.plan.candidates.length >= 20} onClick={onAdd}><Plus size={14}/>관심 단지 추가</button>
    </aside><CandidateAnalysis key={candidate.id} candidate={candidate} entries={data.track[candidate.id] ?? []} budget={data.comparisons.find(b => b.id === candidate.id)} hidden={hidden} onDetails={() => onDetails(candidate.id)}/></div>
      : <div className="property-hero-start"><BookOpen size={28}/><div><h3>마음에 둔 단지를 등록해 주세요.</h3><p>확인한 가격을 한 번씩 남기면, 격차의 변화와 그 이유를 여기서 볼 수 있어요.</p><button className="property-move-button" onClick={onAdd}><Plus size={14}/>관심 단지 추가</button></div></div>}
  </section>
}

function CandidateAnalysis({ candidate: c, entries, budget, hidden, onDetails }: { candidate: Candidate; entries: TrackEntry[]; budget?: Budget; hidden: boolean; onDetails: () => void }) {
  const [chosenBasis, setChosenBasis] = useState<TrackEntry['price_basis'] | null>(null)
  const history = orderedTrack(entries)
  const basis = chosenBasis ?? history.at(-1)?.price_basis ?? (c.asking_low != null ? 'asking' : c.price_basis)
  const same = history.filter(e => e.price_basis === basis)
  const missingLiving = !Object.values(c.living ?? {}).some(v => typeof v === 'string' && v.trim())
  const show = (n: number | null | undefined) => hidden ? '••••' : n == null ? '계산 대기' : money(n)
  return <div className="property-hero-analysis">
    <div className="property-hero-analysis-heading"><div><h3>{c.name}</h3><p>우리 집과의 가격 격차 <span>· 후보 가격 − 당시 우리 집 평가액</span></p></div>
      <label className="property-hero-basis"><span>기록 가격 기준</span><select value={basis} onChange={e => setChosenBasis(e.target.value as TrackEntry['price_basis'])}>{kinds.map(k => <option value={k} key={k}>{trackBasis[k]} · {history.filter(e => e.price_basis === k).length}건</option>)}</select></label>
    </div>
    {!same.length && <div className="property-hero-reading"><span>기록에서 읽는 변화</span><p>아직 비교할 기록이 없어요. 현재 가격을 기록하는 것부터 시작해요.</p></div>}
    <TrackChart key={basis} entries={entries} basis={basis} name={c.name} hidden={hidden} onRecord={onDetails}/>
    <div className="property-hero-next"><div><ArrowDownRight size={17}/><p><b>다음에 확인할 것</b><span>{basis === 'asking' ? '호가 매물과 실거래의 동·층·향이 비슷한지 확인해요.' : basis === 'trade' ? '거래의 계약일·층·면적을 확인하고 현재 매물 호가와 비교해요.' : '계획 매수가를 뒷받침할 실거래와 매물 호가를 확인해요.'}{missingLiving ? ' 거주 조건도 아직 기록 전이에요.' : ''}</span></p></div><button className="property-move-link" onClick={onDetails}>근거·기록 자세히 <ArrowRight size={14}/></button></div>
    <div className="property-hero-budget"><span>현재 자금 계획 기준</span><span>지금 더 필요 <b>{show(budget?.gap)}</b></span><span>목표 시점에도 <b>{show(budget?.months == null ? null : budget.future_gap)}</b></span>{budget && !budget.costs_complete && <small>비용 미입력분 제외</small>}</div>
  </div>
}
