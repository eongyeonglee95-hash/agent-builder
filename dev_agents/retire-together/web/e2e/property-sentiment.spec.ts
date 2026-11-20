import { expect, test } from '@playwright/test'

test('심리·금리: 클릭 전 시계열, 주기·날짜 변경, 결측, 모바일', async ({ page }) => {
  const queries: string[] = []
  let aiCalls = 0
  await page.route('**/api/property-move/sentiment/history?**', async route => {
    queries.push(route.request().url())
    const query = new URL(route.request().url()).searchParams
    const daily = query.get('mode') === 'daily'
    const periods = Array.from({ length: 12 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
    await route.fulfill({ json: {
      start: '2026-08-01', end: query.get('date'), periods, refreshing: false, collection: null,
      historical_note: '브라우저 검증용 합성 자료',
      items: [{ id: 'kb_buy', name: '매수우위지수', provider: 'KB부동산', unit: '지수', frequency: 'weekly', source_url: 'https://data.kbland.kr/kbstats/wmh', status: 'ready', latest: { value: 82, day: '2026-08-12', collected: '2026-08-13' }, cells: periods.map((day, i) => ({ day, observed: day, value: daily || i === 5 ? null : 70 + i, delta: daily || i === 5 || i === 6 ? null : i % 2 ? 1 : -1 })) }],
    } })
  })
  await page.route('**/api/property-move/sentiment', route => { aiCalls++; return route.fulfill({ json: { text: '테스트', sources: [], as_of: '2026-08-13' } }) })
  await page.goto('/#property')
  await page.getByRole('navigation', { name: '부동산 메뉴' }).getByRole('button', { name: '심리·금리', exact: true }).click()
  const dashboard = page.getByRole('region', { name: '부동산 심리', exact: true })
  await expect(dashboard.getByRole('table')).toBeVisible()
  await expect(dashboard.getByRole('img')).toBeVisible()
  expect(aiCalls).toBe(0)
  await dashboard.getByRole('button', { name: '관측값', exact: true }).click()
  await expect(dashboard.getByRole('cell', { name: '—', exact: true })).toHaveCount(1)
  await page.screenshot({ path: '/tmp/sentiment-desktop.png', fullPage: true })
  await dashboard.getByRole('button', { name: '이전 기간', exact: true }).click()
  await expect.poll(() => queries.length).toBeGreaterThan(1)
  await dashboard.getByRole('button', { name: '월간', exact: true }).click()
  await expect.poll(() => queries.at(-1)).toContain('mode=monthly')
  await dashboard.getByRole('button', { name: '일간', exact: true }).click()
  await expect(dashboard.getByText('일간 수치 공급원은 아직 연결 전이에요.', { exact: false })).toBeVisible()
  await expect(dashboard.getByRole('img')).toHaveCount(0)
  await page.setViewportSize({ width: 360, height: 800 })
  await expect(page.locator('.sidebar')).not.toBeInViewport()
  await page.screenshot({ path: '/tmp/sentiment-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  expect(aiCalls).toBe(0)
})
