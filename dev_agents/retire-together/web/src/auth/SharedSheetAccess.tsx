import { Button } from '../components/ui/button'
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Check, ExternalLink, RefreshCw } from 'lucide-react'
import { api } from '../local-data'
import { useAuth } from './AuthGate'
import { chooseSheet, type PickerCredentials } from './picker'
import SheetVersions from './SheetVersions'
import InviteManager from './InviteManager'
import SharedDataPanel, { type MigrationPreview } from './SharedDataPanel'
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
  const [preview, setPreview] = useState<MigrationPreview | null>(null)
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
  async function create() { await api('/google/shared/spreadsheet', 'POST'); await refresh(); onChanged() }
  function openTab(next: string) { setPreview(null); setTab(next); setNotice(''); setError('') }
  async function review() {
    const next = await api<MigrationPreview>('/shared-data/migration/preview', 'POST')
    setPreview(next); setTab('data')
  }
  async function select() {
    const credentials = await api<PickerCredentials>('/google/shared/picker', 'POST')
    if (status?.spreadsheet?.spreadsheet_id) credentials.spreadsheet_id = status.spreadsheet.spreadsheet_id
    const id = await chooseSheet(credentials)
    if (!id) { setNotice('파일 선택을 취소했어요. 기존 연결과 자료는 그대로예요.'); return }
    if (owner) await api('/google/shared/spreadsheet', 'PUT', { spreadsheet_id: id })
    await refresh(); onChanged(); setNotice('공통 시트 접근을 다시 확인했어요.')
  }
  const step = !status?.connected ? 0 : !status.active ? 1 : 2
  const linked = !!status?.spreadsheet?.spreadsheet_id
  return <section className="shared-sheet-access" aria-label="Google 시트 접근 권한" aria-busy={loading || busy}>
    <p className="share-account">{session?.email}</p>
    {status?.active && <div className="share-tabs" role="group" aria-label="공유 설정 메뉴">{[['file', '공통 시트'], ['data', '우리 자료'], ...(owner && status.data_started ? [['versions', '시트 버전']] : []), ...(owner ? [['invite', '배우자 초대']] : [])].map(([id, label]) => <Button variant="outline" key={id} disabled={busy} className="secondary-button" aria-pressed={tab === id} onClick={() => openTab(id)}>{label}</Button>)}</div>}
    {loading ? <p role="status">시트 접근 상태를 확인하고 있어요…</p> : <>
      {tab === 'file' && status && <>
        {!status.data_started && <ol className="share-steps" aria-label="자료 연결 순서">{['Google 연결', '시트 선택', '내 자료 확인'].map((label, index) => <li key={label} className={index < step ? 'is-done' : index === step ? 'is-current' : ''} aria-current={index === step ? 'step' : undefined}><span aria-hidden="true">{index < step ? <Check size={14}/> : index + 1}</span>{label}</li>)}</ol>}
        <div className="share-next-step">
          {!status.connected ? <>
            <h3>{linked ? '사용하던 시트를 다시 연결해 주세요' : '구글 시트로 우리 자산을 관리해요'}</h3>
            <p>{linked ? '연결된 파일은 기억하고 있어요. Google에서 접근만 다시 허용하면 같은 파일을 사용해요.' : 'Google 로그인은 완료됐어요. 가계 노트를 저장할 시트에 접근하도록 한 번 더 허용해 주세요.'}</p>
            <Button variant="default" className="primary-button" disabled={busy} onClick={() => void run(connect)}>Google에서 접근 허용<ArrowRight size={16}/></Button>
          </> : status.active ? <>
            <span className="shared-access-success" role="status"><Check size={18}/>{status.data_started ? '연결된 시트를 찾았어요' : '시트 연결 완료'}</span>
            <h3>{status.data_started ? '내 자료를 불러올게요' : '이제, 내 자료를 확인해요'}</h3>
            <p>{status.data_started ? '다시 연결할 필요 없이 같은 시트의 자료를 읽어요. 다음 로그인에도 자동으로 불러와요.' : owner ? '파일 연결은 끝났어요. 이 컴퓨터에 저장한 자료와 시트의 내용을 먼저 확인해 주세요.' : '오너가 자료를 옮기면 이 시트의 자료를 함께 볼 수 있어요.'}</p>
            <Button variant="default" className="primary-button" disabled={busy} onClick={() => status.data_started || !owner ? openTab('data') : void run(review)}>{busy ? '자료 확인 중…' : status.data_started ? '내 자료 불러오기' : owner ? '이 컴퓨터 자료 확인' : '우리 자료 확인'}<ArrowRight size={16}/></Button>
            {!status.data_started && owner && <p className="share-action-note">지금은 내용만 확인해요. 자료가 자동으로 옮겨지지는 않아요.</p>}
          </> : status.health === 'attention' ? <>
            <h3>사용하던 시트의 연결을 확인해 주세요</h3><p>기존 파일은 기억하고 있어요. 아래 안내를 확인한 뒤 다시 연결해 주세요.</p>
            <Button variant="default" className="primary-button" disabled={busy} onClick={() => void run(async () => { await refresh(); onChanged() })}><RefreshCw size={16}/>연결 상태 다시 확인</Button>
            <button className="text-link" disabled={busy} onClick={() => void run(connect)}>Google에서 접근 허용</button>
          </> : owner && !status.spreadsheet ? <>
            <p className="shared-access-success" role="status"><Check size={18}/>Google 파일 접근 동의가 완료됐어요.</p><h3>어떤 시트를 사용할까요?</h3>
            <p>처음이라면 새 가계 노트를 만드세요. 둘이서은퇴에서 사용하던 시트가 있으면 불러올 수 있어요.</p>
            <Button variant="default" className="primary-button" disabled={busy} onClick={() => void run(create)}>새 가계 노트 만들기<ArrowRight size={16}/></Button>
            <Button variant="outline" className="secondary-button" disabled={busy} onClick={() => void run(select)}>사용하던 시트 불러오기</Button>
          </> : owner && status.spreadsheet && !status.spreadsheet.ready ? <>
            <h3>진행하던 연결을 마칠게요</h3><p>이전에 시작한 파일 설정을 이어서 확인해요. 새 파일을 또 만들지 않아요.</p>
            <Button variant="default" className="primary-button" disabled={busy} onClick={() => void run(create)}>진행 중인 파일 설정 이어가기<ArrowRight size={16}/></Button>
          </> : <><h3>공통 시트를 준비하고 있어요</h3><p>오너가 파일 연결을 마치면 같은 자료를 불러올 수 있어요.</p></>}
          {status.detail && <p role="alert" className="form-error">{status.detail}</p>}
        </div>
        {status.spreadsheet?.url && <a className="share-file-link" href={status.spreadsheet.url} target="_blank" rel="noreferrer">연결된 Google 시트 열기 <ExternalLink size={15}/></a>}
        <details className="share-connection-tools"><summary>연결 관리</summary>
          <p>{owner ? '오너' : '배우자'} 계정 · 파일을 바꾸지 않고 연결 상태를 관리해요.</p>
          {status.connected && <>
            {linked && <Button variant="outline" className="secondary-button" disabled={busy} onClick={() => void run(select)}>같은 공통 시트 접근 승인</Button>}
            <button className="text-link" disabled={busy} onClick={() => void run(connect)}>접근 권한 다시 동의</button>
            <button className="text-link" disabled={busy} onClick={() => setDisconnect(true)}>내 파일 접근 동의 해제</button>
          </>}
          {disconnect && <div className="share-confirm"><p>내 파일 접근 동의만 해제할까요? 로그인·연결된 파일과 자료는 그대로 남아요.</p><Button variant="destructive" className="danger-button" disabled={busy} onClick={() => void run(async () => { await api('/google/shared/connection', 'DELETE'); setDisconnect(false); await refresh(); onChanged(); setNotice('내 파일 접근 동의를 해제했어요. 다시 동의하면 같은 파일을 사용해요.') })}>동의 해제 확인</Button><Button variant="outline" className="secondary-button" disabled={busy} onClick={() => setDisconnect(false)}>취소</Button></div>}
          {status.health !== 'attention' && <Button variant="outline" className="secondary-button" disabled={busy} onClick={() => void run(async () => { await refresh(); onChanged() })}><RefreshCw size={15}/>연결 상태 다시 확인</Button>}
        </details>
      </>}
      {tab !== 'file' && !status?.active && <p>공통 시트의 연결 상태를 먼저 확인해 주세요.<button className="text-link" onClick={() => setTab('file')}>공통 시트 확인</button></p>}
      {tab === 'data' && status?.active && <SharedDataPanel started={!!status.data_started} initialPreview={preview} onChanged={() => { void refresh(); onChanged() }}/>}
      {tab === 'versions' && status?.active && status.data_started && owner && <SheetVersions onChanged={() => { void refresh(); onChanged() }}/>}
      {tab === 'invite' && status?.active && owner && <InviteManager/>}
    </>}
    {(error || callbackError) && <p role="alert" className="form-error">{error || callbackError}</p>}{notice && <p role="status">{notice}</p>}
    {error && !status && <Button variant="outline" className="secondary-button" disabled={busy} onClick={() => void run(async () => { await refresh(); setLoading(false) })}>연결 상태 다시 확인</Button>}
  </section>
}
