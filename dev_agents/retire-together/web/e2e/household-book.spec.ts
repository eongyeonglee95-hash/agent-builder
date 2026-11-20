import { expect, test } from '@playwright/test'

const now = new Date()
const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)

test('가계부: 흐름 + 1년 표 · 매달 고정 미리 채우기 · 칸 고치기 · 캡처 분류', async ({ page, request }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const last = { income: [{ who: 'me', kind: '월급', gross: 6_900_000, net: 5_410_000 }, { who: 'partner', kind: '월급', gross: null, net: 4_260_000 }],
    spend: { maintenance: 280_000, insurance: 460_000, loan_interest: 1_240_000, groceries: 1_180_000, dining: 620_000, transport: 480_000 },
    big: [{ name: '자동차 정비', amount: 960_000 }], saving: { pension: 1_000_000, principal: 600_000 },
    fixed: ['income:me', 'income:partner', 'spend:insurance', 'spend:loan_interest', 'saving:pension', 'saving:principal'] }
  const current = await (await request.get(`/api/household-book?year=${prev.getFullYear()}&month=${prev.getMonth() + 1}`)).json()
  expect((await request.put(`/api/household-book/${ym(prev)}`, { data: { ...last, version: current.selected.version } })).ok()).toBe(true)
  const m = now.getMonth() + 1
  const existing = await (await request.get(`/api/household-book?year=${now.getFullYear()}&month=${m}`)).json()

  await page.goto('/#household')
  await expect(page.getByRole('heading', { name: '가계부', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: `${m}월 돈의 흐름` })).toBeVisible()
  if (!existing.selected.recorded) {
    await expect(page.getByText('매달 고정 항목으로 미리 채운 달이에요')).toBeVisible()
    await expect(page.locator('.hb-auto').first()).toBeVisible()  // 회색 = 미리 채운 값
  }
  await expect(page.getByRole('img', { name: '수입이 쓴 돈과 모은 돈으로 나뉘는 흐름' })).toBeVisible()

  await page.getByRole('button', { name: `${m}월 식비·장보기 고치기` }).click()
  await page.getByRole('textbox', { name: `${m}월 식비·장보기` }).fill('1500000')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: `${m}월 식비·장보기 고치기` })).toHaveText('150')
  await expect(page.locator('.hb-totals').first()).toContainText('967만원')
  await page.screenshot({ path: testInfo.outputPath('household-1440.png'), fullPage: true })

  await page.getByRole('button', { name: '매달 고정 항목' }).click()
  const fixed = page.getByRole('region', { name: '매달 고정 항목' })
  await expect(fixed.getByRole('checkbox', { name: '보험' })).toBeChecked()
  await expect(fixed.getByRole('checkbox', { name: '관리비' })).not.toBeChecked()
  await page.getByRole('button', { name: '닫기' }).click()

  await page.route('**/api/household-book/capture', route => route.fulfill({ json: { month: ym(now), rows: [
    { date: `${ym(now)}-18`, merchant: '이마트 성수점', amount: 84_320, category: 'groceries', how: 'rule', in_month: true, duplicate: false },
    { date: `${ym(now)}-15`, merchant: '홍길동', amount: 50_000, category: null, how: null, in_month: true, duplicate: false },
    { date: `${ym(prev)}-30`, merchant: '스타벅스', amount: 5_000, category: 'dining', how: 'rule', in_month: false, duplicate: false },
  ] } }))
  await page.getByRole('button', { name: `${m}월 캡처 올리기` }).click()
  await page.locator('#hb-capture-files').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('x') })
  await expect(page.getByText('1건만 골라 주세요')).toBeVisible()
  await expect(page.getByRole('button', { name: '1건을 골라야 더할 수 있어요' })).toBeDisabled()
  await page.getByLabel('홍길동 분류').selectOption({ label: '경조사·선물' })
  await page.screenshot({ path: testInfo.outputPath('household-capture-1440.png'), fullPage: true })
  await page.getByRole('button', { name: `${m}월 칸에 더하기` }).click()
  await expect(page.getByRole('button', { name: `${m}월 식비·장보기 고치기` })).toHaveText('158')

  await page.setViewportSize({ width: 390, height: 900 })
  await page.reload()
  await expect(page.getByRole('list', { name: '수입의 쓰임' })).toContainText('현금 주머니')
  await page.screenshot({ path: testInfo.outputPath('household-390.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})
