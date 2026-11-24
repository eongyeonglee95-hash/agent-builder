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
  await page.getByRole('button', { name: `${m}월 내역 올리기` }).click()
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

test('가계부: 카드사 명세서 CSV를 코드로 읽어 분류하고 더한다', async ({ page }, testInfo) => {
  const m = now.getMonth() + 1, d = (day: number) => `${now.getFullYear()}.${String(m).padStart(2, '0')}.${String(day).padStart(2, '0')}`
  const csv = ['카드 이용내역', '이용일자,가맹점명,이용금액,취소여부', `${d(3)},이마트 성수점,"84,320",`, `${d(5)},스타벅스 서울숲,"5,600",`,
    `${d(6)},알수없는상점,"12,000",`, `${d(7)},쿠팡,"32,000",취소`].join('\n')
  await page.goto('/#household')
  await page.getByRole('button', { name: `${m}월 내역 올리기` }).click()
  await page.locator('#hb-capture-files').setInputFiles({ name: '카드.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const panel = page.getByRole('region', { name: `${m}월 카드·은행 내역` })
  await expect(panel).toContainText('3건')
  await expect(panel).toContainText('취소·입금·합계 1줄은 뺐어요')
  await expect(panel.getByLabel('이마트 성수점 분류')).toHaveValue('groceries')
  await expect(panel.getByLabel('스타벅스 서울숲 분류')).toHaveValue('dining')
  await panel.getByLabel('알수없는상점 분류').selectOption({ label: '쇼핑·생활용품' })
  await page.screenshot({ path: testInfo.outputPath('household-statement-1440.png'), fullPage: true })
  await panel.getByRole('button', { name: `${m}월 칸에 더하기` }).click()
  await expect(panel).toBeHidden()
})

test('가계부: 급여명세서 사진 → 확인 표 → 그달 수입에 넣기', async ({ page }, testInfo) => {
  const m = now.getMonth() + 1
  await page.route('**/api/household-book/capture', route => route.fulfill({ json: { month: ym(now), kind: 'payslip', slips: [
    { who: 'me', employee_name: '김한화', employer: '한화', kind: '월급', label: `${m}월 급여`, pay_date: `${ym(now)}-25`, gross: 7_000_000, deduction_total: 1_500_000, net: 5_500_000, deductions: { national_pension: 279_000 }, adds_up: true, month: ym(now), in_month: true },
    { who: null, employee_name: '박모름', employer: '', kind: '월급', label: '', pay_date: '', gross: 5_000_000, deduction_total: 700_000, net: 4_400_000, deductions: {}, adds_up: true, month: ym(now), in_month: true },
  ] } }))
  await page.goto('/#household')
  await page.getByRole('button', { name: '급여명세서' }).click()
  const panel = page.getByRole('region', { name: `${m}월 급여명세서` })
  await page.locator('#hb-payslip-files').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('x') })
  await expect(panel).toContainText('누구 명세서인지 1장 골라 주세요')
  await expect(panel.getByRole('button', { name: '누구 명세서인지 골라 주세요' })).toBeDisabled()
  await panel.getByLabel('박모름 명세서 누구').selectOption({ label: '배우자' })
  await expect(panel).toContainText('합이 맞아요')
  await page.screenshot({ path: testInfo.outputPath('household-payslip-1440.png'), fullPage: true })
  await panel.getByRole('button', { name: `${m}월 수입에 넣기` }).click()
  await expect(panel).toBeHidden()
  await expect(page.getByRole('button', { name: `${m}월 나 고치기` })).toHaveText('550')
  await expect(page.getByRole('button', { name: `${m}월 배우자 고치기` })).toHaveText('440')
})
