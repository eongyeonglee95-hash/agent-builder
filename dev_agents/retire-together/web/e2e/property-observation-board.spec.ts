import { expect, test, type Page } from '@playwright/test'

const candidates = [
  { id: 'a', name: '대치 검증단지', address: { jibun: '서울 강남구 대치동' }, area_m2: 84.9, asking_low: 1000000000, asking_date: '2026-11-16', price: 900000000, price_date: '2026-10-01', memo: '직접 확인한 메모', living: { life: '공원 접근', commute: '출퇴근 기록' } },
  { id: 'b', name: '잠실 검증단지', address: { jibun: '서울 송파구 잠실동' }, area_m2: null, asking_low: null, price: null, living: {} },
]
const payload = {
  plan: { candidates, source_home_ids: ['home'], cash: 200000000, new_loan: 100000000, sale_costs: 10000000 },
  funds: { sale_net: 500000000 }, comparisons: [{ id: 'a', gap: 120000000, costs_complete: true }], missing_home_ids: [], valuation_needs_review: [],
}
const watch = { configured: true, months: 12, watch: [{ id: 'a', summary: { count: 7, areas: [
  { area: 59, count: 4, median: 600000000, latest: { price: 610000000, date: '2026-11-01', floor: 3, area: 59.9 } },
  { area: 84, count: 3, median: 880000000, latest: { price: 890000000, date: '2026-10-20', floor: 12, area: 84.9 } },
] } }, { id: 'b', summary: null, missing: '주소(지번) 확인 필요' }] }

async function fixtures(page: Page) {
  await page.route('**/api/property-move?**', route => route.fulfill({ json: payload }))
  await page.route('**/api/property-move/watch?**', route => route.fulfill({ json: watch }))
  await page.route('**/api/property-move/places?**', route => route.fulfill({ json: { radius_m: 1000, fetched_at: { park: '2026-11-01' }, items: [{ id: 'a', places: { department: { name: '검증 백화점', distance_m: 850 }, park_large: { name: '검증 공원', distance_m: 200 }, hospital_tertiary: null, hospital_general: null, parks_within: 2 } }] } }))
  await page.addInitScript(() => sessionStorage.setItem('property-menu', 'brief'))
}

for (const width of [1280, 360]) {
  test(`등록 자료·같은 평형·계획 자금을 나란히 표시 · ${width}`, async ({ page }) => {
    await fixtures(page)
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/#property')
    const board = page.getByLabel('실제 자료 브리핑')
    await expect(board).toContainText('5억원')
    const row = board.getByRole('article').filter({ hasText: '대치 검증단지' })
    await expect(row).toContainText('10억원')
    await expect(row).toContainText('8억 9,000만원')
    await expect(row).toContainText('1억 2,000만원')
    await expect(row).not.toContainText('6억 1,000만원')
    await page.screenshot({ path: test.info().outputPath(`real-property-${width}.png`), fullPage: true })
    await row.getByRole('button', { name: '대치 검증단지' }).click()
    await expect(row).toContainText('검증 공원')
    await expect(row).toContainText('직선 200m')
    await expect(row).toContainText('직접 확인한 메모')
    await row.getByLabel('대치 검증단지 전용면적').selectOption('59')
    const metrics = row.locator('dl').first()
    await expect(metrics).toContainText('6억 1,000만원')
    await expect(metrics).not.toContainText('10억원')
    await expect(metrics).not.toContainText('1억 2,000만원')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    const search = page.getByLabel('관심 단지 검색')
    await search.fill('대치')
    await expect(board.getByRole('article')).toHaveCount(1)
    await search.fill('없는단지')
    await expect(board).toContainText('검색 결과가 없어요.')
  })
}

test('실거래 실패에도 등록 자료를 유지하고 사람 변경 시 다른 범위로 조회한다', async ({ page }) => {
  await fixtures(page)
  await page.route('**/api/property-move/watch?**', route => route.fulfill({ status: 503, json: {} }))
  await page.goto('/#property')
  const board = page.getByLabel('실제 자료 브리핑')
  await expect(board).toContainText('실거래 조회 실패')
  await expect(board).toContainText('대치 검증단지')
  await expect(board).not.toContainText('8억 9,000만원')
  const next = page.waitForRequest(req => req.url().includes('/api/property-move?owner=me'))
  await page.getByLabel('자산 소유자 선택').selectOption('me')
  await next
})

test('삭제된 매도 주택이 있으면 추가 자금을 확정 표시하지 않는다', async ({ page }) => {
  await fixtures(page)
  await page.route('**/api/property-move?**', route => route.fulfill({ json: { ...payload, missing_home_ids: ['deleted'] } }))
  await page.goto('/#property')
  const board = page.getByLabel('실제 자료 브리핑')
  await expect(board).toContainText('내 집 시세·자금 확인')
  await expect(board).not.toContainText('1억 2,000만원')
  await expect(board).not.toContainText('5억원')
})
