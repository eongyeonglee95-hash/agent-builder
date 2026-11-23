import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`공통 화면과 동작 버튼 디자인 ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    for (const route of ['home', 'assets', 'pension', 'stocks', 'property', 'rebalance', 'household', 'sheet-summary', 'design']) {
      await page.goto(`/#${route}`)
      await expect(page.locator('#root')).not.toBeEmpty()
      await page.waitForTimeout(500)
      const actions = page.locator('button.primary-button,button.secondary-button,button.danger-button')
      for (const action of await actions.all()) {
        await expect(action).toHaveAttribute('data-slot', 'button')
        if (await action.isVisible()) {
          const colors = await action.evaluate(el => { const s=getComputedStyle(el);return {fg:s.color,bg:s.backgroundColor} })
          expect(colors.fg).not.toBe(colors.bg)
        }
      }
      await page.screenshot({ path: test.info().outputPath(`${route}-${width}.png`), fullPage: true })
    }
    await page.locator('#ds-name').fill('디자인 시스템 확인')
    await expect(page.locator('#ds-name')).toHaveValue('디자인 시스템 확인')
    await page.locator('#ds-native-owner').selectOption('partner')
    await expect(page.locator('#ds-native-owner')).toHaveValue('partner')
    expect(errors).toEqual([])
  })
}
