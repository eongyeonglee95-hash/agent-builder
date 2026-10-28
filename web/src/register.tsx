import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Camera, Check, FileSpreadsheet, Info, PencilLine, Plus, Upload, X } from 'lucide-react'
import { AssetForm } from './forms'
import { api } from './local-data'
import { classInfo, money, type Asset, type Family, type Owner } from './model'
import './register.css'

// REG-01 — '자산 등록' 한 곳. 사진(캡처)·직접 입력·파일 중 고르면 같은 확인 표로 모이고 저장은 한 곳(/api/register/commit)으로 간다.
// 계산은 전부 서버(코드)가 한다. 화면은 값을 보여 주고 사용자가 고친 칸을 그대로 보낸다.

type Method = 'choose' | 'capture' | 'manual' | 'file'
export type RegisterAccount = { id: string; label: string; owner: 'me' | 'partner'; broker: string | null; broker_label: string; account_type: string | null; type_label: string; pocket: 'retirement' | 'cash'; active: boolean; has_holdings: boolean }
type PreviewRow = { ticker_name: string; ticker: string | null; qty: number | null; price: number | null; value: number | null; buy_value: number | null; asset_class: string | null; confirmed: boolean; candidates: [string, string][] }
type Preview = { account_id: string; account_label: string; source: 'capture' | 'file'; rows: PreviewRow[]; computed_total: number; screen_total: number | null; verified: boolean; reconciled: boolean; diff: number; value_diff: number | null; errors: string[]; class_labels: Record<string, string>; matched_label?: string | null; suggested?: { label: string; owner: 'me' | 'partner'; broker: string; account_type: string } }
type EditRow = { key: number; ticker_name: string; ticker: string; qty: string; price: string; asset_class: string; confirmed: boolean; candidates: [string, string][] }
const HOLDING_CLASSES = ['stock', 'long_bond', 'mid_bond', 'gold', 'commodity', 'cash', 'mixed']
const BROKERS: [string, string][] = [['mirae', '미래에셋'], ['kiwoom', '키움'], ['kis', '한국투자'], ['samsung', '삼성'], ['nh', 'NH'], ['kb', 'KB'], ['shinhan', '신한'], ['toss', '토스'], ['other', '기타']]
const TYPES: [string, string][] = [['pension_savings', '연금저축'], ['irp', 'IRP'], ['isa', 'ISA'], ['general', '일반(주식·예금)']]

async function upload<T>(path: string, form: FormData): Promise<T> {
  let response: Response
  try { response = await fetch(`/api${path}`, { method: 'POST', body: form, headers: { 'X-Retire-Local': '1' } }) }
  catch { throw new Error('저장 서버에 연결할 수 없습니다. 서버 실행 상태를 확인한 뒤 다시 시도해 주세요.') }
  if (!response.ok) {
    let detail: unknown
    try { detail = (await response.json()).detail } catch { /* non-JSON */ }
    throw new Error(typeof detail === 'string' ? detail : '파일을 읽지 못했어요. 다시 시도해 주세요.')
  }
  return response.json()
}
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
const toInt = (s: string) => { const n = Number(String(s).replace(/[,\s]/g, '')); return Number.isInteger(n) && n > 0 ? n : null }

export function RegisterModal({ family, owner, page, asset, parent, onSaved, onProfile }: {
  family: Family | null; owner: Owner; page: string; asset: Asset | null; parent?: Asset | null; onSaved: (message: string) => void; onProfile: () => void
}) {
  const [method, setMethod] = useState<Method>(asset ? 'manual' : 'choose')
  if (asset) return <AssetForm family={family} asset={asset} owner={owner} parent={parent} onSaved={() => onSaved('자산을 수정했어요.')} onProfile={onProfile}/>
  if (method === 'choose') return <div className="register-choose">
    <p className="form-intro">가장 쉬운 방법으로 시작해요.<br/>어느 길로 들어와도 같은 확인 표에서 저장돼요.</p>
    <div className="register-choice" role="group" aria-label="등록 방법">
      <button onClick={() => setMethod('capture')}><span className="choice-icon capture"><Camera size={24}/></span><strong>사진</strong><small>증권사 앱 잔고 화면 캡처를 올려요. 표로 바뀌고 합계를 맞춰 봐요.</small></button>
      <button onClick={() => setMethod('manual')}><span className="choice-icon manual"><PencilLine size={24}/></span><strong>직접 입력</strong><small>집·대출·예금처럼 금액만 알면 되는 자산.</small></button>
      <button onClick={() => setMethod('file')}><span className="choice-icon file"><FileSpreadsheet size={24}/></span><strong>파일</strong><small>CSV나 엑셀. 종목명·수량·현재가 열만 있으면 돼요.</small></button>
    </div>
    <p className="form-help">사진과 파일은 종목 단위로 저장되고 자산군별 금액으로 묶여 자산 표에 올라가요. 구글 시트가 연결돼 있으면 시트에 바로 쓰여요.</p>
  </div>
  if (method === 'manual') return <><BackLink onClick={() => setMethod('choose')}/><AssetForm family={family} asset={null} owner={owner} parent={parent} initialKind={page === 'stocks' ? 'stock' : page === 'property' ? 'property' : undefined} onSaved={() => onSaved('자산을 등록했어요.')} onProfile={onProfile}/></>
  return <><BackLink onClick={() => setMethod('choose')}/><UploadFlow mode={method} owner={owner} onSaved={onSaved}/></>
}

function BackLink({ onClick }: { onClick: () => void }) {
  return <button type="button" className="text-link register-back" onClick={onClick}><ArrowLeft size={14}/>다른 방법으로</button>
}

type Group = { key: number; preview: Preview; rows: EditRow[]; accountId: string; acceptDiff: boolean; creating: boolean; error: string; saved: string }
const toEdit = (p: Preview): EditRow[] => p.rows.map((r, i) => ({ key: i, ticker_name: r.ticker_name, ticker: r.ticker ?? '', qty: r.qty === null ? '' : String(r.qty), price: r.price === null ? '' : String(r.price), asset_class: r.asset_class ?? '', confirmed: r.confirmed, candidates: r.candidates }))
function rowProblems(rows: EditRow[]) {
  return [...new Set(rows.flatMap(r => [
    !r.ticker_name.trim() ? '종목명이 빈 행이 있어요.' : '',
    toInt(r.qty) === null ? `${r.ticker_name || '빈 행'}: 수량은 1 이상의 정수` : '',
    toInt(r.price) === null ? `${r.ticker_name || '빈 행'}: 현재가는 1 이상의 정수` : '',
    !r.asset_class ? `${r.ticker_name || '빈 행'}: 자산군을 골라 주세요` : '',
    r.ticker && !/^[0-9A-Z]{6}$/.test(r.ticker.trim().toUpperCase()) ? `${r.ticker_name}: 종목코드는 6자리` : '',
  ].filter(Boolean)))]
}

export function UploadFlow({ mode, owner, onSaved }: { mode: 'capture' | 'file'; owner: Owner; onSaved: (message: string) => void }) {
  const [accounts, setAccounts] = useState<RegisterAccount[]>([])
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [asOf, setAsOf] = useState(new Date().toLocaleDateString('en-CA'))
  const inputRef = useRef<HTMLInputElement>(null)
  const today = new Date().toLocaleDateString('en-CA')
  const isCapture = mode === 'capture'
  const ownerHint = owner === 'partner' ? 'partner' : 'me'

  async function loadAccounts() {
    try { setAccounts(await api<RegisterAccount[]>('/register/accounts')) } catch { /* 목록이 없어도 등록은 진행 — 확인 표에서 새 계좌를 만든다 */ }
  }
  useEffect(() => { loadAccounts() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  function pick(list: FileList | null) {
    if (!list) return
    const next = Array.from(list).filter(f => isCapture ? f.type.startsWith('image/') : /\.(csv|xlsx|xlsm|xls)$/i.test(f.name))
    if (!next.length) { setError(isCapture ? 'PNG·JPG 이미지를 올려 주세요.' : 'CSV 또는 엑셀(.xlsx) 파일을 올려 주세요.'); return }
    setError('')
    setFiles(isCapture ? [...files, ...next].slice(0, 12) : [next[0]])
  }
  async function convert() {
    if (!files.length) { setError(isCapture ? '캡처를 한 장 이상 올려 주세요.' : '파일을 올려 주세요.'); return }
    setBusy(true); setError('')
    const form = new FormData()
    form.append('owner', ownerHint)
    if (isCapture) files.forEach(f => form.append('images', f)); else form.append('file', files[0])
    try {
      const out = await upload<{ groups: Preview[] }>(isCapture ? '/register/capture' : '/register/file', form)
      setGroups(out.groups.map((p, i) => ({ key: i, preview: p, rows: toEdit(p), accountId: p.account_id ?? '', acceptDiff: false, creating: !p.account_id, error: '', saved: '' })))
    } catch (e) { setError(e instanceof Error ? e.message : '변환하지 못했어요.') } finally { setBusy(false) }
  }
  const patchGroup = (key: number, patch: Partial<Group> | ((g: Group) => Partial<Group>)) => setGroups(gs => gs && gs.map(g => g.key === key ? { ...g, ...(typeof patch === 'function' ? patch(g) : patch) } : g))
  const editRow = (g: Group, rowKey: number, patch: Partial<EditRow>) => patchGroup(g.key, { rows: g.rows.map(r => r.key === rowKey ? { ...r, ...patch } : r) })

  function stats(g: Group) {
    const computed = g.rows.reduce((n, r) => n + (toInt(r.qty) ?? 0) * (toInt(r.price) ?? 0), 0)
    const verified = !!g.preview.screen_total
    const diff = verified ? computed - g.preview.screen_total! : 0
    const matches = verified && Math.abs(diff) <= 5000
    const problems = rowProblems(g.rows)
    const ready = !g.saved && g.rows.length > 0 && !problems.length && !!g.accountId && (!verified || matches || g.acceptDiff)
    return { computed, verified, diff, matches, problems, ready }
  }
  const pending = (groups ?? []).filter(g => !g.saved)
  const canSave = pending.length > 0 && pending.every(g => stats(g).ready)

  async function saveAll(e: FormEvent) {
    e.preventDefault()
    if (!groups || !canSave) return
    setBusy(true)
    const done: string[] = []
    let sheet = false
    for (const g of groups) {
      if (g.saved) { done.push(g.saved); continue }
      try {
        const out = await api<{ total: number; holdings: number; sheet: boolean }>('/register/commit', 'POST', {
          account_id: g.accountId, source: g.preview.source, as_of: asOf, screen_total: g.preview.screen_total, accept_diff: g.acceptDiff,
          rows: g.rows.map(r => ({ ticker_name: r.ticker_name.trim(), ticker: r.ticker.trim().toUpperCase() || null, qty: toInt(r.qty), price: toInt(r.price), asset_class: r.asset_class })),
        })
        sheet = sheet || out.sheet
        const label = accounts.find(a => a.id === g.accountId)?.label ?? g.preview.account_label
        const msg = `${label} ${out.holdings}종목 · ${money(out.total)}`
        done.push(msg); patchGroup(g.key, { saved: msg, error: '' })
      } catch (err) { patchGroup(g.key, { error: err instanceof Error ? err.message : '저장하지 못했어요.' }); setBusy(false); return }
    }
    setBusy(false)
    onSaved(`등록했어요: ${done.join(' / ')}${sheet ? ' · 구글 시트에도 썼어요.' : ''}`)
  }

  if (groups) return <form className="register-review register-wide" onSubmit={saveAll}>
    <div className="review-meta"><span>{isCapture ? '캡처에서 계좌 ' : ''}<b>{groups.length}개</b>를 찾았어요. 계좌와 자산군만 확인하고 저장하세요.</span><label className="form-label inline">기준일<input type="date" value={asOf} max={today} onChange={e => setAsOf(e.target.value)} required/></label></div>
    {groups.map(g => { const st = stats(g); return <section className={`review-group ${g.saved ? 'is-saved' : ''}`} key={g.key}>
      <header className="group-head">
        <div className="group-title"><strong>{g.preview.account_label}</strong><small>{g.rows.length}종목 · {won(st.computed)}</small></div>
        <div className="group-account">
          <select aria-label="저장할 계좌" value={g.creating ? '__new__' : g.accountId} onChange={e => e.target.value === '__new__' ? patchGroup(g.key, { creating: true }) : patchGroup(g.key, { creating: false, accountId: e.target.value })}>
            <option value="" disabled>저장할 계좌 고르기</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.label} · {a.owner === 'me' ? '나' : '배우자'} · {a.broker_label} {a.type_label}</option>)}
            <option value="__new__">새 계좌로 추가 — {g.preview.suggested?.label ?? g.preview.account_label}</option>
          </select>
          {g.preview.account_id && !g.creating && <small className="matched-tag"><Check size={12}/>{g.preview.matched_label}로 맞췄어요</small>}
        </div>
      </header>
      {g.creating && <NewAccount initial={g.preview.suggested ?? { label: g.preview.account_label, owner: ownerHint, broker: 'other', account_type: 'general' }} onCancel={accounts.length ? () => patchGroup(g.key, { creating: false }) : undefined} onCreated={async id => { await loadAccounts(); patchGroup(g.key, { creating: false, accountId: id }) }}/>}
      <div className={`reconcile-banner ${!st.verified ? 'unknown' : st.matches ? 'ok' : 'warn'}`}>
        {!st.verified ? <><Info size={17}/><span><strong>합계를 대조할 수 없어요.</strong> {isCapture ? '캡처에서 화면 합계를 못 읽었어요.' : '파일에 평가금액 열이 없어요.'} 수량·현재가를 눈으로 확인한 뒤 저장하세요.</span></>
          : st.matches ? <><Check size={17}/><span><strong>{isCapture ? '화면' : '파일'} 합계 {won(g.preview.screen_total!)}과 일치해요.</strong></span></>
          : <><Info size={17}/><span><strong>{isCapture ? '화면' : '파일'} 합계와 {st.diff > 0 ? '+' : ''}{st.diff.toLocaleString('ko-KR')}원 차이가 있어요.</strong> {isCapture ? '이 계좌의 캡처가 한 장 빠졌을 수 있어요.' : '평가금액 열과 수량×현재가가 달라요.'} 틀린 칸을 고치거나 아래에서 차이를 확인해 주세요.</span></>}
      </div>
      {g.preview.errors.length > 0 && <ul className="register-errors">{g.preview.errors.map(e => <li key={e}>{e}</li>)}</ul>}
      <div className="table-scroll register-table-wrap"><table className="register-table"><thead><tr><th>종목명</th><th>종목코드</th><th className="number-cell">수량</th><th className="number-cell">현재가</th><th className="number-cell">평가금액</th><th>자산군</th><th><span className="sr-only">삭제</span></th></tr></thead><tbody>
        {g.rows.map(r => <tr key={r.key}>
          <td><input aria-label="종목명" value={r.ticker_name} onChange={e => editRow(g, r.key, { ticker_name: e.target.value })}/>{r.candidates.length > 0 && !r.ticker && <small className="candidates">종목코드 후보: {r.candidates.map(([code, name]) => <button type="button" key={code} onClick={() => editRow(g, r.key, { ticker: code })}>{code} {name}</button>)}</small>}</td>
          <td><input aria-label="종목코드" className="mono" value={r.ticker} maxLength={6} placeholder="6자리" onChange={e => editRow(g, r.key, { ticker: e.target.value })}/></td>
          <td><input aria-label="수량" className="number" inputMode="numeric" value={r.qty} onChange={e => editRow(g, r.key, { qty: e.target.value })}/></td>
          <td><input aria-label="현재가" className="number" inputMode="numeric" value={r.price} onChange={e => editRow(g, r.key, { price: e.target.value })}/></td>
          <td className="number-cell">{toInt(r.qty) && toInt(r.price) ? won(toInt(r.qty)! * toInt(r.price)!) : '—'}</td>
          <td><select aria-label="자산군" value={r.asset_class} className={r.asset_class ? '' : 'needs-choice'} onChange={e => editRow(g, r.key, { asset_class: e.target.value })}><option value="">고르기</option>{HOLDING_CLASSES.map(c => <option key={c} value={c}>{classInfo[c]?.label ?? c}</option>)}</select>{r.asset_class && r.confirmed && <small className="confirmed-tag">확인됨</small>}</td>
          <td><button type="button" className="icon-button" aria-label={`${r.ticker_name || '행'} 삭제`} onClick={() => patchGroup(g.key, { rows: g.rows.filter(x => x.key !== r.key) })}><X size={15}/></button></td>
        </tr>)}
      </tbody><tfoot><tr><td colSpan={4}>수량 × 현재가 합계</td><td className="number-cell"><strong>{won(st.computed)}</strong></td><td colSpan={2}>{st.verified && <small>{isCapture ? '화면' : '파일'} 합계 {won(g.preview.screen_total!)}</small>}</td></tr></tfoot></table></div>
      <div className="button-row review-tools"><button type="button" className="secondary-button" onClick={() => patchGroup(g.key, { rows: [...g.rows, { key: Date.now(), ticker_name: '', ticker: '', qty: '', price: '', asset_class: '', confirmed: false, candidates: [] }] })}><Plus size={14}/>행 추가</button>{st.verified && !st.matches && <label className="checkbox-label"><input type="checkbox" checked={g.acceptDiff} onChange={e => patchGroup(g.key, { acceptDiff: e.target.checked })}/>차이를 확인했고 이대로 저장할게요</label>}</div>
      {st.problems.length > 0 && <ul className="register-errors soft">{st.problems.slice(0, 4).map(p => <li key={p}>{p}</li>)}</ul>}
      {!g.accountId && !g.creating && <ul className="register-errors soft"><li>저장할 계좌를 골라 주세요.</li></ul>}
      {g.error && <div className="form-error" role="alert"><Info size={16}/>{g.error}</div>}
      {g.saved && <div className="reconcile-banner ok"><Check size={17}/><span>저장했어요: {g.saved}</span></div>}
    </section> })}
    <p className="form-help">자산군은 한 번 고르면 종목 매핑에 ‘확인됨’으로 남아 다음부터 묻지 않아요. 여러 자산이 섞인 상품은 ‘혼합·미분류’.</p>
    <div className="button-row register-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setGroups(null)}>다시 올리기</button><button type="submit" className="primary-button" disabled={busy || !canSave}>{busy ? '저장 중…' : pending.length > 1 ? `계좌 ${pending.length}개 모두 저장` : '저장'}<Check size={16}/></button></div>
  </form>

  return <div className="register-upload">
    <p className="form-intro">{isCapture ? <>증권사 앱의 잔고 화면을 캡처해서 전부 올려요.<br/>계좌가 여러 개여도 한 번에 — 화면 위의 계좌 이름으로 나눠요.</> : <>CSV나 엑셀을 올려요.<br/>종목명·수량·현재가(또는 평가금액) 열만 있으면 돼요.</>}</p>
    <button type="button" className={`dropzone ${files.length ? 'has-files' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files) }}>
      <Upload size={22}/><strong>{isCapture ? '캡처 이미지 올리기' : '파일 올리기'}</strong><small>{isCapture ? '여러 장 · 여러 계좌 가능 · PNG, JPG · 끌어다 놓기' : 'CSV, XLSX · 끌어다 놓기'}</small>
      <input ref={inputRef} type="file" hidden multiple={isCapture} accept={isCapture ? 'image/png,image/jpeg,image/webp' : '.csv,.xlsx,.xlsm,.xls'} onChange={e => { pick(e.target.files); e.target.value = '' }}/>
    </button>
    {files.length > 0 && <ul className="file-list">{files.map((f, i) => <li key={`${f.name}-${i}`}><span>{f.name}</span><small>{(f.size / 1024).toFixed(0)}KB</small><button type="button" className="icon-button" aria-label={`${f.name} 빼기`} onClick={() => setFiles(files.filter((_, k) => k !== i))}><X size={14}/></button></li>)}</ul>}
    {error && <div className="form-error" role="alert"><Info size={16}/>{error}</div>}
    <button type="button" className="primary-button full-width" disabled={busy} onClick={convert}>{busy ? (isCapture ? '캡처를 읽는 중… (계좌가 많으면 1분쯤)' : '파일을 읽는 중…') : '표로 바꾸기'}<ArrowRight size={16}/></button>
    <p className="form-help">{isCapture ? '사진은 이 컴퓨터에만 저장되고 Claude 비전이 표로 옮겨요. 숫자는 계산하지 않고 보이는 값만 옮기며, 어느 계좌인지는 다음 화면에서 확인해요.' : '첫 줄 위에 제목이 있어도 돼요. 숫자의 쉼표·원 표기는 알아서 떼요. 어느 계좌인지는 다음 화면에서 골라요.'}</p>
  </div>
}

type AccountSuggestion = { label: string; owner: 'me' | 'partner'; broker: string; account_type: string }
function NewAccount({ initial, onCancel, onCreated }: { initial: AccountSuggestion; onCancel?: () => void; onCreated: (id: string) => void | Promise<void> }) {
  // 확인 표(form) 안에 들어가므로 form을 겹치지 않는다 — 겹치면 버튼이 바깥 폼을 제출한다
  const [value, setValue] = useState<AccountSuggestion>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (patch: Partial<AccountSuggestion>) => setValue(v => ({ ...v, ...patch }))
  async function submit() {
    if (!value.label.trim()) { setError('계좌 이름을 넣어 주세요.'); return }
    setBusy(true); setError('')
    try {
      const created = await api<RegisterAccount>('/register/accounts', 'POST', { label: value.label.trim(), owner: value.owner, broker: value.broker, account_type: value.account_type })
      await onCreated(created.id)
    } catch (e) { setError(e instanceof Error ? e.message : '계좌를 추가하지 못했어요.') } finally { setBusy(false) }
  }
  return <div className="new-account" role="group" aria-label="새 계좌로 추가"><strong>새 계좌로 추가</strong><div className="form-grid"><label className="form-label">계좌 이름<input name="label" value={value.label} onChange={e => set({ label: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }} placeholder="예: 미래에셋 연금저축(신)" maxLength={60} required/></label><label className="form-label">누구의 계좌<select name="owner" value={value.owner} onChange={e => set({ owner: e.target.value as 'me' | 'partner' })}><option value="me">나</option><option value="partner">배우자</option></select></label><label className="form-label">증권사<select name="broker" value={value.broker} onChange={e => set({ broker: e.target.value })}>{BROKERS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label className="form-label">계좌 종류<select name="account_type" value={value.account_type} onChange={e => set({ account_type: e.target.value })}>{TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label></div>{error && <div className="form-error" role="alert"><Info size={16}/>{error}</div>}<div className="button-row">{onCancel && <button type="button" className="secondary-button" onClick={onCancel}>취소</button>}<button type="button" className="primary-button" disabled={busy} onClick={submit}>{busy ? '추가 중…' : '계좌 추가'}</button></div><p className="form-help">계좌번호는 넣지 않아요. 연금저축·IRP는 노후 주머니, 나머지는 현금 주머니로 들어가요. 리밸런싱 묶음·전략은 설정에서 정해요.</p></div>
}
