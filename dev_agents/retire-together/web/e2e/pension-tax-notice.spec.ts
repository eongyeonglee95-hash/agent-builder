import { expect, test, type APIRequestContext } from '@playwright/test'

test.afterEach(async ({ request }) => {
  const assets = await (await request.get('/api/assets')).json()
  for (const asset of assets.filter((a: any) => ['me 검수 연금저축', 'partner 검수 연금저축'].includes(a.account))) {
    expect((await request.delete(`/api/assets/${asset.id}?version=${asset.version}`)).ok()).toBe(true)
  }
})

async function seed(request: APIRequestContext, me = 450000360, partner = 360000000) {
  const family = await (await request.get('/api/family')).json()
  expect((await request.put('/api/family', { data: { me: { name: '세금 검수', age: 40 }, partner: { name: '배우자', age: 43 }, retirement_age: 60, version: family?.version ?? 0 } })).ok()).toBe(true)
  // Each run uses the dedicated temporary database, never the development ledger.
  const assets = await (await request.get('/api/assets')).json()
  for (const asset of assets) expect((await request.delete(`/api/assets/${asset.id}?version=${asset.version}`)).ok()).toBe(true)
  for (const [who, amount] of [['me', me], ['partner', partner]] as const) {
    expect((await request.post('/api/assets', { data: { request_id: crypto.randomUUID(), name: `${who} 검수 연금`, account: `${who} 검수 연금저축`, owner: who, pocket: 'retirement', assetClass: 'mixed', amount, as_of: new Date().toISOString().slice(0, 10) } })).ok()).toBe(true)
  }
  const current = await (await request.get('/api/retirement')).json()
  const saved = await request.put('/api/retirement/plan', { data: { me: { private_start_age: 60 }, partner: { private_start_age: 60 }, return_rate: 0, inflation: .02, version: current.plan.version } })
  expect(saved.ok()).toBe(true)
  return saved.json()
}

test('세금 확인: 개인별·선택 연도·그해 금액, 안내와 키보드 및 금액 숨김', async ({ page, request }) => {
  const initial = await seed(request)
  const writes: string[] = []
  page.on('request', req => { if (req.url().includes('/api/') && req.method() !== 'GET') writes.push(req.url()) })
  await page.goto('/#pension')
  const badge = page.getByRole('button', { name: '개인연금 세금 확인', exact: true })
  const scope = page.getByRole('group', { name: '연금 조회 범위' })
  await expect(badge).toBeVisible()
  await badge.focus()
  await page.keyboard.press('Enter')
  const pop = page.getByRole('dialog', { name: '개인연금 세금 확인', exact: true })
  await expect(pop).toBeVisible()
  await expect(pop.getByTestId('pension-tax-me')).toContainText('15,000,012원')
  await expect(pop.getByTestId('pension-tax-partner')).toHaveCount(0)
  await expect(pop).toContainText(`${initial.base_year + 20}년 · 세전 · 그해 금액`)
  await expect(pop).toContainText('세액공제 받지 않은 원금')
  await expect(pop.getByRole('link', { name: /국세청 과세 기준/ })).toHaveAttribute('href', initial.pension_tax_rule.source_url)
  await page.keyboard.press('Escape')
  await expect(pop).toBeHidden()
  await expect(badge).toBeFocused()
  await scope.getByRole('button', { name: '배우자', exact: true }).click()
  await expect(badge).toHaveCount(0)
  await scope.getByRole('button', { name: '나', exact: true }).click()
  await expect(badge).toBeVisible()
  const row = initial.projection.rows.find((r: any) => r.year === initial.base_year + 20)
  expect(row.items.find((i: any) => i.person === 'me' && i.layer === 3).real * 12).toBeLessThan(15000000)
  await scope.getByRole('button', { name: '우리 함께', exact: true }).click()
  await badge.click()
  await page.getByRole('slider', { name: '살펴보는 연도', exact: true }).fill(String(initial.base_year + 19))
  await expect(pop).toHaveCount(0)
  await expect(badge).toHaveCount(0)
  await page.getByRole('slider', { name: '살펴보는 연도', exact: true }).fill(String(initial.base_year + 20))
  await expect(badge).toBeVisible()
  // The amount toggle lives on Assets; returning to Pension must not expose the notice.
  await badge.click()
  await page.evaluate(() => { location.hash = 'assets' })
  await expect(pop).toHaveCount(0)
  await page.getByRole('button', { name: '금액 숨기기', exact: true }).click()
  await page.evaluate(() => { location.hash = 'pension' })
  await expect(page.getByTestId('income-chart-total')).toHaveText('••••••')
  await expect(badge).toHaveCount(0)
  await expect(pop).toHaveCount(0)
  expect((await (await request.get('/api/retirement')).json()).plan).toEqual(initial.plan)
  expect(writes).toEqual([])
})

test('세금 확인: 부부 각각 기준 이하/정확히 기준이면 합산 금액으로 표시하지 않는다', async ({ page, request }) => {
  await seed(request, 450000000, 450000000)
  await page.goto('/#pension')
  await expect(page.getByTestId('income-chart-total')).toBeVisible()
  await expect(page.getByRole('button', { name: '개인연금 세금 확인', exact: true })).toHaveCount(0)
})

test('세금 확인: 함께 보기의 두 사람 표시와 좁은 화면에서 열고 닫기', async ({ page, request }) => {
  const initial = await seed(request, 600000000, 600000000)
  await page.goto('/#pension')
  const badge = page.getByRole('button', { name: '개인연금 세금 확인', exact: true })
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await badge.scrollIntoViewIfNeeded()
    if (process.env.RETIRE_TAX_CAPTURE) await page.locator('.tower-income-chart').screenshot({ path: `/private/tmp/pension-tax-chart-${width}.png` })
    await badge.click()
    const pop = page.getByRole('dialog', { name: '개인연금 세금 확인', exact: true })
    await expect(pop.getByTestId('pension-tax-me')).toBeVisible()
    await expect(pop.getByTestId('pension-tax-partner')).toBeVisible()
    expect(await pop.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (process.env.RETIRE_TAX_CAPTURE) await pop.screenshot({ path: `/private/tmp/pension-tax-details-${width}.png` })
    await pop.getByRole('button', { name: '세금 안내 닫기' }).click()
    await expect(badge).toBeFocused()
  }
  await page.getByRole('group', { name: '연금 조회 범위' }).getByRole('button', { name: '배우자', exact: true }).click()
  await badge.click()
  await expect(page.getByTestId('pension-tax-me')).toHaveCount(0)
  await expect(page.getByTestId('pension-tax-partner')).toBeVisible()
  expect((await (await request.get('/api/retirement')).json()).plan).toEqual(initial.plan)
})
