import { expect, test, type APIRequestContext } from '@playwright/test'

async function addAsset(request: APIRequestContext, name: string, pocket: string, amount: number) {
  const response = await request.post('/api/assets', { data: {
    request_id: crypto.randomUUID(), name, account: name + ' 계좌', owner: 'me',
    pocket, assetClass: pocket === 'debt' ? 'debt' : 'cash', amount, as_of: '2026-11-01',
  } })
  expect(response.ok(), await response.text()).toBe(true)
}

test('워크북 자산 시트: 스크롤해도 맨 아래 합계 줄이 보이고 대출은 따로 더한다', async ({ page, request }) => {
  const before = await (await request.get('/api/assets')).json() as { pocket: string; amount: number }[]
  const base = before.filter(a => a.pocket !== 'debt').reduce((n, a) => n + a.amount, 0)
  const baseDebt = before.filter(a => a.pocket === 'debt').reduce((n, a) => n + a.amount, 0)
  for (let i = 0; i < 30; i++) await addAsset(request, `합계 예금 ${i}`, 'cash', 1000)
  await addAsset(request, '합계 대출', 'debt', 500)
  await page.setViewportSize({ width: 1440, height: 700 })
  await page.goto('/#sheet-assets')
  const grid = page.getByRole('grid', { name: '자산 표' })
  await expect(grid).toBeVisible()
  const total = grid.getByRole('gridcell', { name: `금액 합계 ${(base + 30000).toLocaleString('ko-KR')}` })
  await expect(total).toBeInViewport()
  await expect(grid.getByRole('gridcell', { name: `계좌·보관처 합계 대출 ${(baseDebt + 500).toLocaleString('ko-KR')}` })).toBeVisible()
  await page.locator('.xl-scroll').evaluate(el => { el.scrollTop = 0 })
  await expect(total).toBeInViewport()
  await page.screenshot({ path: test.info().outputPath('asset-total-1440.png') })
})
