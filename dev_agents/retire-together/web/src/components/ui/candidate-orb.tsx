import { Check, Plus } from 'lucide-react'
import './candidate-orb.css'

/** A candidate selector. Selection opens evidence; saving remains an explicit action. */
export function CandidateOrb({ name, area, price, detail, facts, saved = false, spotlight = false, selected = false, onSelect }: {
  name: string; area: string; price: string; detail?: string; facts?: string; saved?: boolean; spotlight?: boolean; selected?: boolean; onSelect: () => void
}) {
  return <button type="button" className="candidate-orb" aria-label={`${name} 분석 보기`} aria-pressed={selected} onClick={onSelect}>
    {spotlight&&<span className="candidate-orb-spotlight">주목</span>}
    <span className="candidate-orb-status" aria-label={saved ? '관심 단지에 저장됨' : '새 후보'}>{saved ? <Check size={16}/> : <Plus size={16}/>}</span>
    <strong title={name}>{name}</strong><small>{area}</small><span className="candidate-orb-price">{price}</span>{facts&&<span className="candidate-facts">{facts}</span>}{detail&&<small className="candidate-price-detail">{detail}</small>}
  </button>
}
