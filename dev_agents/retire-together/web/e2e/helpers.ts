import { expect, type APIRequestContext } from '@playwright/test'

type Row = { id: string; version: number; parent_id?: string | null; valuation_source?: string; updated_at?: string; account_id?: string; source?: string; pension_layer_effective?: number }

// 전용 임시 DB의 자산을 모두 지운다. 앞 테스트가 남긴 자산에 기대지 않도록 각 테스트가 시작할 때 부른다.
// 세부 합산 계좌는 마지막 종목을 지울 수 없어서(409) 먼저 계좌 총액 기준으로 바꾸고, 종목 → 계좌 순서로 지운다.
export async function clearAssets(request: APIRequestContext) {
  const rows = async () => (await request.get('/api/assets')).json() as Promise<Row[]>
  for (const { id, version, updated_at, account_id, source, pension_layer_effective, ...body } of (await rows()).filter(a => a.valuation_source === 'details')) {
    const r = await request.put(`/api/assets/${id}`, { data: { ...body, valuation_source: 'total', version } })   // 읽기 전용 칸은 빼고 보낸다
    expect(r.ok(), await r.text()).toBe(true)
  }
  for (const children of [true, false]) {
    for (const a of (await rows()).filter(a => !!a.parent_id === children)) {
      const r = await request.delete(`/api/assets/${a.id}?version=${a.version}`)
      expect(r.ok(), await r.text()).toBe(true)
    }
  }
}
