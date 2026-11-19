import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('추가연금 납입 정보·기록을 저장하고 다시 열어도 유지하며 적립금은 바꾸지 않는다', async ({ page, request }) => {
  const name = `정기 납입 검수 ${randomUUID().slice(0, 6)}`
  const result = await request.post('/api/assets', { data: { request_id: randomUUID(), name, account: '연금보험', owner: 'me', pocket: 'retirement', assetClass: 'mixed', pension_layer: 4, amount: 12000000, as_of: '2026-11-01' } })
  expect(result.ok()).toBe(true)
  await page.goto('/#rebalance')
  let card = page.getByRole('region', { name, exact: true })
  await card.getByRole('button', { name: '납입 정보 수정' }).click()
  let form = card.getByRole('form', { name: '납입 정보 수정' })
  await form.getByLabel('월 납입액 (원)').fill('300000')
  await form.getByLabel('매월 납입일').fill('25')
  await form.getByLabel('납입 종료일').fill('2030-12-25')
  await form.getByRole('button', { name: '저장', exact: true }).click()
  await expect(card.getByRole('status')).toContainText('납입 정보를 저장')
  await page.reload()
  card = page.getByRole('region', { name, exact: true })
  await expect(card).toContainText('300,000원')
  await card.getByRole('button', { name: '납입 기록', exact: true }).click()
  form = card.getByRole('form', { name: '납입 기록 입력' })
  await form.getByLabel('납입한 날짜').fill('2026-11-18')
  await form.getByRole('button', { name: '저장', exact: true }).click()
  await expect(card.getByRole('status')).toContainText('적립금은 그대로')
  await card.getByText(/날짜별 납입 내역/).click()
  await expect(card.getByText('2026-11-18', { exact: true })).toBeVisible()
  await expect(card).toContainText('1,200만원')
  await card.getByRole('button', { name: '납입 정보 수정' }).click()
  await card.getByLabel('납입 상태').selectOption('complete')
  await card.getByRole('button', { name: '저장', exact: true }).click()
  await expect(card).toContainText('예정 없음')
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await card.screenshot({ path: test.info().outputPath(`additional-${width}.png`) })
  }
})
