import { expect, test } from '@playwright/test'

test('주식 보드는 부분 시세를 전체 하락으로 표시하지 않고 조건을 검증한다', async ({ page }) => {
  await page.route('https://s3.tradingview.com/**', route => route.abort())
  await page.route('**/api/stock-market', route => route.fulfill({ json: { items: [] } }))
  const total = { value: 900, buy_value: 1000, total_return: -100, total_rate: -10, cost_known: 1, count: 1, today_return: null, today_rate: null }
  await page.route('**/api/holdings?**', route => {
    const live = new URL(route.request().url()).searchParams.get('live') === '1'
    return route.fulfill({ json: {
      total, accounts: [{ ...total, id: 'a', label: '테스트 계좌', owner: 'me', as_of: '2026-11-23', stale: false, age_days: 0 }],
      holdings: [{ account_id: 'a', ticker_name: '테스트 종목', ticker: '000001', qty: 1, price: 900, value: 900, buy_value: 1000, avg_cost: 1000, total_return: -100, total_rate: -10, today_return: live ? -100 : null, today_rate: live ? -10 : null, weight: 100, asset_class: 'stock', stock_group: 'kr', live }],
      live, stale_days: 31, missing_ticker: [], quote_failed: [], movers: { drivers: [], top: [] },
      diagnostics: { positions: [{ name: '테스트 종목', value: 900, weight: 100 }], top_one_weight: 100, top_three_weight: 100, daily_rate: live ? -10 : null, quote_covered: live ? 1 : 0, quote_total: 1, daily_drivers: live ? [{ name: '테스트 종목', account_id: 'a', amount: -100, contribution_pp: -10 }] : [] },
    } })
  })
  await page.goto('/#stocks')
  await expect(page.getByRole('heading', { name: '종목 집중도' })).toBeVisible()
  await page.getByLabel('하락 점검 기준').fill('2')
  await expect(page.locator('.sq-condition')).toContainText('전체 종목의 전일 비교 시세가 필요')
  await expect(page.getByText('시장 데이터를 불러오지 못했어요.')).toHaveCount(1)
  await expect(page.locator('.ledger-disclosure')).toHaveCount(0)
  await page.getByRole('checkbox', { name: /현재가로 보기/ }).check()
  await expect(page.locator('.sq-condition')).toContainText('하락 기준에 도달했습니다')
  await expect(page.locator('.sq-driver')).toContainText('-10.00%p')
  await page.getByLabel('하락 점검 기준').fill('20')
  await expect(page.locator('.sq-condition')).toContainText('도달하지 않았습니다')
  await page.getByLabel('하락 점검 기준').fill('')
  await expect(page.locator('.sq-condition')).toContainText('하락 기준을 입력')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})
