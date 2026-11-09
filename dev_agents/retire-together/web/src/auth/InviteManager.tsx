import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../local-data'

type Invite = { id: string; email: string; status: string; expires_at: number; cleanup: string; residual_access: boolean }
const labels: Record<string, string> = { pending: '수락 대기', joining: '공유 확인 중', accepted: '합류 완료', expired: '만료', cancelled: '취소됨', revoked: '접근 해제됨' }
export default function InviteManager() {
  const [items, setItems] = useState<Invite[]>([])
  const [email, setEmail] = useState('')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState<Invite | null>(null)
  const linkInput = useRef<HTMLInputElement>(null)
  async function refresh() { setItems((await api<{ invitations: Invite[] }>('/auth/invitations')).invitations) }
  useEffect(() => { void refresh().catch(e => setError(e.message)) }, [])
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await action(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : '초대 상태를 확인하지 못했어요.') } finally { setBusy(false) } }
  function issue(event: FormEvent) { event.preventDefault(); void run(async () => { const r = await api<{ url: string }>('/auth/invitations', 'POST', { email }); setLink(r.url); setNotice('초대 링크를 만들었어요. 배우자에게 직접 전달해 주세요.'); setEmail('') }) }
  async function stop(item: Invite) {
    const result = await api<{ detail: string }>('/auth/invitations/' + item.id + (item.status === 'accepted' ? '/revoke' : ''), item.status === 'accepted' ? 'POST' : 'DELETE')
    setNotice(result.detail); setConfirm(null); setLink('')
  }
  return <section className="share-section" aria-label="배우자 초대 관리"><h3>배우자 초대</h3><p>초대받은 이메일로 본인 확인 후 합류해요. 초대는 48시간 동안 유효합니다.</p>
    <form onSubmit={issue} className="share-form"><label>배우자 이메일<input type="email" autoComplete="email" required maxLength={320} value={email} onChange={e => setEmail(e.target.value)}/></label><button className="primary-button" disabled={busy}>초대 링크 만들기</button></form>
    {link && <div className="share-copy"><label>전달할 초대 링크<input ref={linkInput} readOnly value={link} onFocus={e => e.target.select()}/></label><button className="secondary-button" onClick={async () => { try { await navigator.clipboard.writeText(link); setNotice('초대 링크를 복사했어요.') } catch { linkInput.current?.focus(); linkInput.current?.select(); setNotice('링크를 선택했어요. 복사해서 전달해 주세요.') } }}>링크 복사</button></div>}
    {items.map(item => <article className="share-invite-row" key={item.id}><strong>{item.email}</strong><span>{labels[item.status] ?? item.status}</span><small>유효 기한 {new Date(item.expires_at * 1000).toLocaleString('ko-KR')}</small>
      {['pending', 'joining', 'accepted'].includes(item.status) && <button className="secondary-button" disabled={busy} onClick={() => setConfirm(item)}>{item.status === 'accepted' ? '배우자 접근 해제' : '초대 취소'}</button>}
      {(item.residual_access || !['none', 'done'].includes(item.cleanup)) && <p>앱 접근 상태와 별도로 Google 공유 정리가 필요해요. 시트의 공유 설정을 확인해 주세요.</p>}
      {['expired', 'cancelled', 'revoked'].includes(item.status) && item.cleanup !== 'done' && <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { const r = await api<{ detail: string }>('/auth/invitations/' + item.id, 'DELETE'); setNotice(r.detail) })}>공유 정리 다시 확인</button>}
    </article>)}
    {confirm && <div className="share-confirm" role="group" aria-label="접근 변경 확인"><p>{confirm.email}의 {confirm.status === 'accepted' ? '앱 접근과 앱이 만든 시트 공유를 해제할까요? 다른 경로의 Google 공유는 남을 수 있어요.' : '초대를 취소할까요?'}</p><button className="danger-button" disabled={busy} onClick={() => void run(() => stop(confirm))}>확인하고 진행</button><button className="secondary-button" disabled={busy} onClick={() => setConfirm(null)}>돌아가기</button></div>}
    <button className="text-link" disabled={busy} onClick={() => void run(async () => {})}>초대 상태 다시 확인</button>
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <p className="shared-access-note">시트 편집자는 Google에서 전체 자료를 편집할 수 있어요. 앱 안의 개인별 편집 허용과는 별개입니다.</p>
  </section>
}
