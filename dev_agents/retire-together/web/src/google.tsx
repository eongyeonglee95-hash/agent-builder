import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, ExternalLink, Info, RefreshCw, Sheet, Unplug } from 'lucide-react'
import { api } from './local-data'

// SHEET-01 — 구글 시트 연결. 세 단계: OAuth 클라이언트 JSON 저장 → 구글 로그인 → 시트 만들기/지정.
// 연결되면 자산 장부의 원천이 시트가 된다. 앱은 시트를 읽고, 등록·수정·삭제는 시트에 쓴다.

export type SheetStatus = { client_secret: boolean; connected: boolean; connecting: boolean; connect_error: string | null; spreadsheet: { spreadsheet_id: string; url: string; title: string } | null; active: boolean; disabled: boolean; asset_rows?: number | null; health?: string }

export function useSheetStatus(poll = false) {
  const [status, setStatus] = useState<SheetStatus | null>(null)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try { setStatus(await api<SheetStatus>('/google/status')); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : '연결 상태를 확인하지 못했어요.') }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    if (!poll || !status?.connecting) return
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [poll, status?.connecting, refresh])
  return { status, error, refresh, setStatus }
}

export function SheetBadge({ onClick }: { onClick: () => void }) {
  const { status } = useSheetStatus()
  if (!status || status.disabled) return null
  return <button className={`sheet-badge ${status.active ? 'on' : ''}`} onClick={onClick} aria-label="구글 시트 연결 설정"><Sheet size={13}/>{status.active ? '구글 시트' : '로컬 저장'}</button>
}

export function GoogleSheetPanel({ onChanged }: { onChanged: () => void }) {
  const { status, error, refresh, setStatus } = useSheetStatus(true)
  const [busy, setBusy] = useState('')
  const [formError, setFormError] = useState('')
  const [secret, setSecret] = useState('')
  const [url, setUrl] = useState('')
  const [notice, setNotice] = useState('')

  async function run(label: string, fn: () => Promise<SheetStatus & { migrated?: number }>) {
    setBusy(label); setFormError(''); setNotice('')
    try {
      const next = await fn()
      setStatus(next)
      if (next.migrated) setNotice(`로컬에 있던 자산 ${next.migrated}건을 시트로 옮겼어요.`)
      onChanged()
    } catch (e) { setFormError(e instanceof Error ? e.message : '처리하지 못했어요.') } finally { setBusy('') }
  }
  if (error) return <div className="form-error" role="alert"><Info size={16}/>{error}</div>
  if (!status) return <div className="loading-strip" role="status">연결 상태를 확인하는 중…</div>
  if (status.disabled) return <div className="info-note"><Info size={18}/><p>이 서버는 시트 연결이 꺼져 있어요 (테스트 모드).</p></div>
  const step = !status.client_secret ? 1 : !status.connected ? 2 : !status.spreadsheet ? 3 : 4
  return <div className="sheet-panel">
    <p className="form-intro">자산 데이터는 두 분의 구글 시트에 남아요.<br/>앱은 시트를 읽어 계산하고, 등록한 내용은 시트에 써요.</p>
    <ol className="step-list">
      <li className={step > 1 ? 'done' : step === 1 ? 'now' : ''}><span className="step-mark">{step > 1 ? <Check size={13}/> : '1'}</span><div><strong>구글 API 열쇠 넣기</strong>{step === 1 ? <form onSubmit={(e: FormEvent) => { e.preventDefault(); run('secret', () => api('/google/client-secret', 'PUT', { json_text: secret })) }}><small>구글 클라우드에서 만든 OAuth 클라이언트(데스크톱 앱) JSON 내용을 붙여 넣어요. 만드는 순서는 <code>docs/GOOGLE_SHEETS.md</code>에 있어요. 한 번만 하면 돼요.</small><textarea value={secret} onChange={e => setSecret(e.target.value)} placeholder='{"installed": {"client_id": "...", "client_secret": "..."}}' rows={4} required/><button type="submit" className="secondary-button" disabled={!!busy}>{busy === 'secret' ? '저장 중…' : '열쇠 저장'}</button></form> : <small>저장됨 · 이 컴퓨터의 data/local/google/ 에만 있어요.</small>}</div></li>
      <li className={step > 2 ? 'done' : step === 2 ? 'now' : ''}><span className="step-mark">{step > 2 ? <Check size={13}/> : '2'}</span><div><strong>구글 계정 연결</strong>{step === 2 ? <><small>버튼을 누르면 브라우저에 구글 로그인 창이 열려요. 시트를 둘 계정으로 로그인하고 허용하면 돼요.</small>{status.connecting ? <span className="connecting"><RefreshCw size={14} className="spin"/>구글 창에서 로그인을 기다리는 중…</span> : <button type="button" className="secondary-button" disabled={!!busy} onClick={() => run('connect', () => api('/google/connect', 'POST', {}))}>구글로 연결하기</button>}{status.connect_error && <div className="form-error" role="alert"><Info size={16}/>{status.connect_error}</div>}</> : step > 2 ? <small>연결됨</small> : null}</div></li>
      <li className={step > 3 ? 'done' : step === 3 ? 'now' : ''}><span className="step-mark">{step > 3 ? <Check size={13}/> : '3'}</span><div><strong>시트 고르기</strong>{step === 3 ? <><small>새 시트를 만들면 ‘자산’·‘보유종목’ 탭이 생겨요. 이미 쓰는 시트가 있으면 주소를 붙여 넣어요 (탭은 앱이 만들어요).</small><div className="button-row"><button type="button" className="primary-button" disabled={!!busy} onClick={() => run('create', () => api('/google/spreadsheet', 'POST', { url: null }))}>{busy === 'create' ? '만드는 중…' : '새 시트 만들기'}</button></div><form className="use-sheet" onSubmit={(e: FormEvent) => { e.preventDefault(); run('use', () => api('/google/spreadsheet', 'POST', { url })) }}><input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" required/><button type="submit" className="secondary-button" disabled={!!busy}>{busy === 'use' ? '확인 중…' : '이 시트 쓰기'}</button></form></> : status.spreadsheet ? <small>{status.spreadsheet.title}</small> : null}</div></li>
    </ol>
    {status.active && status.spreadsheet && <div className="sheet-connected"><Sheet size={18}/><div><strong>{status.spreadsheet.title}</strong><small>{status.health === 'ok' ? `자산 ${status.asset_rows ?? 0}건 · 시트에서 직접 고쳐도 앱에 반영돼요.` : status.health}</small></div><a className="secondary-button" href={status.spreadsheet.url} target="_blank" rel="noreferrer">시트 열기 <ExternalLink size={14}/></a></div>}
    {notice && <div className="info-note"><Check size={18}/><p>{notice}</p></div>}
    {formError && <div className="form-error" role="alert"><Info size={16}/>{formError}</div>}
    <div className="button-row sheet-tools"><button type="button" className="text-link" onClick={refresh}><RefreshCw size={14}/>상태 다시 확인</button>{status.connected && <button type="button" className="text-link danger" onClick={() => run('off', () => api('/google/connection', 'DELETE'))}><Unplug size={14}/>연결 끊기</button>}</div>
    <div className="info-note"><Info size={18}/><p>연결을 끊어도 시트는 그대로 남아요. 끊은 뒤에는 이 컴퓨터의 로컬 장부를 써요. 내 정보·배우자 정보는 시트가 아니라 이 컴퓨터에 저장돼요.</p></div>
  </div>
}
