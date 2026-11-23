import { expect, test } from '@playwright/test'

test('주식 보드는 부분 시세를 전체 하락으로 표시하지 않고 조건을 검증한다', async ({ page }) => {
  await page.route('https://s3.tradingview.com/**', route => route.abort())
  await page.route('**/api/stock-market', route => route.fulfill({ json: { items: [] } }))
  const total = { value: 9000000, buy_value: 10000000, total_return: -1000000, total_rate: -10, cost_known: 1, count: 1, today_return: null, today_rate: null }
  await page.route('**/api/holdings?**', route => {
    const live = new URL(route.request().url()).searchParams.get('live') === '1'
    return route.fulfill({ json: {
      total, accounts: [{ ...total, id: 'a', label: '테스트 계좌', owner: 'me', as_of: '2026-11-23', stale: false, age_days: 0 }],
      holdings: [{ account_id: 'a', ticker_name: '테스트 종목', ticker: '000001', qty: 1, price: 9000000, value: 9000000, buy_value: 10000000, avg_cost: 10000000, total_return: -1000000, total_rate: -10, today_return: live ? -1000000 : null, today_rate: live ? -10 : null, weight: 100, asset_class: 'stock', stock_group: 'kr', live }],
      live, stale_days: 31, missing_ticker: [], quote_failed: [], movers: { drivers: [], top: [] },
      diagnostics: { positions: [{ name: '테스트 종목', value: 9000000, weight: 100 }], top_one_weight: 100, top_three_weight: 100, daily_rate: live ? -10 : null, quote_covered: live ? 1 : 0, quote_total: 1, daily_drivers: live ? [{ name: '테스트 종목', account_id: 'a', amount: -1000000, contribution_pp: -10 }] : [] },
    } })
  })
  await page.goto('/#stocks')
  await expect(page.getByRole('heading', { name: '보유 비중' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '내 주식', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: '시장 히트맵' })).not.toBeVisible()
  await page.getByText('추가 점검 · 하락 기준과 분석 준비 상태', { exact: true }).click()
  await page.getByLabel('하락 점검 기준').fill('2')
  await expect(page.locator('.sq-condition')).toContainText('전체 종목의 전일 비교 시세가 필요')
  await expect(page.locator('.ledger-disclosure')).toHaveCount(0)
  await page.getByRole('checkbox', { name: /현재가로 보기/ }).check()
  await expect(page.locator('.sq-condition')).toContainText('하락 기준에 도달했습니다')
  await expect(page.locator('.sq-driver')).toContainText('-10.00%p')
  await page.getByLabel('하락 점검 기준').fill('20')
  await expect(page.locator('.sq-condition')).toContainText('도달하지 않았습니다')
  await page.getByLabel('하락 점검 기준').fill('')
  await expect(page.locator('.sq-condition')).toContainText('하락 기준을 입력')
  await page.getByLabel('보유 종목 검색').fill('없는종목')
  await expect(page.getByRole('status').filter({ hasText: '0개 보유 내역' })).toBeVisible()
  await page.getByRole('tab', { name: '시장·매크로', exact: true }).click()
  await expect(page.getByText('시장 데이터를 불러오지 못했어요.')).toBeVisible()
  await expect(page.getByRole('heading', { name: '보유 주식' })).not.toBeVisible()
  await page.getByRole('tab', { name: '시장·매크로', exact: true }).press('ArrowLeft')
  await expect(page.getByRole('tab', { name: '내 주식', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('보유 종목 검색')).toHaveValue('없는종목')
  await page.getByRole('button', { name: '검색 지우기' }).click()
  await expect(page.locator('.hp-row')).toHaveCount(1)
  await page.getByText('추가 점검 · 하락 기준과 분석 준비 상태', { exact: true }).click()
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0) })
  await page.waitForTimeout(400)
  const firstRowY = await page.locator('.hp-row').first().evaluate(el => el.getBoundingClientRect().top + scrollY)
  expect(firstRowY).toBeLessThan(460)
  await expect(page.locator('.page-heading, .demo-notice, .shared-source-status')).toHaveCount(0)
  const sourceY = await page.locator('.hp-source-details').evaluate(el => el.getBoundingClientRect().top + scrollY)
  expect(sourceY).toBeGreaterThan(firstRowY)
  await page.screenshot({ path: test.info().outputPath('stock-tabs-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: test.info().outputPath('stock-tabs-mobile.png'), fullPage: true })
  await expect(page.locator('.hp-rt')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})

test('빈 주식 잔고에서는 등록을 먼저 보여주고 시장 탭에서만 외부 자료를 요청한다', async ({ page }) => {
  let marketRequests = 0
  await page.route('**/api/stock-market', route => { marketRequests++; return route.fulfill({ json: { items: [] } }) })
  await page.route('https://s3.tradingview.com/**', route => route.abort())
  await page.goto('/#stocks')
  await expect(page.getByRole('button', { name: '잔고 등록하기' })).toBeVisible()
  await expect(page.getByRole('region', { name: '내 주식 요약' }).locator('dl')).toHaveCount(0)
  expect(marketRequests).toBe(0)
  await page.getByRole('tab', { name: '시장·매크로', exact: true }).click()
  await expect.poll(() => marketRequests).toBe(1)
  await expect(page.getByRole('heading', { name: '시장 히트맵' })).toBeVisible()
})
