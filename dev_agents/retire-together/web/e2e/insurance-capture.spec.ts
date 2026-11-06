import { expect, test } from '@playwright/test'

const names = ['(무)엔터프라이즈', '연금보험Enterprise(무)']
const amounts = [37696320, 14450256]
const surrender = [6500049, 5367322]
const groups = names.map((name, index) => ({
  kind: 'contracts', account_label: `검수생명 ${name}`, owner: 'me', source: 'capture', rows: [],
  computed_total: amounts[index], screen_total: null, layer_labels: { '3': '개인연금 · 연금저축보험·펀드' },
  contracts: [{ company: '검수생명', product_type: '', product_name: name, amount: amounts[index],
    amount_source: 'total_premiums', insurance_detail: true, total_premiums: amounts[index],
    monthly_premium: 300000, surrender_value: surrender[index], paid_installments: index === 0 ? 120 : 46,
    total_installments: 120, layer: 0, overlap: false, as_of: '2026-11-01', payout_start_date: null }],
}))

test('보험 두 장: 납입금 기준·분류 확인·첫 계약 저장 후 두 번째 유지', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/api/register/capture', route => route.fulfill({ json: { groups } }))
  await page.goto('/#assets')
  await page.getByRole('button', { name: '자산 등록', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /캡처/ }).click()
  await dialog.locator('input[type=file]').setInputFiles(names.map((_, i) => ({ name: `insurance-${i}.png`, mimeType: 'image/png', buffer: Buffer.from('preview fixture') })))
  await dialog.getByRole('button', { name: '표로 바꾸기' }).click()
  await expect(dialog.locator('.rv-acct')).toHaveCount(2)
  expect(await (await request.get('/api/assets')).json()).toEqual([])
  for (let i = 0; i < 2; i++) {
    const panel = dialog.getByRole('region', { name: `검수생명 ${names[i]} 계약 표` })
    await expect(panel.getByLabel(`${names[i]} 등록 금액`, { exact: true })).toHaveValue(String(amounts[i]))
    await expect(panel).toContainText('적립금이 표시되지 않아 총납입보험료를 등록 금액으로 사용했어요.')
    await expect(panel).toContainText(surrender[i].toLocaleString('ko-KR'))
    await expect(panel.getByRole('button', { name: /등록하기/ })).toBeDisabled()
    await panel.getByLabel(`${names[i]} 연금 층`, { exact: true }).selectOption('3')
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`insurance-${width}.png`) })
  }
  await dialog.locator('.rv-acct').first().getByRole('button', { name: /등록하기/ }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.rv-acct').first()).toContainText('등록했어요')
  await expect(dialog.locator('.rv-acct').last().getByRole('button', { name: /등록하기/ })).toBeEnabled()
  expect((await (await request.get('/api/assets')).json()).length).toBe(1)
  await dialog.locator('.rv-acct').last().getByRole('button', { name: /등록하기/ }).click()
  await expect(dialog).toBeHidden()
  const assets = await (await request.get('/api/assets')).json()
  expect(assets.map((a: {amount: number}) => a.amount).sort((a: number,b: number) => a-b)).toEqual([...amounts].sort((a,b) => a-b))
  expect(assets.every((a: {pension_layer: number}) => a.pension_layer === 3)).toBe(true)
  expect(errors).toEqual([])
})

test('보험 금액 미확인: 해지환급금만 있으면 0원 등록을 막는다', async ({ page }) => {
  const missing = structuredClone(groups[0])
  Object.assign(missing.contracts[0], { amount: null, total_premiums: null, amount_source: null })
  await page.route('**/api/register/capture', route => route.fulfill({ json: { groups: [missing] } }))
  await page.goto('/#assets')
  await page.getByRole('button', { name: '자산 등록', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /캡처/ }).click()
  await dialog.locator('input[type=file]').setInputFiles({ name: 'missing.png', mimeType: 'image/png', buffer: Buffer.from('preview fixture') })
  await dialog.getByRole('button', { name: '표로 바꾸기' }).click()
  await dialog.getByLabel(`${names[0]} 연금 층`, { exact: true }).selectOption('3')
  await expect(dialog.getByLabel(`${names[0]} 등록 금액`, { exact: true })).toHaveValue('')
  await expect(dialog.getByRole('button', { name: /등록하기/ })).toBeDisabled()
})
