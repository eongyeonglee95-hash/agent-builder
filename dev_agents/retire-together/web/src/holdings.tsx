import { useCallback, useEffect, useState } from 'react'
import { Info, RefreshCw, Sheet } from 'lucide-react'
import { Modal } from './components'
import { AssetSheet } from './sheet'
import { api } from './local-data'
import { classInfo, type Owner } from './model'
import './holdings.css'

// 종목 잔고 — 등록한 계좌의 종목별 손익 (Claude 담당). 숫자는 전부 서버(tools/holdings.py, CALCULATION_RULES §7)가 계산한다.
// 참고: Robinhood 'Position' 여섯 칸, Portfolio Overview의 "잔고 변화는 수익이 아니다", Digest의 "어제 종가 이후" (docs/research/ROBINHOOD_DEEP_DIVE.md)

type Row = { account_id: string; ticker_name: string; ticker: string | null; qty: number; price: number; live: boolean; value: number; buy_value: number | null; avg_cost: number | null; total_return: number | null; total_rate: number | null; today_return: number | null; today_rate: number | null; weight: number; asset_class: string | null; stock_group: string | null; buy_source: string | null }
type Totals = { value: number; buy_value: number | null; total_return: number | null; total_rate: number | null; cost_known: number; count: number; today_return: number | null; today_rate: number | null }
type Account = Totals & { id: string; label: string; owner: 'me' | 'partner'; as_of: string | null; age_days: number | null; stale: boolean }
type Data = { accounts: Account[]; holdings: Row[]; total: Totals; movers: { drivers: Row[]; top: Row[] }; live: boolean; stale_days: number; quote_failed: string[]; missing_ticker: string[] }
type Sort = 'value' | 'today_return' | 'today_rate' | 'total_return' | 'total_rate' | 'name'
const SORTS: [Sort, string][] = [['value', '평가금액'], ['today_return', '오늘 손익'], ['today_rate', '오늘 등락률'], ['total_return', '총 손익'], ['total_rate', '수익률'], ['name', '이름']]
const GROUP_LABEL: Record<string, string> = { kr: '국내', us: '미국', em: '신흥국·테마', income: '배당·리츠' }

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString('ko-KR')}`
const pct = (n: number | null) => n === null ? '' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
const tone = (n: number | null) => n === null || n === 0 ? '' : n < 0 ? 'down' : 'up'

export function HoldingsPanel({ owner, hidden, stockOnly = false, onRegister, onChanged }: { owner: Owner; hidden: boolean; stockOnly?: boolean; onRegister: () => void; onChanged?: () => void }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetMsg, setSheetMsg] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sort, setSort] = useState<Sort>('value')
  const [grouped, setGrouped] = useState(true)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await api<Data>(`/holdings?owner=${owner}${live ? '&live=1' : ''}${stockOnly ? '&asset_class=stock' : ''}`)) }
    catch (e) { setError(e instanceof Error ? e.message : '종목 잔고를 불러오지 못했어요.') }
    finally { setLoading(false) }
  }, [owner, live, stockOnly])
  useEffect(() => { load() }, [load])
  useEffect(() => { const h = () => { load() }; window.addEventListener('retire:holdings-changed', h); return () => window.removeEventListener('retire:holdings-changed', h) }, [load])

  const m = (n: number) => hidden ? '••••••' : won(n)
  const ms = (n: number) => hidden ? '•••' : signed(n)

  if (error) return <section className="panel hp"><div className="form-error" role="alert"><Info size={16}/>{error}<button onClick={load}>다시 시도</button></div></section>
  if (!data) return <section className="panel hp"><div className="loading-strip" role="status">종목 잔고를 불러오는 중…</div></section>
  if (!data.accounts.length) return <section className="panel hp hp-empty">
    <h2>{stockOnly ? '보유 주식' : '종목 잔고'}</h2>
    <p>증권사 앱 잔고를 사진이나 파일로 등록하면 계좌별로 넣은 돈, 불어난 돈, 종목별 손익이 여기에 보여요.</p>
    <button className="primary-button" onClick={onRegister}>잔고 등록하기</button>
  </section>

  const t = data.total
  const accountLabel = Object.fromEntries(data.accounts.map(a => [a.id, a.label]))
  const staleIds = new Set(data.accounts.filter(a => a.stale).map(a => a.id))
  const key = (r: Row): number | string => sort === 'name' ? r.ticker_name : (r[sort] ?? -Infinity)
  const sorted = [...data.holdings].sort((a, b) => sort === 'name' ? String(key(a)).localeCompare(String(key(b)), 'ko') : (key(b) as number) - (key(a) as number))
  const groups = grouped
    ? [...new Set(sorted.map(r => r.asset_class ?? ''))].map(c => ({ c, rows: sorted.filter(r => (r.asset_class ?? '') === c) })).sort((a, b) => b.rows.reduce((n, r) => n + r.value, 0) - a.rows.reduce((n, r) => n + r.value, 0))
    : [{ c: '__all', rows: sorted }]

  return <section className="panel hp">
    <div className="hp-top">
      <div><h2>{stockOnly ? '보유 주식' : '종목 잔고'}</h2><p>{data.accounts.length}개 계좌 · 등록한 잔고 기준{data.live ? ' · 현재가 반영' : ''}</p></div>
      <div className="hp-actions"><button className="hp-sheet-btn" onClick={() => setSheetOpen(true)}><Sheet size={14}/>엑셀처럼 고치기</button><label className="hp-live"><input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)}/>현재가로 보기{loading && <RefreshCw size={13} className="spin"/>}</label></div>
    </div>
    {sheetMsg && <p className="hp-note">{sheetMsg}</p>}
    {sheetOpen && <Modal title="엑셀처럼 고치기" onClose={() => setSheetOpen(false)}><AssetSheet owner={owner} initialTab="holdings" onSaved={msg => { setSheetOpen(false); setSheetMsg(msg); load(); onChanged?.() }}/></Modal>}

    <div className="hp-sum n">
      <div className="hp-big">{m(t.value)}</div>
      {t.total_return !== null && t.buy_value !== null && <div className="hp-split">
        <span>넣은 돈 <b>{m(t.buy_value)}</b></span>
        <span>불어난 돈 <b className={tone(t.total_return)}>{ms(t.total_return)}원</b> <span className={tone(t.total_return)}>{hidden ? '' : pct(t.total_rate)}</span></span>
      </div>}
      {data.live && t.today_return !== null && <div className="hp-today">어제 종가 대비 <b className={tone(t.today_return)}>{ms(t.today_return)}원 {hidden ? '' : pct(t.today_rate)}</b></div>}
      <p className="hp-note">{t.cost_known < t.count ? `매입금액을 아는 ${t.cost_known}/${t.count}종목으로 넣은 돈과 불어난 돈을 계산했어요. 나머지는 매입금액을 넣으면 함께 계산돼요. ` : ''}연금 납입으로 늘어난 금액은 넣은 돈이라 불어난 돈에 들어가지 않아요.{data.holdings.some(r => r.buy_source) ? ` 매입금액 옆 *는 보유수량이 같은 이전 등록(${[...new Set(data.holdings.map(r => r.buy_source).filter(Boolean))].join(', ')})에서 가져온 값이에요.` : ''}</p>
      {data.quote_failed.length > 0 && <p className="hp-note warn">현재가를 받지 못한 종목 {data.quote_failed.length}개는 등록한 가격으로 보여요.</p>}
      {live && data.missing_ticker.length > 0 && <p className="hp-note warn">종목코드가 없는 {data.missing_ticker.join(', ')}은 현재가를 받을 수 없어요.</p>}
    </div>

    <div className="hp-accounts">
      {data.accounts.map(a => <div className={`hp-acct ${a.stale ? 'stale' : ''}`} key={a.id}>
        <div><strong>{a.label}</strong><small>{a.owner === 'me' ? '나' : '배우자'} · {a.as_of ? `${a.as_of.replaceAll('-', '.')} 잔고` : '기준일 모름'}{a.stale && a.age_days !== null && <> · {a.age_days}일 전 잔고예요 <button className="rv-link" onClick={onRegister}>다시 등록</button></>}</small></div>
        <div className="n hp-acct-num"><b>{m(a.value)}</b>{a.total_return !== null && <small className={tone(a.total_return)}>{ms(a.total_return)} {hidden ? '' : pct(a.total_rate)}</small>}</div>
      </div>)}
    </div>

    {data.live && data.movers.drivers.length > 0 && <div className="hp-movers">
      <div><h3>어제 종가 이후, 내 손익을 가장 많이 움직인 종목</h3>{data.movers.drivers.map(r => <p key={`d-${r.account_id}-${r.ticker_name}`}><span>{r.ticker_name}</span><b className={`n ${tone(r.today_return)}`}>{ms(r.today_return ?? 0)}원</b></p>)}</div>
      <div><h3>가장 크게 움직인 종목</h3>{data.movers.top.map(r => <p key={`t-${r.account_id}-${r.ticker_name}`}><span>{r.ticker_name}</span><b className={`n ${tone(r.today_rate)}`}>{pct(r.today_rate)}</b></p>)}</div>
      <small>시세로 계산한 사실이에요. 왜 움직였는지(시장 배경)와 다가올 일정은 뉴스를 연결한 뒤에 따로 보여 드려요.</small>
    </div>}

    <div className="hp-tools">
      <label>정렬<select value={sort} onChange={e => setSort(e.target.value as Sort)}>{SORTS.filter(([k]) => data.live || !k.startsWith('today')).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="hp-check"><input type="checkbox" checked={grouped} onChange={e => setGrouped(e.target.checked)}/>자산군별로 묶기</label>
    </div>
    <div className="hp-list">
      <div className="hp-head"><span>종목 · 보유수량</span><span>평가금액 · 매입</span><span>총 손익 · 수익률</span><span>{data.live ? '오늘' : '비중'}</span></div>
      {groups.map(g => <div key={g.c}>
        {g.c !== '__all' && <div className="hp-group"><span><i style={{ background: classInfo[g.c]?.color ?? '#d1d6db' }}/>{classInfo[g.c]?.label ?? '자산군 미정'}<small>{g.rows.length}종목</small></span><b className="n">{m(g.rows.reduce((n, r) => n + r.value, 0))}</b></div>}
        {g.rows.map(r => <div className={`hp-row ${staleIds.has(r.account_id) ? 'stale' : ''}`} key={`${r.account_id}-${r.ticker_name}`}>
          <span className="hp-nm">{r.ticker_name}</span>
          <span className="hp-sub n">{r.qty.toLocaleString('ko-KR')}주{r.avg_cost ? ` · 평균 ${hidden ? '•••' : won(r.avg_cost)}` : ''} · {accountLabel[r.account_id]}{r.stock_group ? ` · ${GROUP_LABEL[r.stock_group]}` : ''}</span>
          <span className="hp-val n">{m(r.value)}</span><span className="hp-buy n" title={r.buy_source ? `매입금액은 ${r.buy_source} 등록에서 가져왔어요 (보유수량이 같을 때만)` : undefined}>{r.buy_value ? `${m(r.buy_value)}${r.buy_source ? '*' : ''}` : '매입 모름'}</span>
          <span className={`hp-pl n ${tone(r.total_return)}`}>{r.total_return === null ? '—' : ms(r.total_return)}</span><span className={`hp-rt n ${tone(r.total_rate)}`}>{hidden ? '' : pct(r.total_rate)}</span>
          {data.live ? <><span className={`hp-wt n ${tone(r.today_return)}`}>{r.today_return === null ? '—' : ms(r.today_return)}</span><span className={`hp-wt2 n ${tone(r.today_rate)}`}>{pct(r.today_rate)}</span></>
            : <span className="hp-wt n">{r.weight.toFixed(1)}%</span>}
        </div>)}
      </div>)}
    </div>
  </section>
}
