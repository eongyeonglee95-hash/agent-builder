import { useEffect, useState, type FormEvent } from 'react'
import { Brand } from '../components'
import { chooseSheet, type PickerCredentials } from './picker'
import './shared-sheet-access.css'

type Join = { csrf_token: string; membership_active: false; detail: string; spreadsheet: { url: string }; invitation: { email: string } }
export function invitationRoute() { return location.hash.startsWith('#invite') || /[?&]invitation=(pending|failed|cancelled|target|expired)/.test(location.search) }
export default function InvitationEntry() {
  const [code, setCode] = useState(() => location.hash.startsWith('#invite=') ? location.hash.slice(8) : '')
  const [join, setJoin] = useState<Join | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(() => ({ failed: '초대 본인 확인을 마치지 못했어요. 유효한 초대 링크를 다시 열어 주세요.', cancelled: 'Google 동의를 취소했어요. 초대 링크를 다시 열어 이어갈 수 있어요.', target: '초대받은 이메일의 Google 계정으로 다시 시작해 주세요.', expired: '초대가 만료되었거나 사용할 수 없어요. 오너에게 새 초대를 요청해 주세요.' }[new URL(location.href).searchParams.get('invitation') ?? ''] ?? ''))
  useEffect(() => {
    const url = new URL(location.href); url.searchParams.delete('invitation'); url.hash = 'invite'
    history.replaceState(null, '', url.pathname + url.search + url.hash)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    fetch('/api/auth/invitations/join', { signal: controller.signal, cache: 'no-store' }).then(async r => {
      if (r.ok) setJoin(await r.json())
      else if (r.status !== 401) { const body = await r.json(); setError(body.detail ?? '초대 상태를 다시 확인해 주세요.') }
    }).catch(() => { if (controller.signal.reason !== 'unmount') setError('초대 상태를 불러오지 못했어요. 연결을 확인하고 새로고침해 주세요.') }).finally(() => { clearTimeout(timer); if (controller.signal.reason !== 'unmount') setLoading(false) })
    return () => { controller.abort('unmount'); clearTimeout(timer) }
  }, [])
  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch('/api/auth/invitations/' + path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Retire-Invite': '1', ...(join ? { 'X-Retire-CSRF': join.csrf_token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const result = await response.json()
    if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '초대 코드를 확인해 주세요.')
    return result
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : '초대를 확인하지 못했어요.') } finally { setBusy(false) }
  }
  // Change the document URL as well as the fragment so AuthGate reads the new session.
  async function resume() { await request('resume'); location.replace('/?invitation=ready#home') }
  function accept(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      const value = code.trim().replace(/^.*#invite=/, '')
      if (!/^[\w-]{43}$/.test(value)) throw new Error('초대 링크 또는 43자리 초대 코드를 확인해 주세요.')
      const result = await request<{ authorization_url: string }>('accept', { code: value })
      setCode(''); location.assign(result.authorization_url)
    })
  }
  return <main className="share-invitation-page"><Brand/><section className="share-invitation-card shared-sheet-access" aria-labelledby="invite-title">
    <h1 id="invite-title">우리 집 초대 수락</h1>
    <p>초대받은 본인의 Google 계정으로 확인하면 같은 공통 시트에 합류해요.</p>
    {loading ? <p role="status">초대 상태를 확인하고 있어요…</p> : join ? <>
      <p>{join.invitation.email} · 본인 확인 완료</p><p>아직 가입이 끝나지 않았어요. 공유와 파일 접근을 확인해 주세요.</p>
      <a href={join.spreadsheet.url} target="_blank" rel="noreferrer">초대에 연결된 시트 확인</a>
      <button className="primary-button" disabled={busy} onClick={() => void run(resume)}>공유 확인 후 합류</button>
      <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { const credentials = await request<PickerCredentials>('picker'); const id = await chooseSheet(credentials); if (id) await resume(); else setNotice('파일 선택을 취소했어요. 같은 초대를 이어갈 수 있어요.') })}>공통 시트 접근 승인</button>
    </> : <form onSubmit={accept} className="share-form"><label>초대 링크 또는 코드<input autoComplete="off" value={code} onChange={e => setCode(e.target.value)} required maxLength={500}/></label><button className="primary-button" disabled={busy}>{busy ? '확인 중…' : 'Google로 초대 수락'}</button></form>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <a href="/#home">로그인 화면으로 돌아가기</a><p className="shared-access-note">오너는 변경되지 않아요. 초대 수락과 시트 접근 확인이 모두 끝나야 가계 노트가 열립니다.</p>
  </section></main>
}
