import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowDownToLine, FileText, Info, RefreshCw, ShieldCheck } from 'lucide-react'
import { api } from './local-data'
import { classInfo, type Owner } from './model'
import { PanelHeading } from './components'

type Pool = { id: string; label: string; owner: 'me' | 'partner'; mode: 'rebalance' | 'buy_only'; strategy_id: string; accounts: { id: string; label: string }[] }
type Preview = {
  preview_id: string; pool_label: string; strategy_name: string; mode: string; as_of: string
  total_value: number; new_cash: number; threshold: number; explanation: string
  blocked_reason: string | null; notes: string[]; account_labels: Record<string, string>
  classes: { asset_class: string; label: string; target: number; current: number; deviation_pp: number; over_threshold: boolean }[]
  constraints: { name: string; passed: boolean; detail: string }[]
  orders: { side: string; asset_class: string; account_id: string; ticker_name: string | null; ticker: string | null; qty: number | null; amount: number; note: string }[]
}
const won = (value: number) => `${value.toLocaleString('ko-KR')}원`

export function RebalancePreview({ owner }: { owner: Owner }) {
  const [pools, setPools] = useState<Pool[]>([])
  const [poolId, setPoolId] = useState('')
  const [loading, setLoading] = useState(true)
  const [csv, setCsv] = useState('')
  const [filename, setFilename] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Preview | null>(null)
  const fileRevision = useRef(0)
  const [revision, setRevision] = useState(0)
  const selected = pools.find(p => p.id === poolId)
  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('계좌 정보를 불러오는 시간이 초과되었습니다. 다시 시도해 주세요.')), 8000)
    setLoading(true); setError('')
    api<Pool[]>(`/rebalance/options?owner=${owner}`, 'GET', undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) { setPools(data); setPoolId(data[0]?.id ?? '') } })
      .catch(e => { if (!controller.signal.aborted || controller.signal.reason instanceof Error) setError(e instanceof Error ? e.message : '계좌 정보를 불러오지 못했습니다.') })
      .finally(() => { clearTimeout(timeout); if (!controller.signal.aborted || controller.signal.reason instanceof Error) setLoading(false) })
    return () => { clearTimeout(timeout); controller.abort('navigation'); fileRevision.current++ }
  }, [owner, revision])

  function template() {
    if (!selected) return
    const content = '\uFEFFaccount_id,ticker_name,ticker,qty,price\n' + selected.accounts.map(a => `${a.id},,,,`).join('\n')
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = '연금_종목잔고_양식.csv'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!csv || !selected) return
    const data = new FormData(event.currentTarget)
    setBusy(true); setError(''); setResult(null)
    try {
      const response = await api<Preview>('/rebalance/preview', 'POST', {
        pool_id: poolId, csv, as_of: data.get('as_of'), new_cash: Number(data.get('new_cash')),
        new_cash_account: data.get('new_cash_account'),
      })
      setResult(response)
    } catch (e) { setError(e instanceof Error ? e.message : '계산하지 못했습니다.') }
    finally { setBusy(false) }
  }
  return <section className="panel engine-panel" aria-label="종목 잔고로 리밸런싱 계산">
    <PanelHeading title="종목 잔고로 계산해 보세요" detail="계좌에 정한 전략을 기준으로 검토용 주문표를 계산해요."><span className="outline-tag">드라이런</span></PanelHeading>
    <p className="form-intro">수량과 가격이 있는 종목 잔고 CSV를 올려 주세요. 위의 수동 자산 총액과 별도로 계산하며, 등록한 자산 금액은 바뀌지 않습니다.</p>
    {loading ? <p role="status">계좌 설정을 불러오고 있어요…</p> : !pools.length ? <div className="empty-state"><FileText size={28}/><h3>계산할 연금저축 계좌가 없어요</h3><p>기존 계좌 설정에서 활성화된 연금저축 계좌를 먼저 확인해 주세요.</p><button className="secondary-button" onClick={() => setRevision(v => v + 1)}>다시 불러오기</button></div> : <form onSubmit={submit} onChange={() => setResult(null)}>
      <fieldset disabled={busy} className="engine-fields">
        <div className="form-grid"><label className="form-label">계산할 계좌 묶음<select aria-label="계산할 계좌 묶음" value={poolId} onChange={e => { setPoolId(e.target.value); setCsv(''); setFilename(''); setError(''); fileRevision.current++ }}>
          {pools.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select></label><label className="form-label">잔고·가격 기준일<input name="as_of" type="date" max={new Date().toLocaleDateString('en-CA')} required/></label></div>
        <div className="engine-upload" key={poolId}><label className="form-label">종목 잔고 CSV<input type="file" accept=".csv,text/csv" aria-label="종목 잔고 CSV" onChange={async e => {
          const file = e.target.files?.[0]; const token = ++fileRevision.current
          setCsv(''); setFilename(''); setError('')
          if (!file) return
          if (file.size > 200_000) { setError('CSV 파일은 200KB 이하로 올려 주세요.'); return }
          try {
            const text = await file.text()
            if (token !== fileRevision.current) return
            setCsv(text); setFilename(file.name)
          } catch { if (token === fileRevision.current) setError('파일을 읽지 못했습니다. 다시 선택해 주세요.') }
        }}/><small>{filename ? `${filename} · 계산 전 확인된 종목 분류와 대조합니다.` : '양식의 계좌별로 종목명·종목코드·정수 수량·가격(원)을 입력해 주세요.'}</small></label><button type="button" className="secondary-button" onClick={template}><ArrowDownToLine size={15}/>CSV 양식</button></div>
        <div className="form-grid"><label className="form-label">추가 납입금 (원)<input name="new_cash" type="number" min="0" max="1000000000000000" step="1" defaultValue="0" required/></label><label className="form-label">납입할 계좌<select name="new_cash_account" key={poolId} required>{selected?.accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label></div>
        <p className="form-help">{selected?.mode === 'buy_only' ? '매수만' : '매도·매수'} 모드 · 등록된 계좌 전략 사용 · 업로드한 가격으로 계산 · 예수금은 현재 별도 입력 전입니다.</p>
        <button className="primary-button" type="submit" disabled={!csv || busy}><RefreshCw size={16}/>{busy ? '계산 중…' : '잔고 확인·계산'}</button>
      </fieldset>
    </form>}
    {error && <div className="form-error" role="alert"><Info size={16}/>{error}{!pools.length && <button onClick={() => setRevision(v => v + 1)}>다시 시도</button>}</div>}
    {result && <div className="engine-result" aria-live="polite">
      <div className="engine-result-heading"><div><h3>검토용 주문표</h3><p>{result.pool_label} · {result.strategy_name} · {result.as_of} 기준</p></div><strong>{won(result.total_value)}{result.new_cash > 0 && <small> + 납입 {won(result.new_cash)}</small>}</strong></div>
      <p className="engine-explanation">{result.explanation}</p>
      <div className="engine-classes">{result.classes.map(c => <div className="allocation-row" key={c.asset_class}><span>{c.label}</span><div className="allocation-bars"><div style={{ width: `${c.target * 100}%` }}/><div style={{ width: `${c.current * 100}%`, background: classInfo[c.asset_class]?.color }}/></div><span>{(c.target * 100).toFixed(1)}% → {(c.current * 100).toFixed(1)}%</span><b className={c.over_threshold ? 'deviation-warn' : ''}>{c.deviation_pp > 0 ? '+' : ''}{c.deviation_pp.toFixed(1)}%p</b></div>)}</div>
      <div className="table-scroll"><table><caption className="sr-only">계좌별 검토용 주문표</caption><thead><tr><th>구분</th><th>계좌</th><th>종목</th><th>수량</th><th className="number-cell">예상 금액</th><th>비고</th></tr></thead><tbody>
        {result.orders.length ? result.orders.map((o, i) => <tr key={i}><td>{o.side}</td><td>{result.account_labels[o.account_id] ?? '—'}</td><td>{o.ticker_name ?? '종목 확인 필요'}<small className="order-ticker">{o.ticker}</small></td><td>{o.qty === null ? '미확정' : `${o.qty.toLocaleString('ko-KR')}주`}</td><td className="number-cell">{won(o.amount)}</td><td className="order-note">{o.note}</td></tr>) : <tr><td colSpan={6}>{result.blocked_reason ? '확인할 항목이 있어 주문표를 보류했습니다.' : '이번 입력에서는 거래 항목이 없습니다.'}</td></tr>}
      </tbody></table></div>
      {result.blocked_reason && <p className="form-error" role="alert">{result.blocked_reason}</p>}
      <ul className="engine-notes">{result.notes.map(note => <li key={note}>{note}</li>)}</ul>
      <div className="engine-checks">{result.constraints.map(c => <span key={c.name}>{c.passed ? '✓' : '✗'} {c.name}</span>)}</div>
      <div className="info-note"><ShieldCheck size={18}/><p>잔고 시점의 가격을 사용한 검토용 결과입니다. 수량이 미확정이면 종목·가격 확인이 필요합니다. 실제 주문 전 최신 가격과 계좌 제한을 증권사에서 확인해 주세요.</p></div>
    </div>}
  </section>
}
