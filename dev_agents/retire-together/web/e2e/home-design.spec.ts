import { expect, test } from '@playwright/test'

test('두 주머니 홈은 실제 집계·소유자·숨김·상세 이동을 유지한다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  let fail = false
  const assets = [
    { id: 'pension', name: '검수 연금', account: '연금저축', owner: 'me', pocket: 'retirement', assetClass: 'stock', amount: 90000000, as_of: '2026-11-06' },
    { id: 'cash', name: '검수 현금', account: '예금', owner: 'partner', pocket: 'cash', assetClass: 'cash', amount: 30000000, as_of: '2026-11-06' },
    { id: 'house', name: '검수 집', account: '주택', owner: 'me', pocket: 'property', assetClass: 'property', amount: 500000000, as_of: '2026-11-06' },
  ]
  await page.route('**/api/family', route => route.fulfill({ json: null }))
  await page.route('**/api/dashboard?*', route => {
    if (fail) return route.fulfill({ status: 503, json: { detail: '검수용 조회 실패' } })
    const owner = new URL(route.request().url()).searchParams.get('owner')
    const own = owner === 'together' ? assets : assets.filter(a => a.owner === owner)
    const total = own.reduce((sum, a) => sum + a.amount, 0)
    const retirement = own.filter(a => a.pocket === 'retirement').reduce((sum, a) => sum + a.amount, 0)
    const cash = own.filter(a => a.pocket === 'cash').reduce((sum, a) => sum + a.amount, 0)
    const debt = owner === 'partner' ? 0 : 100000000
    return route.fulfill({ json: { assets: own, debts: [], total, retirement, cash, property: total - retirement - cash, debt, net: total - debt, financial: retirement + cash, count: own.length, unclassified: 0, as_of: '2026-11-06', classes: [] } })
  })
  await page.goto('/?homeDesign=photo#home')
  const summary = page.getByRole('region', { name: '자산 요약' })
  const pension = page.getByRole('article', { name: '노후 주머니' })
  const cash = page.getByRole('article', { name: '현금 주머니' })
  await expect(summary.locator('.home-net')).toContainText('5억 2,000만원')
  await expect(summary).toContainText('6억 2,000만원')
  await expect(pension).toContainText('9,000만원')
  await expect(pension).toContainText('75.0%')
  await expect(cash).toContainText('25.0%')
  await expect(page.getByRole('region', { name: '우리의 두 주머니' })).toHaveCount(1)

  await page.getByRole('button', { name: '금액 숨기기', exact: true }).click()
  await expect(summary).not.toContainText('5억')
  await expect(pension).not.toContainText('9,000만원')
  await expect(pension).not.toContainText('75.0%')
  await page.getByRole('button', { name: '금액 표시', exact: true }).click()
  await page.getByRole('button', { name: '배우자', exact: true }).click()
  await expect(summary.locator('.home-net')).toContainText('3,000만원')
  await expect(pension).toContainText('등록 전')
  await expect(cash).toContainText('100.0%')
  await cash.getByRole('button', { name: '현금 주머니 상세 보기' }).click()
  await expect(page).toHaveURL(/#assets$/)
  await expect(page.locator('.filter-tabs').getByRole('button', { name: '현금 주머니', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.goto('/?homeDesign=photo#home')
  await page.getByRole('button', { name: '연금 계획 살펴보기' }).click()
  await expect(page).toHaveURL(/#pension$/)

  fail = true
  await page.goto('/?homeDesign=photo#home')
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('검수용 조회 실패')
  await expect(summary.locator('.home-net')).toHaveText('—')
  await expect(pension).not.toContainText('9,000만원')
  await expect(pension.getByRole('button', { name: '노후 주머니 자산 등록' })).toBeDisabled()
  expect(errors).toEqual([])
})

test('등록 전·예시 홈의 사진과 금액은 작은 화면에서도 읽힌다', async ({ page }, testInfo) => {
  await page.route('**/api/family', route => route.fulfill({ json: null }))
  await page.route('**/api/dashboard?*', route => route.fulfill({ json: { assets: [], debts: [], classes: [], total: 0, net: 0, debt: 0, financial: 0, retirement: 0, cash: 0, property: 0, count: 0, unclassified: 0, as_of: null } }))
  await page.goto('/?homeDesign=photo#home')
  await expect(page.getByRole('heading', { name: '자산 하나부터 시작해요.' })).toBeVisible()
  await expect(page.getByRole('region', { name: '자산 요약' })).not.toContainText('0원')
  await expect(page.getByRole('button', { name: '자산 등록', exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '현금 주머니 자산 등록' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '예시로 둘러보기' }).click()
  await expect(page.locator('.home-data-status')).toContainText('예시 자료')
  for (const width of [1440, 1024, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => document.fonts.ready)
    await expect.poll(() => page.locator('.home-pocket-photo img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const boxes = await page.locator('.home-pocket').evaluateAll(cards => cards.map(card => ({ x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y })))
    if (width < 650) {
      expect(boxes[1].y).toBeGreaterThan(boxes[0].y)
      const summary = await page.locator('.home-balance').boundingBox()
      expect(summary!.y + summary!.height).toBeLessThan(boxes[0].y)
    } else expect(boxes[0].y).toBe(boxes[1].y)
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true, animations: 'disabled' })
  }
})
