import { expect, test } from '@playwright/test'

for (const [route, title] of [['assets', '우리 자산'], ['household', '가계부']]) {
  test(`${title}의 제목과 핵심 수치를 한 상단에 모은다`, async ({ page }) => {
    await page.goto(`/#${route}`)
    const hero = page.getByRole('region', { name: `${title} 요약` })
    await expect(hero.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(hero.locator('dl')).toBeVisible()
    await expect(page.locator('.page-heading, .demo-notice, .shared-source-status')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath(`${route}-hero-desktop.png`), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    await page.screenshot({ path: test.info().outputPath(`${route}-hero-mobile.png`), fullPage: true })
  })
}
