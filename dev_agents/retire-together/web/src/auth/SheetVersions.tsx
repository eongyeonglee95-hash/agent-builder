import { useEffect, useRef, useState } from 'react'
import { api } from '../local-data'
import { money, type Snapshot } from '../model'
import { DataTotals } from './SharedDataPanel'
import { type DataSummary, type SharedState } from './shared-data-types'
import { chooseSheet, type PickerCredentials } from './picker'

type Version = { spreadsheet_id: string; title: string; url: string; revision: string; summary: DataSummary; state: SharedState; snapshot: Snapshot }
type Versions = { current: Version; versions: { spreadsheet_id: string; title: string; created_at: string }[] }
export default function SheetVersions({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<Versions | null>(null)
  const [view, setView] = useState<Version | null>(null)
  const [title, setTitle] = useState(`우리 자산 ${new Date().toLocaleDateString('en-CA')}`)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef<{ key: string; id: string } | null>(null)
  async function refresh() { const next = await api<Versions>('/shared-data/versions'); setData(next); return next }
  useEffect(() => { void refresh().catch(e => setError(e.message)) }, [])
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await action() } catch (e) { setError(e instanceof Error ? e.message : '파일을 확인하지 못했어요.') } finally { setBusy(false) } }
  async function preview(id: string) { setView(null); setConfirmed(false); setView(await api<Version>('/shared-data/versions/preview', 'POST', { spreadsheet_id: id })) }
  async function pick() {
    const credentials = await api<PickerCredentials>('/google/shared/picker', 'POST')
    // This picker is explicitly for a different version, not reauthorization.
    const id = await chooseSheet({ ...credentials, spreadsheet_id: undefined })
    if (id) await preview(id)
  }
  async function copy() {
    if (!data) return
    const body = { current_spreadsheet_id: data.current.spreadsheet_id, current_revision: data.current.revision, title: title.trim() }
    const key = JSON.stringify(body)
    if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() }
    const next = await api<Version>('/shared-data/versions/copy', 'POST', { ...body, operation_id: pending.current.id })
    pending.current = null; await refresh(); setView(next); setConfirmed(false); setNotice('별도 파일로 보관했어요. 현재 저장 위치는 그대로예요.')
  }
  return <section className="share-section" aria-label="시트 버전 관리"><h3>현재 관리 시트와 이전 버전</h3>
    {!data && !error && <p role="status">시트 목록을 불러오는 중…</p>}
    {data && <>
      <p>현재 관리 시트: <strong>{data.current.title}</strong></p>
      <div className="button-row"><a className="secondary-button" href={data.current.url} target="_blank" rel="noreferrer">구글 시트 열기</a><a className="secondary-button" href={`https://docs.google.com/spreadsheets/d/${data.current.spreadsheet_id}/export?format=xlsx`} target="_blank" rel="noreferrer">엑셀 다운로드</a></div>
      <p>앱에서 저장한 내용은 시트의 ‘우리 자산’ 표에서도 볼 수 있어요. 자산 수정은 앱에서 해 주세요.</p>
      <form className="share-form" onSubmit={e => { e.preventDefault(); void run(copy) }}><label>보관할 버전 이름<input required maxLength={100} value={title} disabled={busy} onChange={e => setTitle(e.target.value)}/></label><button className="secondary-button" disabled={busy || !title.trim()}>현재 자료를 새 버전으로 보관</button></form>
      <div className="share-form"><label>저장한 버전<select value={view?.spreadsheet_id ?? ''} disabled={busy} onChange={e => { const id = e.target.value; if (id) void run(() => preview(id)); else setView(null) }}><option value="">버전 선택</option>{data.versions.map(v => <option key={v.spreadsheet_id} value={v.spreadsheet_id}>{v.title}{v.spreadsheet_id === data.current.spreadsheet_id ? ' · 현재' : ''}</option>)}</select></label><button className="secondary-button" disabled={busy} onClick={() => void run(pick)}>다른 시트 불러오기</button></div>
      <p>둘이서은퇴에서 보관하거나 복사한 같은 가구의 파일을 불러와요. 선택만으로 저장 위치가 바뀌지는 않아요.</p>
      {view && <article className="share-preview"><h4>{view.title} · 읽기 전용</h4><DataTotals summary={view.summary} state={view.state}/>
        <div className="table-scroll"><table><caption>이 버전의 우리 자산</caption><thead><tr><th>자산</th><th>기준일</th><th>금액</th></tr></thead><tbody>{[...view.snapshot.assets, ...view.snapshot.debts].map(a => <tr key={a.id}><td>{a.name}</td><td>{a.as_of}</td><td>{money(a.amount)}</td></tr>)}</tbody></table></div>
        <a className="text-link" href={`https://docs.google.com/spreadsheets/d/${view.spreadsheet_id}/export?format=xlsx`} target="_blank" rel="noreferrer">이 버전 엑셀 다운로드</a>
        {view.spreadsheet_id !== data.current.spreadsheet_id && <><p>현재 관리 시트로 지정하면 앞으로 이 파일에서 불러오고 저장해요. 기존 파일은 그대로 보관해요.</p><label className="share-choice"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/>이 파일을 앞으로의 저장 위치로 사용할게요</label><button className="primary-button" disabled={busy || !confirmed} onClick={() => void run(async () => {
          await api('/shared-data/versions/activate', 'POST', { spreadsheet_id: view.spreadsheet_id, current_spreadsheet_id: data.current.spreadsheet_id, current_revision: data.current.revision, target_revision: view.revision })
          setView(null); setConfirmed(false); await refresh(); onChanged(); window.dispatchEvent(new Event('retire:holdings-changed')); setNotice('현재 관리 시트를 변경했어요. 새 파일의 자료를 불러옵니다.'); location.reload()
        })}>현재 관리 시트로 지정</button></>}
      </article>}
      <button className="text-link" disabled={busy} onClick={() => void run(async () => { await refresh(); setView(null); setConfirmed(false) })}>목록과 현재 자료 새로고침</button>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>
}
