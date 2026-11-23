import { NativeSelect } from '../components/ui/native-select'
import { Input } from '../components/ui/input'
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { api } from '../local-data'
import { Button } from '../components/ui/button'
import { decimal, pct, pp } from '../lib/format'
import './sentiment.css'

const topics = [['sentiment','매수·매도 심리','KB 매수우위 · 부동산원 매매수급'],['mortgage','주담대 금리','고정·변동 · COFIX'],['credit','신용대출 금리','일반 신용 · 마이너스통장'],['jeonse','전세대출 금리','보증기관 · 상품 조건'],['drivers','심리를 움직이는 변화','거래·매물·전세 · 규제·공급']] as const
const modes = { daily: '일간', weekly: '주간', monthly: '월간' }
type Mode = keyof typeof modes
type Brief = { text: string; sources: { url: string; title: string }[]; as_of: string }
type Cell = { day: string; value: number | null; delta: number | null; observed: string | null }
type Metric = { id: string; name: string; provider: string; unit: string; frequency: Mode; source_url: string; status: string; latest: { value: number; day: string; collected: string } | null; cells: Cell[] }
type History = { start: string; end: string; periods: string[]; items: Metric[]; refreshing: boolean; historical_note: string; collection: { attempted: string; succeeded: string | null; error: string | null } | null }
const today = () => new Date().toLocaleDateString('sv-SE')
const number = (value: number | null, unit: string) => unit === '%' ? pct(value, { signed: false }) : decimal(value)
const change = (value: number | null, unit: string) => unit === '%' ? pp(value, { digits: 2 }) : value == null ? '—' : `${value > 0 ? '+' : ''}${decimal(value)}p`
const direction = (v: number | null) => v == null ? 'missing' : v > 0 ? 'rise' : v < 0 ? 'fall' : 'flat'
function moveDate(date: string, mode: Mode, offset: number) {
  const d = new Date(`${date}T12:00:00`)
  if (mode === 'monthly') { d.setDate(1); d.setMonth(d.getMonth() + offset) }
  else d.setDate(d.getDate() + offset * (mode === 'weekly' ? 7 : 1))
  return d.toLocaleDateString('sv-SE')
}
function Trend({ metric }: { metric: Metric }) {
  const values = metric.cells.flatMap(c => c.value == null ? [] : [c.value])
  if (values.length < 2) return <p className="sentiment-empty">추이를 그릴 관측값이 아직 부족해요.</p>
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1
  const x = (i: number) => 48 + i * 47
  const y = (v: number) => 135 - (v - min) / range * 105
  return <svg className="sentiment-chart" viewBox="0 0 600 170" role="img" aria-label={`${metric.name} 추이. 아래 표에서 날짜별 수치를 확인할 수 있어요.`}>
    {[min, max].map((v, i) => <g key={i}><line x1="48" x2="565" y1={y(v)} y2={y(v)} className="sentiment-gridline"/><text x="2" y={y(v) + 4}>{decimal(v)}</text></g>)}
    {metric.cells.map((c, i) => c.value == null ? null : <g key={c.day}>
      {i > 0 && metric.cells[i - 1].value != null && <line x1={x(i - 1)} y1={y(metric.cells[i - 1].value!)} x2={x(i)} y2={y(c.value)} className="sentiment-line"/>}
      <circle cx={x(i)} cy={y(c.value)} r="4" className="sentiment-dot"><title>{c.observed}: {number(c.value, metric.unit)}</title></circle>
    </g>)}
    <text x="48" y="162">{metric.cells[0].day}</text><text x="565" y="162" textAnchor="end">{metric.cells.at(-1)?.day}</text>
  </svg>
}

export function Sentiment() {
  const [mode, setMode] = useState<Mode>('weekly')
  const [date, setDate] = useState(today)
  const [region, setRegion] = useState('서울')
  const [data, setData] = useState<History | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState('kb_buy')
  const [heat, setHeat] = useState<'delta' | 'value'>('delta')
  const [results, setResults] = useState<Record<string, Brief>>({})
  const [busy, setBusy] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    setData(null); setError('')
    const read = async () => {
      try {
        const result = await api<History>(`/property-move/sentiment/history?mode=${mode}&date=${date}&region=${encodeURIComponent(region)}`)
        if (!active) return
        setData(result)
        if (result.refreshing) timer = setTimeout(read, 4000)
      } catch { if (active) setError('시계열을 불러오지 못했어요. 다시 조회해 주세요.') }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [mode, date, region, revision])
  const metric = data?.items.find(item => item.id === selected)
  const previousLabel = mode === 'daily' ? '전일' : mode === 'weekly' ? '전주' : '전월'
  return <section className="sentiment-dashboard" aria-label="부동산 심리">
    <div className="sentiment-controls">
      <div className="research-modes" role="group" aria-label="조회 주기">{Object.entries(modes).map(([id, label]) => <button key={id} aria-pressed={mode === id} onClick={() => setMode(id as Mode)}>{label}</button>)}</div>
      <div className="sentiment-date"><Button variant="ghost" size="icon" aria-label="이전 기간" onClick={() => setDate(moveDate(date, mode, -1))}><ChevronLeft aria-hidden="true" size={18}/></Button><label><span className="sr-only">기준 날짜</span><Input type="date" value={date} max={today()} onChange={e => { if (e.target.value && e.target.value <= today()) setDate(e.target.value) }}/></label><Button variant="ghost" size="icon" aria-label="다음 기간" disabled={moveDate(date, mode, 1) > today()} onClick={() => setDate(moveDate(date, mode, 1))}><ChevronRight aria-hidden="true" size={18}/></Button><Button variant="ghost" size="sm" onClick={() => setDate(today())}>오늘</Button></div>
      <NativeSelect aria-label="지표 지역" value={region} onChange={e => setRegion(e.target.value)}><option>서울</option><option>전국</option></NativeSelect>
    </div>
    {error ? <p role="alert">{error} <Button variant="outline" size="sm" onClick={() => setRevision(v => v + 1)}>다시 조회</Button></p> : !data ? <p role="status">공식 지표의 날짜별 기록을 불러오고 있어요…</p> : <>
      <div className="research-toolbar"><p className="research-caption">{data.start} ~ {data.end} · {region} · 최근 12{mode === 'daily' ? '일' : mode === 'weekly' ? '주' : '개월'}</p><span className="research-caption" role="status">{data.refreshing ? '공식 자료 확인 중…' : data.collection?.succeeded ? `수집 ${data.collection.succeeded.slice(0, 10)}` : '수집된 시계열 없음'}</span></div>
      {data.collection?.error && <p className="sentiment-notice" role="status">{data.collection.error}</p>}
      {mode === 'daily' && <p className="sentiment-notice">일간 수치 공급원은 아직 연결 전이에요. 아래 최근 공표값은 참고용이며, 주간·월간 값을 일간 변동으로 채우지 않아요.</p>}
      <div className="sentiment-latest">{data.items.map(item => <button key={item.id} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><span>{item.name}</span><strong>{number(item.latest?.value ?? null, item.unit)}</strong><small>{item.latest ? `${item.latest.day} · ${modes[item.frequency]} 공표값` : item.status === 'not_connected' ? '수치 연결 준비 중' : '공식 수치 미확인'}</small></button>)}</div>
      <section className="sentiment-matrix" aria-label="기간별 지표 히트맵">
        <div className="research-toolbar"><h3>{modes[mode]} 흐름</h3><div className="research-modes" role="group" aria-label="히트맵 표시"><button aria-pressed={heat === 'delta'} onClick={() => setHeat('delta')}>{previousLabel} 대비</button><button aria-pressed={heat === 'value'} onClick={() => setHeat('value')}>관측값</button></div></div>
        <p className="research-caption">색은 {previousLabel} 대비 방향 · <span className="sentiment-rise">+ 상승</span> / <span className="sentiment-fall">− 하락</span> / 0 보합 / — 자료 없음</p>
        <div className="research-table-scroll" tabIndex={0} role="region" aria-label="날짜별 지표 표"><table><thead><tr><th scope="col">지표</th>{data.periods.map(day => <th scope="col" key={day}>{mode === 'monthly' ? day.slice(2, 7).replace('-', '.') : day.slice(5).replace('-', '.')}</th>)}</tr></thead><tbody>{data.items.map(item => <tr key={item.id} className={selected === item.id ? 'sentiment-selected' : ''}><th scope="row"><button onClick={() => setSelected(item.id)}>{item.name}</button><small>{item.provider} · {modes[item.frequency]}</small></th>{item.cells.map(cell => <td key={cell.day} className={`sentiment-cell sentiment-${direction(cell.delta)}`} title={`${cell.observed ?? cell.day} · ${item.name} ${number(cell.value, item.unit)} · ${previousLabel} 대비 ${change(cell.delta, item.unit)}`}>{heat === 'delta' ? change(cell.delta, item.unit) : number(cell.value, item.unit)}</td>)}</tr>)}</tbody></table></div>
      </section>
      {metric && <section className="sentiment-detail" aria-label="선택 지표 추이"><div className="research-toolbar"><div><h3>{metric.name}</h3><p className="research-caption">{metric.provider} · {region} · 단위 {metric.unit}</p></div><a href={metric.source_url} target="_blank" rel="noreferrer">공식 통계 <ExternalLink aria-hidden="true" size={14}/></a></div><Trend metric={metric}/><p className="research-caption">{data.historical_note} 누락된 기간은 선을 연결하지 않아요.</p></section>}
    </>}
    <div className="sentiment-sources"><h3>공식 보고서·통계</h3><a href="https://data.kbland.kr/kbstats/wmh" target="_blank" rel="noreferrer">KB부동산 주간·월간 동향 <ExternalLink aria-hidden="true" size={14}/></a><a href="https://www.reb.or.kr/reb/na/ntt/selectNttList.do?bbsId=1154&mi=9565" target="_blank" rel="noreferrer">한국부동산원 발표 자료 <ExternalLink aria-hidden="true" size={14}/></a><p className="research-caption">기관 자료실로 연결돼요. 선택 기간의 개별 보고서 자동 연결은 준비 중이에요.</p></div>
    <details className="sentiment-research"><summary>항목별 AI 최신 조사</summary><p className="research-caption">위 날짜별 통계와 별도로, 오늘 공개된 자료를 조사해요.</p>{topics.map(([id, title, detail]) => <section key={id} className="sentiment-row"><div><div className="research-toolbar"><div><h3>{title}</h3><small>{detail}</small></div><Button variant="outline" size="sm" disabled={!!busy} onClick={async () => { setBusy(id); setErrors(old => ({ ...old, [id]: '' })); try { const result = await api<Brief>('/property-move/sentiment', 'POST', { topic: id }); setResults(old => ({ ...old, [id]: result })) } catch { setErrors(old => ({ ...old, [id]: '조사하지 못했어요. 잠시 후 다시 시도해 주세요.' })) } finally { setBusy('') } }}>{busy === id ? '확인 중…' : results[id] ? '다시 확인' : '최신 확인'}</Button></div>{errors[id] && <p role="alert">{errors[id]}</p>}{results[id] && <><small>{results[id].as_of} 조사</small><div className="expert-report">{results[id].text}</div><details><summary>출처 {results[id].sources.length}개</summary>{results[id].sources.map(s => <p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></p>)}</details></>}</div></section>)}</details>
  </section>
}
