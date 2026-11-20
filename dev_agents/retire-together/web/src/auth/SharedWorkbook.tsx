import { useState } from 'react'
import { useLocalData } from '../local-data'
import { assetOwnerLabel, money, type Owner } from '../model'
import { ConnectionSettings } from './ConnectionSettings'

export default function SharedWorkbook() {
  const [owner, setOwner] = useState<Owner>('together')
  const data = useLocalData(owner)
  return <main className="shared-workbook"><header className="button-row"><a className="secondary-button" href="#assets">우리 자산으로 돌아가기</a><ConnectionSettings onChanged={data.refresh}/><button className="secondary-button" disabled={data.loading} onClick={data.refresh}>새로고침</button></header>
    <h1>자산 관리</h1><p>현재 관리 시트에서 불러온 자산 표예요. 입력·수정은 우리 자산 화면에서 할 수 있어요.</p>
    <label>자산 소유자 <select value={owner} onChange={e => setOwner(e.target.value as Owner)}><option value="together">우리 부부</option><option value="me">나</option><option value="partner">배우자</option></select></label>
    {data.loading ? <p role="status">시트 자료를 불러오는 중…</p> : data.error ? <p role="alert">{data.error}</p> : <><p>총자산 {money(data.snapshot.total)} · 대출 {money(data.snapshot.debt)} · 순자산 {money(data.snapshot.net)}</p><div className="table-scroll"><table><thead><tr><th>자산</th><th>명의</th><th>기준일</th><th>금액</th></tr></thead><tbody>{[...data.snapshot.assets, ...data.snapshot.debts].map(a => <tr key={a.id}><td>{a.name}</td><td>{assetOwnerLabel(a.owner)}</td><td>{a.as_of}</td><td>{money(a.amount)}</td></tr>)}</tbody></table></div></>}
  </main>
}
