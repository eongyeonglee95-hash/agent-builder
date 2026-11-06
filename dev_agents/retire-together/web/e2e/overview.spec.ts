import { expect, test } from '@playwright/test'

test('자산 요약: 핵심 금액·상태별 행동과 작은 화면', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let stale = false
  let fail = false
  await page.route('**/api/workbook/summary?*', async route => {
    if (fail) return route.fulfill({ status: 503, json: { detail: '검수용 일시 오류' } })
    return route.fulfill({ json: {
      line: '검수 자료 기준 순자산 7억 3,000만원',
      dashboard: { net: 730000000, total: 830000000, debt: 100000000, retirement: 90000000, cash: 40000000, property: 700000000, financial: 130000000 },
      holdings: { accounts: stale ? [{ id: 'test', label: '검수 계좌', owner: 'me', as_of: '2026-01-01', stale: true, age_days: 90, value: 0, buy_value: null, total_return: null, total_rate: null }] : [], holdings: [], total: { value: 0, count: 0, cost_known: 0 }, live: false },
      rebalance: { pools: [] },
    } })
  })
  await page.goto('/')
  const overview = page.getByRole('region', { name: '우리 자산 한눈에' })
  await expect(overview).toContainText('730,000,000')
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(overview.getByRole('button', { name: '잔고 등록하기' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByRole('tab', { name: '연금', exact: true })).toBeInViewport()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: test.info().outputPath(`overview-${width}.png`), animations: 'disabled' })
  }
  await overview.getByRole('button', { name: '잔고 등록하기' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  stale = true
  await page.reload()
  await expect(overview).toContainText('1개 계좌의 잔고')
  await overview.getByRole('button', { name: '보유종목 확인' }).click()
  await expect(page.getByRole('tab', { name: '보유종목' })).toHaveAttribute('aria-selected', 'true')
  fail = true
  await page.goto('/')
  await expect(page.getByRole('button', { name: '다시 불러오기', exact: true })).toBeVisible()
  await expect(overview).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click()
  await expect(overview).toBeVisible()
  expect(errors).toEqual([])
})

test('모바일 홈: 요약 다음에 체크리스트가 보인다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/#home')
  await page.getByRole('button', { name: '예시 보기', exact: true }).click()
  const summary = page.getByRole('region', { name: '자산 요약' })
  const checklist = page.locator('.classic-home-checklist')
  await expect(summary).toBeVisible()
  const stats = await summary.boundingBox()
  const checks = await checklist.boundingBox()
  expect(stats!.y + stats!.height).toBeLessThanOrEqual(checks!.y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('home-390.png') })
})
