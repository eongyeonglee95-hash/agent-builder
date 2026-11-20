import { expect, test } from '@playwright/test'

const now = new Date()
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)

test('가계부: 지난달 기록 → 이번 달 미리 채워 적기 → 흐름·지출·수입·연별', async ({ page, request }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const last = { income: [{ who: 'me', kind: '월급', gross: 6_900_000, net: 5_410_000 }, { who: 'partner', kind: '월급', gross: null, net: 4_260_000 }],
    spend: { maintenance: 280_000, insurance: 460_000, loan_interest: 1_240_000, groceries: 1_180_000, dining: 620_000, transport: 480_000 },
    big: [{ name: '자동차 정비', amount: 960_000 }], saving: { pension: 1_000_000, principal: 600_000 } }
  const current = await (await request.get(`/api/household-book?year=${prev.getFullYear()}&month=${prev.getMonth() + 1}`)).json()
  expect((await request.put(`/api/household-book/${ym(prev)}`, { data: { ...last, version: current.selected.version } })).ok()).toBe(true)

  await page.goto('/#household')
  await expect(page.getByRole('heading', { name: '가계부', level: 1 })).toBeVisible()
  const m = now.getMonth() + 1
  const existing = await (await request.get(`/api/household-book?year=${now.getFullYear()}&month=${m}`)).json()
  if (!existing.selected.recorded) {
    await page.getByRole('button', { name: `${m}월 적기` }).click()
    await expect(page.getByText('지난달 값을 미리 채웠어요')).toBeVisible()
    await expect(page.getByLabel('관리비')).toHaveValue('280,000')
    await expect(page.getByLabel('이름')).toHaveCount(0)  // 큰 지출은 지난달 것을 가져오지 않는다
    await page.getByLabel('식비·장보기').fill('1500000')
    await page.getByRole('button', { name: '저장', exact: true }).click()
  }
  await expect(page.getByRole('img', { name: '수입이 쓴 돈과 모은 돈으로 나뉘는 흐름' })).toBeVisible()
  await expect(page.locator('.hb-totals').first()).toContainText('967만원')
  await page.screenshot({ path: testInfo.outputPath('household-flow-1440.png'), fullPage: true })

  await page.getByRole('tab', { name: '지출' }).click()
  await expect(page.locator('.hb-table')).toContainText('식비·장보기')
  await expect(page.locator('.hb-table')).toContainText('+160,000')  // 1,500,000 − 평균 1,340,000
  await page.getByRole('tab', { name: '수입' }).click()
  await expect(page.locator('.hb-table')).toContainText('5,410,000')

  await page.getByRole('button', { name: '연별' }).click()
  await page.getByRole('tab', { name: '돈의 흐름' }).click()
  await expect(page.getByRole('img', { name: '월별 수입의 쓰임' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('household-year-1440.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 900 })
  await page.reload()
  await expect(page.getByRole('list', { name: '수입의 쓰임' })).toContainText('현금 주머니')
  await page.screenshot({ path: testInfo.outputPath('household-flow-390.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})
