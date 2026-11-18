import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Amount } from '../components/ui/amount'
import { day } from '../lib/format'
import { assetOwnerLabel, type Asset } from '../model'

const examples = [
  { id: 'example-joint', name: '공동명의 주택', owner: '공동 · 지분 50%', amount: 400000000, note: '집 전체 8억원 중 보유 지분', date: null },
  { id: 'example-sole', name: '단독명의 주택', owner: '나 · 지분 100%', amount: 600000000, note: '집 전체 6억원', date: null },
]

export function PropertyRecords({ assets, hidden, onSelect }: { assets: Asset[]; hidden: boolean; onSelect: (asset: Asset) => void }) {
  const [example, setExample] = useState(false)
  const rows = example ? examples : assets.map(a => ({
    id: a.id, name: a.name, owner: assetOwnerLabel(a.owner), amount: a.amount,
    note: a.account, date: a.as_of,
  }))
  return <details className="rounded-md border border-grey-200 bg-background text-sm" aria-label="부동산 자산 내역">
    <summary className="cursor-pointer px-4 py-3 font-semibold">자산 내역</summary>
    <div className="space-y-3 border-t border-grey-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label="자산 내역 보기">
          <Button size="sm" variant={!example ? 'secondary' : 'ghost'} aria-pressed={!example} onClick={() => setExample(false)}>내 자산</Button>
          <Button size="sm" variant={example ? 'secondary' : 'ghost'} aria-pressed={example} onClick={() => setExample(true)}>입력 예시</Button>
        </div>
        <span className="text-xs text-grey-600">{example ? '가상 금액 · 저장되지 않음' : '소유 지분 기준'}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-grey-200 text-xs text-grey-600"><tr><th className="p-2 font-medium">자산</th><th className="p-2 font-medium">소유자</th><th className="p-2 text-right font-medium">지분 평가액</th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.id} className="border-b border-grey-200 last:border-b-0">
            <td className="p-2">{example ? <span className="font-medium">{row.name}</span> : <Button variant="link" size="sm" className="h-auto whitespace-normal p-0 text-left" onClick={() => { const asset = assets.find(a => a.id === row.id); if (asset) onSelect(asset) }}>{row.name}</Button>}
              <div className="mt-1 text-xs text-grey-600">{example ? row.note : day(row.date)}</div>
            </td>
            <td className="p-2 text-xs text-grey-600">{row.owner}</td>
            <td className="p-2 text-right font-semibold tabular-nums"><Amount value={row.amount} fmt="manwon" hidden={hidden}/></td>
          </tr>)}</tbody>
        </table>
        {!rows.length && <p className="py-4 text-grey-600">등록한 부동산이 없습니다.</p>}
      </div>
    </div>
  </details>
}
