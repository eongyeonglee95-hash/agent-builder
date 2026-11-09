import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from '../local-data'
import { money } from '../model'
import { useAuth } from './AuthGate'
import { kindLabels, memberName, type DataSummary, type SharedData, type SharedRecord, type SharedState } from './shared-data-types'

type Preview = { preview_id: string; local: DataSummary; sheet: DataSummary; proposed: DataSummary; state: SharedState; conflicts: { key: string; local: SharedRecord; sheet: SharedRecord }[] }
type Backups = { revision: string; backups: { id: string; kind: string }[] }
type Recovery = { revision: string; before: SharedState | null; proposed: SharedState | null; before_summary: DataSummary | null; proposed_summary: DataSummary | null }
export function DataTotals({ summary, state }: { summary: DataSummary; state: SharedState }) {
  return <><dl className="share-counts">{Object.entries(summary.counts).filter(([, v]) => v > 0).map(([k, v]) => <div key={k}><dt>{kindLabels[k] ?? k}</dt><dd>{v}건</dd></div>)}</dl><ul className="share-totals">{Object.entries(summary.totals).map(([member, total]) => <li key={member}>{memberName(state, member)} · 자산 {money(total.assets)} / 대출 {money(total.debt)}</li>)}</ul></>
}
function RecordDetail({ record }: { record: SharedRecord }) {
  const labels: Record<string, string> = { name: '이름', account: '계좌', amount: '금액(원)', as_of: '기준일', age: '나이', national_monthly: '국민연금 월액', monthly_need: '월 생활비', retirement_age: '목표 은퇴 나이', target_amount: '목표 금액', price: '가격', qty: '수량', ticker_name: '종목', broker: '금융사', label: '이름', note: '메모', scope: '범위', source: '등록 경로', updated_at: '갱신 시각', account_id: '연결 계좌', pocket: '주머니', assetClass: '자산 분류', buy_value: '매입 금액', candidates: '후보', share_percent: '기준 사람 지분(%)' }
  return <dl className="share-counts">{Object.entries(record.payload).filter(([key]) => key in labels).map(([key, value]) => <div key={key}><dt>{labels[key]}</dt><dd>{Array.isArray(value) ? value.map(v => typeof v === 'object' && v ? String(v.name ?? '') : String(v)).join(', ') : value == null ? '미입력' : typeof value === 'object' ? '등록됨' : String(value)}</dd></div>)}</dl>
}
export default function SharedDataPanel({ started, onChanged }: { started: boolean; onChanged: () => void }) {
  const { session } = useAuth()
  const owner = session?.role === 'owner'
  const [data, setData] = useState<SharedData | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [backups, setBackups] = useState<Backups | null>(null)
  const [recovery, setRecovery] = useState<Recovery | null>(null)
  const [backupId, setBackupId] = useState('')
  const [version, setVersion] = useState<'before' | 'proposed'>('before')
  const [confirmed, setConfirmed] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [permissionChoice, setPermissionChoice] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [edit, setEdit] = useState<SharedRecord | null>(null)
  const pending = useRef<{ fingerprint: string; id: string } | null>(null)
  async function commit<T>(path: string, body: Record<string, unknown>) {
    const fingerprint = JSON.stringify([path, body])
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, id: crypto.randomUUID() }
    const result = await api<T>(path, 'POST', { ...body, operation_id: pending.current.id })
    pending.current = null; return result
  }
  async function refresh() { const next = await api<SharedData>('/shared-data'); setData(next); setEdit(null); return next }
  useEffect(() => { if (started) void refresh().catch(e => setError(e.message)) }, [started])
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await action() } catch (e) { setError(e instanceof Error ? e.message : '자료를 확인하지 못했어요.'); onChanged() } finally { setBusy(false) } }
  function changed(result: SharedData, message: string) { setData(result); setPreview(null); setRecovery(null); setBackups(null); setEdit(null); setConfirmed(false); setNotice(message); onChanged(); window.dispatchEvent(new Event('retire:holdings-changed')) }
  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!edit || !data) return
    const fields = new FormData(event.currentTarget)
    const payload = { ...edit.payload, name: String(fields.get('name')), age: fields.get('age') === '' ? null : Number(fields.get('age')) }
    void run(async () => changed(await commit<SharedData>('/shared-data/save', { expected_revision: data.revision, upsert: [{ ...edit, payload }], delete: [] }), '가족 정보를 저장했어요.'))
  }
  return <section className="share-section" aria-label="공유 자료 관리"><h3>우리 자료</h3>
    {!started && !data && <><p>기존 자료를 먼저 대조해 주세요. 파일 연결만으로 자료를 옮기지는 않아요.</p>{owner ? <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { const result = await api<Preview>('/shared-data/migration/preview', 'POST'); setPreview(result); setReviewed(result.conflicts.length === 0); setChoices({}); setConfirmed(false) })}>이전할 자료 대조</button> : <p>오너가 기존 자료의 이전을 마치면 두 분이 같은 자료를 볼 수 있어요.</p>}</>}
    {preview && <div className="share-preview"><h4>이전 전 대조</h4><p>이전 전 원본을 백업했어요. 원래 파일은 보존하며, 충돌한 항목은 직접 선택해 주세요.</p><details><summary>이 컴퓨터의 원본</summary><DataTotals summary={preview.local} state={preview.state}/></details><details><summary>기존 시트 원본</summary><DataTotals summary={preview.sheet} state={preview.state}/></details><DataTotals summary={preview.proposed} state={preview.state}/>
      {preview.conflicts.map(c => <fieldset key={c.key} disabled={busy}><legend>{kindLabels[c.local.kind]}</legend>{(['local', 'sheet'] as const).map(source => <label className="share-choice" key={source}><input type="radio" name={c.key} value={source} checked={choices[c.key] === source} onChange={() => { setChoices(v => ({ ...v, [c.key]: source })); setConfirmed(false); setReviewed(false) }}/>{source === 'local' ? '이 컴퓨터 자료' : '기존 시트 자료'} · {memberName(preview.state, c[source].member_id)}<RecordDetail record={c[source]}/></label>)}</fieldset>)}
      {!reviewed && <><p>위 합계는 선택 전 자료입니다. 선택 결과를 다시 대조해 주세요.</p><button className="secondary-button" disabled={busy || preview.conflicts.some(c => !choices[c.key])} onClick={() => void run(async () => { const result = await api<{ state: SharedState; proposed: DataSummary }>('/shared-data/migration/review', 'POST', { preview_id: preview.preview_id, choices }); setPreview({ ...preview, ...result }); setReviewed(true) })}>선택 결과 대조</button></>}
      <label className="share-choice"><input type="checkbox" checked={confirmed} disabled={!reviewed || busy} onChange={e => setConfirmed(e.target.checked)}/>명의·건수·금액과 충돌 선택을 확인했어요</label>
      <button className="primary-button" disabled={busy || !confirmed || !reviewed || preview.conflicts.some(c => !choices[c.key])} onClick={() => void run(async () => changed(await commit<SharedData>('/shared-data/migration/commit', { preview_id: preview.preview_id, choices }), '공유 자료 이전과 저장 후 대조를 마쳤어요.'))}>확인한 자료 이전</button>
    </div>}
    {data && <><p>나: <strong>{memberName(data.state, data.viewer.me)}</strong> · 배우자: <strong>{memberName(data.state, data.viewer.partner)}</strong></p><p>은퇴 목표 기준: {memberName(data.state, data.viewer.retirement_reference_member_id)} · 로그인해도 명의와 공동 지분 기준은 바뀌지 않아요.</p><DataTotals summary={data.summary} state={data.state}/>
      <label className="share-choice"><input type="checkbox" checked={permissionChoice ?? !!data.permissions[data.viewer.me]} disabled={busy} onChange={e => { const allow = e.target.checked; setPermissionChoice(allow); void run(async () => { const permissions = await api<Record<string, boolean>>('/shared-data/permissions', 'PUT', { allow_other: allow }); setData({ ...data, permissions }); setNotice('내 자료의 앱 편집 허용을 변경했어요.') }).finally(() => setPermissionChoice(null)) }}/>배우자가 내 자료를 앱에서 편집하도록 허용</label>
      {(['me', 'partner'] as const).map(who => { const member = data.viewer[who]; const record = data.state.records.find(r => r.kind === 'profile' && r.member_id === member) ?? { kind: 'profile', id: member, member_id: member, payload: { name: '', age: null, gender: 'unspecified', role: null } }; const canEdit = who === 'me' || data.permissions[member]; return <article key={who} className="share-invite-row"><strong>{who === 'me' ? '나' : '배우자'} · {memberName(data.state, member)}</strong><RecordDetail record={record}/><button className="secondary-button" disabled={busy || !canEdit} onClick={() => setEdit(record)}>{who === 'me' ? '내 정보 수정' : '배우자 정보 수정'}</button>{!canEdit && <small>배우자가 본인 계정에서 편집을 허용해야 해요.</small>}</article> })}
      {edit && <form key={edit.member_id} className="share-form" onSubmit={saveProfile}><h4>{memberName(data.state, edit.member_id)} 정보</h4><label>이름<input name="name" required disabled={busy} maxLength={40} defaultValue={String(edit.payload.name ?? '')}/></label><label>만 나이<input name="age" type="number" disabled={busy} min={18} max={110} step={1} defaultValue={edit.payload.age == null ? '' : Number(edit.payload.age)}/></label><button className="primary-button" disabled={busy}>가족 정보 저장</button><button type="button" className="secondary-button" disabled={busy} onClick={() => setEdit(null)}>편집 취소</button></form>}
      <details><summary>명의별 계좌·계획 확인</summary>{data.state.records.filter(r => ['account', 'pension', 'property_plan', 'family_goal', 'retirement'].includes(r.kind)).map(r => <article className="share-invite-row" key={r.kind + r.id}><strong>{kindLabels[r.kind]} · {memberName(data.state, r.member_id)}</strong><RecordDetail record={r}/></article>)}</details>
    </>}
    {(started || data) && <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { await refresh(); onChanged(); setNotice('최신 공유 자료를 불러왔어요. 저장 전 초안은 닫았습니다.') })}>최신 공유 자료 다시 읽기</button>}
    {owner && (started || data) && <details><summary>백업 대조·복구</summary><p>현재 자료와 백업을 확인한 뒤 복구할 버전을 선택해 주세요. 복구 이력은 추가로 남습니다.</p><button className="secondary-button" disabled={busy} onClick={() => void run(async () => { setBackups(await api<Backups>('/shared-data/recovery')); setRecovery(null) })}>백업 목록 확인</button>
      {backups && <label>복구할 백업<select value={backupId} disabled={busy} onChange={e => { const id = e.target.value; setBackupId(id); setConfirmed(false); setRecovery(null); if (id) void run(async () => { setRecovery(await api<Recovery>('/shared-data/recovery/' + id)); setVersion('before') }) }}><option value="">백업 선택</option>{backups.backups.map((b, i) => <option key={b.id} value={b.id}>{i + 1}. {({ preview: '이전 전 대조', migration: '자료 이전', save: '자료 저장', recovery: '자료 복구' }[b.kind] ?? b.kind)} · {b.id.slice(0, 8)}</option>)}</select></label>}
      {recovery && <><label>복구 버전<select value={version} onChange={e => { setVersion(e.target.value as 'before' | 'proposed'); setConfirmed(false) }}><option value="before" disabled={!recovery.before}>변경 전</option><option value="proposed" disabled={!recovery.proposed}>변경 후 제안 자료</option></select></label>{recovery[version] && recovery[`${version}_summary`] ? <DataTotals state={recovery[version]!} summary={recovery[`${version}_summary`]!}/> : <p>이 버전에는 복구할 자료가 없어요. 다른 버전을 선택해 주세요.</p>}<label className="share-choice"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/>이 버전의 명의·건수·금액으로 복구할게요</label><button className="primary-button" disabled={busy || !confirmed || !recovery[version]} onClick={() => void run(async () => changed(await commit<SharedData>('/shared-data/recovery', { expected_revision: recovery.revision, backup_id: backupId, version }), '백업 복구와 대조를 마쳤어요.'))}>확인한 백업 복구</button></>}
    </details>}
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>
}
