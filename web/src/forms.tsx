import { useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Check, Info, Trash2 } from 'lucide-react'
import { api } from './local-data'
import { assetOwnerLabel, classInfo, money, type Asset, type Family, type Owner } from './model'

const roles = { wife: '아내', husband: '남편', partner: '배우자' }
export const personRole = (role: keyof typeof roles | null) => role ? roles[role] : '역할 미입력'
function ErrorBox({ error }: { error: string }) { return error ? <div className="form-error" role="alert"><Info size={16}/>{error}</div> : null }

export function ProfileForm({ family, onSaved }: { family: Family | null; onSaved: () => void }) {
  const [withPartner, setWithPartner] = useState(!!family?.partner)
  const [withGoal, setWithGoal] = useState(family?.retirement_age != null || family?.target_amount != null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('')
    const data = new FormData(e.currentTarget)
    const number = (key: string) => data.get(key) ? Number(data.get(key)) : null
    const person = (key: 'me' | 'partner') => ({ name: data.get(`${key}-name`), age: number(`${key}-age`), role: data.get(`${key}-role`) || null, gender: data.get(`${key}-gender`) || 'unspecified' })
    try {
      await api('/family', 'PUT', { me: person('me'), partner: withPartner ? person('partner') : null,
        retirement_age: withGoal ? number('retirement_age') : null,
        target_amount: withGoal && number('target_amount') !== null ? number('target_amount')! * 10_000 : null,
        version: family?.version ?? 0 })
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했습니다.') } finally { setBusy(false) }
  }
  return <form onSubmit={submit}>
    <p className="form-intro">자산은 바로 등록할 수 있어요.<br/>이름과 목표는 편할 때 채워 주세요.</p>
    {(['me', ...(withPartner ? ['partner'] : [])] as ('me' | 'partner')[]).map(key => <fieldset className="profile-fields" key={key}><legend>{key === 'me' ? '내 정보' : '배우자 정보'}</legend><label className="form-label">이름 또는 별명<input name={`${key}-name`} defaultValue={family?.[key]?.name ?? (key === 'me' ? '나' : '배우자')} maxLength={40} required autoComplete="off"/></label><details className="optional-fields" open={family?.[key]?.age != null || undefined}><summary>나이·가족 역할 추가하기 <span>선택</span></summary><div className="form-grid"><label className="form-label">현재 만 나이<input name={`${key}-age`} type="number" min="18" max="110" step="1" defaultValue={family?.[key]?.age ?? ''} placeholder="나중에 입력해도 돼요"/></label><label className="form-label">가족 역할<select name={`${key}-role`} defaultValue={family?.[key]?.role ?? ''}><option value="">선택하지 않음</option><option value="wife">아내</option><option value="husband">남편</option><option value="partner">배우자</option></select></label><label className="form-label">성별<select name={`${key}-gender`} defaultValue={family?.[key]?.gender ?? 'unspecified'}><option value="unspecified">선택하지 않음</option><option value="female">여성</option><option value="male">남성</option></select></label></div></details></fieldset>)}
    <label className="checkbox-label"><input type="checkbox" checked={withPartner} onChange={e => setWithPartner(e.target.checked)}/>배우자 정보도 함께 입력하기</label>
    <label className="checkbox-label"><input type="checkbox" checked={withGoal} onChange={e => setWithGoal(e.target.checked)}/>은퇴 목표도 정해 두기 · 선택</label>
    {withGoal && <fieldset className="profile-fields"><legend>우리의 은퇴 목표</legend><div className="form-grid"><label className="form-label">목표 은퇴 나이 (나 기준)<input name="retirement_age" type="number" min="18" max="100" step="1" defaultValue={family?.retirement_age ?? ''} placeholder="아직 모르면 비워 두세요"/></label><label className="form-label">목표 순자산 (만원)<input name="target_amount" type="number" min="1" max="100000000000" step="1" defaultValue={family?.target_amount != null ? family.target_amount / 10_000 : ''} placeholder="아직 모르면 비워 두세요"/></label></div><p className="form-help">목표는 원하는 시점과 금액이며, 은퇴 가능 여부를 계산한 결과는 아닙니다.</p></fieldset>}
    <ErrorBox error={error}/><button type="submit" className="primary-button full-width" disabled={busy}>{busy ? '저장 중…' : '내 정보 저장'}<Check size={16}/></button>
  </form>
}

type Kind = 'pension' | 'stock' | 'cash' | 'property' | 'debt'
const kinds: Record<Kind, string> = { pension: '연금', stock: '주식·ETF', cash: '예금·현금', property: '집·부동산', debt: '대출·부채' }
const classification = (kind: Kind): Asset['assetClass'] => kind === 'pension' ? 'mixed' : kind === 'stock' ? 'stock' : kind
export function AssetForm({ family, asset, owner, initialKind, parent, onSaved }: {
  onProfile?: () => void; initialKind?: 'stock' | 'property'; family: Family | null; asset: Asset | null; owner: Owner; parent?: Asset | null; onSaved: (asset: Asset) => void
}) {
  const initial: Kind = asset ? asset.pocket === 'retirement' ? 'pension' : asset.pocket === 'property' || asset.pocket === 'debt' ? asset.pocket : asset.assetClass === 'cash' ? 'cash' : 'stock' : initialKind ?? 'pension'
  const [kind, setKind] = useState<Kind>(initial)
  const [person, setPerson] = useState<Asset['owner']>(parent?.owner ?? asset?.owner ?? (owner === 'partner' ? 'partner' : 'me'))
  const [assetClass, setAssetClass] = useState<Asset['assetClass']>(asset?.assetClass ?? (parent ? 'stock' : classification(initial)))
  const [amount, setAmount] = useState(String(asset?.full_amount ?? asset?.amount ?? ''))
  const [share, setShare] = useState(asset?.share_percent ?? 50)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState<Record<string, unknown> | null>(null)
  const [requestId] = useState(() => crypto.randomUUID())
  const today = new Date().toLocaleDateString('en-CA')
  const pocket = parent?.pocket ?? (kind === 'pension' ? 'retirement' : kind === 'property' || kind === 'debt' ? kind : 'cash')
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError('')
    if (!review) {
      const form = new FormData(e.currentTarget)
      const account = parent?.account ?? String(form.get('account') ?? '').trim()
      setReview({ name: String(form.get('name') ?? '').trim() || account, account, owner: person, pocket,
        assetClass: pocket === 'property' || pocket === 'debt' ? pocket : assetClass,
        amount: Number(amount), as_of: form.get('as_of'), parent_id: parent?.id ?? asset?.parent_id ?? null,
        valuation_source: asset?.valuation_source ?? 'total', share_percent: person === 'joint' ? share : null })
      return
    }
    setBusy(true)
    try {
      const saved = await api<Asset>(asset ? `/assets/${asset.id}` : '/assets', asset ? 'PUT' : 'POST', { ...review, ...(asset ? { version: asset.version } : { request_id: requestId }) })
      onSaved(saved)
    } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했습니다.') } finally { setBusy(false) }
  }
  return <form onSubmit={submit}>
    <div hidden={!!review}>
      <p className="form-intro">{parent ? `${parent.account} 안의 자산입니다. 계좌 총액과 중복해 더하지 않아요.` : asset ? '금액과 기준일을 바꾸면 홈에도 바로 반영돼요.' : '종류와 금액부터 알려주세요. 이름·가족 정보·은퇴 목표는 나중에 채워도 괜찮아요.'}</p>
      {!parent && <div className="form-grid"><label className="form-label">자산 종류<select name="kind" aria-label="자산 종류" value={kind} disabled={!!asset?.parent_id} onChange={e => { const next = e.target.value as Kind; setKind(next); setAssetClass(classification(next)); if (next !== 'property' && next !== 'debt' && person === 'joint') setPerson('me') }}>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="form-label">누구의 자산인가요?<select name="owner" value={person} onChange={e => setPerson(e.target.value as Asset['owner'])} disabled={!!asset?.parent_id}><option value="me">나{family ? ` · ${family.me.name}` : ''}</option><option value="partner">배우자{family?.partner ? ` · ${family.partner.name}` : ''}</option>{(kind === 'property' || kind === 'debt') && <option value="joint">부부 공동 소유</option>}</select></label></div>}
      {parent ? <label className="form-label">세부 자산 이름<input name="name" defaultValue={asset?.name ?? ''} placeholder="예: 국내 주식형 ETF" maxLength={100} required/></label> : <label className="form-label">{kind === 'property' ? '집·부동산 이름' : kind === 'debt' ? '대출 이름' : '계좌·자산 이름'}<input name="account" defaultValue={asset?.account ?? ''} placeholder={kind === 'property' ? '예: 우리 집' : kind === 'debt' ? '예: 주택담보대출' : kind === 'pension' ? '예: 미래에셋 연금저축 (구)' : kind === 'stock' ? '예: 키움 주식계좌' : '예: 우리은행 예금'} maxLength={100} required/></label>}
      {person === 'joint' && <label className="form-label">내 지분 (%)<input name="share" type="number" min="1" max="99" step="1" value={share} onChange={e => setShare(Number(e.target.value))} required/><small>나 {share}% · 배우자 {100 - share}%. 전체 금액은 한 번만 등록해요.</small></label>}
      <label className="form-label">{kind === 'debt' ? '현재 남은 대출 잔액' : person === 'joint' ? '전체 금액 (지분으로 나누기 전)' : parent ? '이 자산의 현재 금액' : '현재 금액'} (원)<input name="amount" type="number" min="0" max="1000000000000000" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="예: 10000000" required/><small>{amount && Number.isFinite(Number(amount)) ? money(Number(amount)) : '숫자를 입력하면 읽기 쉬운 금액으로 보여드려요.'}</small></label>
      <details className="optional-fields"><summary>기준일·자산 분류 자세히 <span>선택</span></summary><label className="form-label">금액 기준일<input name="as_of" type="date" defaultValue={asset?.as_of ?? today} max={today} required/></label>{!parent && <label className="form-label">목록에 표시할 이름<input name="name" defaultValue={asset?.name ?? ''} placeholder="비워 두면 계좌·자산 이름을 사용해요" maxLength={100}/></label>}{pocket !== 'property' && pocket !== 'debt' && <label className="form-label">자산 분류<select name="assetClass" value={assetClass} onChange={e => setAssetClass(e.target.value as Asset['assetClass'])}>{Object.entries(classInfo).filter(([key]) => key !== 'property' && key !== 'debt').map(([key, info]) => <option key={key} value={key}>{info.label}</option>)}</select><small>{assetClass === 'mixed' ? '연금 계좌는 여러 자산이 섞인 금액으로 등록해요. 세부 자산은 나중에 연결할 수 있어요.' : '선택한 종류로 분류했어요. 필요한 경우에만 바꿔 주세요.'}</small></label>}</details>
      <p className="form-help">{kind === 'stock' && !parent ? '계좌 총액만 넣는 방법이에요. 종목별 수량·평단가와 손익을 보려면 ‘사진’이나 ‘파일’로 등록하세요.' : '금액 기준일을 함께 저장해요. 금액이 바뀌면 이 기록을 갱신해 주세요.'}</p>
    </div>
    {review && <div className="entry-review"><span className="outline-tag">저장 전 확인</span><h3>{String(review.name)}</h3><strong>{money(Number(review.amount))}</strong><dl><div><dt>소유자</dt><dd>{assetOwnerLabel(person)}{person === 'joint' ? ` · 내 지분 ${share}%` : ''}</dd></div><div><dt>금액 기준일</dt><dd>{String(review.as_of)}</dd></div><div><dt>집계 방식</dt><dd>{parent ? '계좌의 세부 자산으로 연결' : '등록한 금액 기준'}</dd></div></dl><p>{parent ? '계좌 총액과 세부 자산 합계를 따로 비교하고, 선택한 한 기준만 자산 합계에 반영해요.' : '저장하면 홈에서 등록 결과를 확인할 수 있어요.'}</p></div>}
    <ErrorBox error={error}/><div className="entry-actions">{review && <button type="button" className="secondary-button" disabled={busy} onClick={() => { setReview(null); setError('') }}><ArrowLeft size={14}/>다시 수정</button>}<button type="submit" className="primary-button" disabled={busy}>{busy ? '저장 중…' : review ? '저장하기' : '입력 내용 확인'}{review ? <Check size={15}/> : <ArrowRight size={15}/>}</button></div>
  </form>
}

export function DeleteAsset({ asset, onDeleted, onCancel }: { asset: Asset; onDeleted: () => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <><p className="modal-lead">이 자산을 목록에서 삭제할까요?</p><p>{asset.name} · {money(asset.full_amount ?? asset.amount)}<br/>{asset.owner === 'joint' ? '공동 소유 기록이 부부 전체 목록에서 삭제됩니다.' : '현재 자산 합계에서도 제외됩니다.'} 이전 변경 이력은 로컬 DB에 보관됩니다.</p><ErrorBox error={error}/><div className="button-row delete-actions"><button className="secondary-button" disabled={busy} onClick={onCancel}>돌아가기</button><button className="danger-button" disabled={busy} onClick={async () => { setBusy(true); try { await api(`/assets/${asset.id}?version=${asset.version}`, 'DELETE'); onDeleted() } catch (e) { setError(e instanceof Error ? e.message : '삭제하지 못했습니다.'); setBusy(false) } }}><Trash2 size={15}/>{busy ? '삭제 중…' : '삭제하기'}</button></div></>
}
