import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('4층 수령 방식에 따라 합계·부족액·그래프를 함께 전환한다', async ({ page, request }) => {
  const family = await (await request.get('/api/family')).json()
  expect((await request.put('/api/family', { data: { me: { name: '검수', age: 40 }, partner: { name: '배우자', age: 42 }, retirement_age: 60, target_amount: null, version: family?.version ?? 0 } })).ok()).toBe(true)
  const initial = await (await request.get('/api/retirement')).json()
  expect((await request.put('/api/retirement/plan', { data: { ...initial.plan, me: { ...initial.plan.me, national_monthly: 1200000, private_start_age: 60 }, partner: { ...initial.plan.partner, national_monthly: 800000, private_start_age: 60 }, monthly_need: 3500000, return_rate: 0, inflation: .02 } })).ok()).toBe(true)
  const account = `선택 검수 ${randomUUID()}`
  expect((await request.post('/api/assets', { data: { request_id: randomUUID(), name: '추가연금', account, owner: 'me', pocket: 'retirement', assetClass: 'mixed', amount: 36000000, pension_layer: 4, as_of: '2026-11-01' } })).ok()).toBe(true)
  try {
    const result = await (await request.get('/api/retirement')).json()
    const row = result.projection.rows.find((r: { year: number }) => r.year === result.projection.summary.retire_year)
    await page.goto('/#pension')
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 1000 })
      let buttonTop: number | undefined
      for (const include of [true, false]) {
        await page.getByRole('radio', { name: include ? '연금으로 받기' : '목돈으로 받기', exact: true }).check()
        const total = row.total_real + (include ? row.extra_real : 0)
        await expect(page.getByTestId('pension-total')).toHaveAttribute('data-won', String(total))
        await expect(page.getByTestId('income-chart-total')).toHaveAttribute('data-won', String(total))
        await expect(page.getByTestId('selected-nominal-income')).toHaveAttribute('data-won', String(row.total_nominal + (include ? row.extra_nominal : 0)))
        await expect(page.locator('.tower-coverage-label')).toContainText(`${(total / row.need_real * 100).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`)
        await expect(page.locator('.tower-gap h3')).toContainText(`${((row.need_real - total) / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만 원`)
        await expect(page.getByTestId('income-chart-layer-4')).toHaveCount(include ? 1 : 0)
        await expect(page.getByTestId('pension-lump-sum')).toHaveCount(include ? 0 : 1)
        const layout = await page.locator('.tower-income-actions').evaluate(el => {
          const amount = el.querySelector('.tower-total')!.getBoundingClientRect()
          const button = el.querySelector('button')!.getBoundingClientRect()
          return { rightOfAmount: button.left >= amount.right, top: button.top - el.getBoundingClientRect().top }
        })
        expect(layout.rightOfAmount).toBe(true)
        if (buttonTop !== undefined) expect(layout.top).toBe(buttonTop)
        buttonTop = layout.top
        await expect(page.locator('.tower-summary-note')).not.toContainText('세전')
        await expect(page.locator('.tower-calculation-basis')).not.toHaveAttribute('open', '')
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      }
    }
    await page.getByRole('radio', { name: '목돈으로 받기', exact: true }).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('radio', { name: '연금으로 받기', exact: true })).toBeChecked()
    await page.getByRole('group', { name: '연금 조회 범위' }).getByRole('button', { name: '나', exact: true }).click()
    await expect(page.locator('.tower-coverage-label')).toHaveCount(0)
    const slider = page.getByRole('slider', { name: '살펴보는 연도', exact: true })
    await slider.focus()
    await slider.press('ArrowRight')
    const year = Number(await slider.inputValue())
    const next = result.projection.rows.find((r: { year: number }) => r.year === year)
    const personal = next.items.filter((item: { person: string }) => item.person === 'me').reduce((sum: number, item: { real: number }) => sum + item.real, 0)
    await expect(page.getByTestId('pension-total')).toHaveAttribute('data-won', String(personal))
    await expect(page.getByTestId('income-chart-total')).toHaveAttribute('data-won', String(personal))
  } finally {
    const assets = await (await request.get('/api/assets')).json()
    for (const asset of assets.filter((a: { account: string }) => a.account === account)) await request.delete(`/api/assets/${asset.id}?version=${asset.version}`)
  }
})
