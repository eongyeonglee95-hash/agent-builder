import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  test(`자산 관리에서 표와 연결 설정을 열고 주소를 유지한다 · ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/#property')
    await expect(page.getByRole('navigation', { name: '부동산 메뉴' })).toBeVisible()
    await expect(page.getByRole('button', { name: /구글 시트로 관리하기/ })).toHaveCount(0)
    if (width < 700) await page.getByRole('button', { name: '메뉴 열기', exact: true }).click()
    await page.getByRole('button', { name: '자산 관리', exact: true }).click()
    await expect(page).toHaveURL(/#sheet-assets$/)
    await page.getByRole('button', { name: '연결 설정', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '연결 설정', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(page).toHaveURL(/#sheet-assets$/)
    await expect(page.getByRole('button', { name: '연결 설정', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: `/tmp/asset-management-${width}.png` })
  })
}
test('오류 복구 링크에서 연결 설정을 바로 연다', async ({ page }) => {
  await page.goto('/#sheet-connection')
  await expect(page.getByRole('dialog', { name: '연결 설정', exact: true })).toBeVisible()
})
