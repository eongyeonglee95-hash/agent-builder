import { expect, test } from '@playwright/test'

test('기본 홈은 실제 합계·범위·숨김·조회 실패를 처리한다', async ({ page }) => {
  let failed = false
  await page.route('**/api/family', route => route.fulfill({ json: null }))
  await page.route('**/api/dashboard?*', route => {
    if (failed) return route.fulfill({ status: 503, json: { detail: '조회 실패 검수' } })
    const partner = new URL(route.request().url()).searchParams.get('owner') === 'partner'
    const assets = partner ? [{ id: 'cash', name: '현금', account: '예금', pocket: 'cash', owner: 'partner', amount: 30000000, assetClass: 'cash' }] : [
      { id: 'pension', name: '연금', account: '연금저축', pocket: 'retirement', owner: 'me', amount: 90000000, assetClass: 'stock' },
      { id: 'cash', name: '현금', account: '예금', pocket: 'cash', owner: 'partner', amount: 30000000, assetClass: 'cash' },
    ]
    return route.fulfill({ json: { assets, debts: [], classes: [], total: partner ? 30000000 : 120000000, net: partner ? 30000000 : 100000000, debt: partner ? 0 : 20000000, retirement: partner ? 0 : 90000000, cash: 30000000, financial: partner ? 30000000 : 120000000, property: 0, count: assets.length, unclassified: 0, as_of: '2026-11-07' } })
  })
  await page.goto('/#home')
  const total = page.getByRole('article', { name: '총자산', exact: true })
  const pension = page.getByRole('article', { name: '노후 주머니', exact: true })
  await expect(total).toContainText('1억 2,000만원')
  await expect(total).toContainText('순자산 1억원')
  await expect(pension.locator('.ring')).toContainText('75%')
  await page.getByRole('button', { name: '금액 숨기기', exact: true }).click()
  await expect(total).not.toContainText('1억원')
  await expect(pension).not.toContainText('75%')
  await page.getByRole('button', { name: '금액 표시', exact: true }).click()
  await page.getByRole('button', { name: '배우자', exact: true }).click()
  await expect(total).toContainText('3,000만원')
  await expect(pension).toContainText('미등록')
  await page.getByRole('button', { name: '갈아타기 재원 상세 보기' }).click()
  await expect(page).toHaveURL(/#assets$/)
  await expect(page.locator('.filter-tabs').getByRole('button', { name: '현금 주머니', exact: true })).toHaveAttribute('aria-pressed', 'true')
  failed = true
  await page.goto('/#home')
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('조회 실패 검수')
  await expect(total.locator('.stat-number')).toHaveText('—')
  await expect(total.getByRole('button', { name: '총자산 상세 보기' })).toBeDisabled()
})

test('기본 목업 구조는 미등록에도 유지되고 사진형은 별도 주소에만 있다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/family', r => r.fulfill({ json: null }))
  await page.route('**/api/dashboard?*', r => r.fulfill({ json: { assets: [], debts: [], classes: [], total: 0, net: 0, debt: 0, retirement: 0, cash: 0, financial: 0, property: 0, count: 0, unclassified: 0 } }))
  await page.goto('/#home')
  await expect(page.locator('.classic-home .stat-card')).toHaveCount(3)
  await expect(page.getByRole('region', { name: '자산 구성', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '전략별 자산 배분' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '가구 소득 흐름' })).toBeVisible()
  await expect(page.locator('.home-pocket-photo, .home-empty, .start-card')).toHaveCount(0)
  await expect(page.getByText('자산 하나부터 시작해요.', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '자산 등록', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '예시 보기', exact: true }).click()
  for (const width of [1440, 1024, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const summary = await page.getByRole('region', { name: '자산 요약' }).boundingBox()
    const detail = await page.locator('.dashboard-grid').boundingBox()
    expect(summary!.y + summary!.height).toBeLessThanOrEqual(detail!.y)
    if (width > 650) {
      const cards = await page.locator('.classic-home .stat-card').evaluateAll(xs => xs.map(x => x.getBoundingClientRect().y))
      expect(new Set(cards).size).toBe(1)
      expect(detail!.y).toBeLessThan(350)
    }
  }
  await page.goto('/?homeDesign=photo#home')
  await expect(page.locator('.home-dashboard')).toBeVisible()
  await page.getByRole('link', { name: '기본 홈으로 돌아가기' }).click()
  await expect(page.locator('.classic-home')).toBeVisible()
  await expect(page.locator('.home-dashboard')).toHaveCount(0)
  expect(errors).toEqual([])
})
