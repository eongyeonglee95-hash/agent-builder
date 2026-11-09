import { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../local-data'
import { useAuth } from './AuthGate'
import { chooseSheet, type PickerCredentials } from './picker'
import InviteManager from './InviteManager'
import SharedDataPanel from './SharedDataPanel'
import './shared-sheet-access.css'

export type AccessStatus = {
  connected: boolean; active: boolean; health: string; detail?: string; data_started?: boolean
  spreadsheet: { spreadsheet_id: string | null; url: string | null; ready: boolean } | null
}
const callbackErrors: Record<string, string> = {
  cancelled: 'Google 접근 동의를 취소했어요. 준비되면 다시 연결해 주세요.',
  owner: '현재 로그인한 사람의 Google 계정으로 동의해 주세요. 오너의 Google 계정과 배우자 계정은 서로 달라요.',
  expired: '로그인이 만료됐어요. 다시 로그인한 뒤 시트 연결을 시작해 주세요.',
  failed: '시트 접근 동의를 확인하지 못했어요. 아래 버튼으로 다시 시작해 주세요.',
}
export default function SharedSheetAccess({ onChanged = () => {}, initialTab = 'file' }: { onChanged?: () => void; initialTab?: string }) {
  const { session } = useAuth()
  const owner = session?.role === 'owner'
  const [status, setStatus] = useState<AccessStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [disconnect, setDisconnect] = useState(false)
  const [callbackError, setCallbackError] = useState(() => callbackErrors[new URL(location.href).searchParams.get('sheet_connection') ?? ''] ?? '')
  const [tab, setTab] = useState(initialTab)
  const refresh = useCallback(async (signal?: AbortSignal) => { const next = await api<AccessStatus>('/google/shared/status', 'GET', undefined, signal); if (!signal?.aborted) setStatus(next) }, [])
  useEffect(() => {
    const url = new URL(location.href); url.searchParams.delete('sheet_connection'); history.replaceState(null, '', url.pathname + url.search + url.hash)
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000)
    void refresh(controller.signal).catch(e => { if (controller.signal.reason !== 'unmount') setError(controller.signal.aborted ? '연결 확인이 늦어지고 있어요. 다시 확인해 주세요.' : e.message) }).finally(() => { clearTimeout(timer); if (controller.signal.reason !== 'unmount') setLoading(false) })
    return () => { controller.abort('unmount'); clearTimeout(timer) }
  }, [refresh])
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); setCallbackError(''); try { await action() } catch (e) { setError(e instanceof Error ? e.message : '연결 상태를 확인하지 못했어요.') } finally { setBusy(false) } }
  async function connect() { const result = await api<{ authorization_url: string }>('/google/shared/connect', 'POST'); location.assign(result.authorization_url) }
  async function create() { await api('/google/shared/spreadsheet', 'POST'); await refresh(); onChanged(); setNotice('공통 시트를 연결했어요. 우리 자료에서 이전할 내용을 대조해 주세요.') }
  async function select() {
    const credentials = await api<PickerCredentials>('/google/shared/picker', 'POST')
    if (status?.spreadsheet?.spreadsheet_id) credentials.spreadsheet_id = status.spreadsheet.spreadsheet_id
    const id = await chooseSheet(credentials)
    if (!id) { setNotice('파일 선택을 취소했어요. 기존 연결과 자료는 그대로예요.'); return }
    if (owner) await api('/google/shared/spreadsheet', 'PUT', { spreadsheet_id: id })
    await refresh(); onChanged(); setNotice('공통 시트 접근을 다시 확인했어요.')
  }
  return <section className="shared-sheet-access" aria-label="Google 시트 접근 권한">
    <p>{owner ? '고정 오너' : '배우자'} · {session?.email}</p>
    <div className="share-tabs" role="group" aria-label="공유 설정 메뉴">{[['file', '공통 시트'], ['data', '우리 자료'], ...(owner ? [['invite', '배우자 초대']] : [])].map(([id, label]) => <button key={id} className="secondary-button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {loading ? <p role="status">시트 접근 상태를 확인하고 있어요…</p> : <>
      {tab === 'file' && <>
        {status?.connected ? <div className="shared-access-success" role="status"><Check size={20}/><strong>Google 파일 접근 동의가 완료됐어요.</strong></div> : <><h3>Google에서 파일 접근을 허용해 주세요.</h3><p>앱에서 만들거나 직접 선택한 시트에 접근합니다. 현재 로그인한 본인 계정으로 동의해 주세요.</p></>}
        {status?.spreadsheet?.url && <p><a href={status.spreadsheet.url} target="_blank" rel="noreferrer">연결된 Google 시트 열기 <ExternalLink size={15}/></a></p>}
        {status?.active && <p>같은 공통 시트가 연결되어 있어요. 다음 로그인에도 이 파일을 불러와요.</p>}
        {status?.detail && <p role="alert" className="form-error">{status.detail}</p>}
        {status && (!status.connected || status.health === 'attention' || callbackError) && <button className="primary-button" disabled={busy} onClick={() => void run(connect)}>Google에서 접근 허용<ExternalLink size={16}/></button>}
        {status?.connected && <>
          {owner && !status.spreadsheet && <><p>본인 소유의 기존 양식 시트를 선택하거나 새 공통 시트를 만들어 주세요. 연결 후 기존 자료를 대조할 수 있어요.</p><button className="primary-button" disabled={busy} onClick={() => void run(create)}>새 공통 시트 만들기</button></>}
          {owner && status.spreadsheet && !status.spreadsheet.ready && <><p>진행 중인 파일 설정이 있어요. 같은 요청을 이어서 확인하며 새 파일을 중복 생성하지 않습니다.</p><button className="primary-button" disabled={busy} onClick={() => void run(create)}>진행 중인 파일 설정 이어가기</button></>}
          {(!status.spreadsheet || status.spreadsheet.spreadsheet_id) && <button className="secondary-button" disabled={busy} onClick={() => void run(select)}>{status.spreadsheet ? '같은 공통 시트 접근 승인' : 'Google에서 기존 시트 선택'}</button>}
          <button className="text-link" disabled={busy} onClick={() => setDisconnect(true)}>내 파일 접근 동의 해제</button>
          <button className="text-link" disabled={busy} onClick={() => void run(connect)}>접근 권한 다시 동의</button>
        </>}
        {disconnect && <div className="share-confirm"><p>내 파일 접근 동의만 해제할까요? 로그인·오너·연결된 파일과 자료는 유지됩니다. 로컬 장부로 전환하지 않아요.</p><button className="danger-button" disabled={busy} onClick={() => void run(async () => { await api('/google/shared/connection', 'DELETE'); setDisconnect(false); await refresh(); onChanged(); setNotice('내 파일 접근 동의를 해제했어요. 다시 동의하면 같은 파일을 사용해요.') })}>동의 해제 확인</button><button className="secondary-button" disabled={busy} onClick={() => setDisconnect(false)}>취소</button></div>}
        <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await refresh(); onChanged() })}><RefreshCw size={15}/>연결 상태 다시 확인</button>
        <p className="shared-access-note">오너와 공통 파일은 자동으로 바뀌지 않아요. 삭제·권한 오류에서는 기존 파일을 복구한 뒤 다시 확인해 주세요.</p>
      </>}
      {tab !== 'file' && !status?.active && <p>공통 시트의 연결 상태를 먼저 확인해 주세요.<button className="text-link" onClick={() => setTab('file')}>공통 시트 확인</button></p>}
      {tab === 'data' && status?.active && <SharedDataPanel started={!!status.data_started} onChanged={() => { void refresh(); onChanged() }}/>}
      {tab === 'invite' && status?.active && owner && <InviteManager/>}
    </>}
    {(error || callbackError) && <p role="alert" className="form-error">{error || callbackError}</p>}{notice && <p role="status">{notice}</p>}
    {error && !status && <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await refresh(); setLoading(false) })}>연결 상태 다시 확인</button>}
  </section>
}
