import { expect, test } from '@playwright/test'

test('한글 조합 중 입력 노드를 유지하고 기존 관심 단지도 찾는다', async ({ page }) => {
  await page.goto('/previews/property-observatory/index.html#watch')
  const frame = page
  const input = frame.locator('#interest-search')
  await input.focus()
  const retained = await input.evaluate(element => {
    const field = element as HTMLInputElement
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    for (const text of ['ㄷ', '대', '대ㅊ', '대치']) {
      field.value = text
      field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: text }))
      if (!field.isConnected || document.activeElement !== field) return false
    }
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '대치' }))
    field.dispatchEvent(new InputEvent('input', { bubbles: true, data: '대치' }))
    return field.isConnected && document.activeElement === field
  })
  expect(retained).toBe(true)
  await expect(input).toHaveValue('대치')
  await expect(frame.locator('.iv-add-results')).toContainText('대치현대')
  await input.fill('없는단지이름')
  await expect(frame.locator('.iv-add-results')).toContainText('검색 결과가 없어요.')
  await input.fill('대치')
  await expect(frame.locator('.iv-add-results')).toContainText('대치현대')
})

test('내장 허용은 동일 출처 관측실 문서에만 적용한다', async ({ request }) => {
  expect((await request.get('/')).headers()['x-frame-options']).toBe('DENY')
  expect((await request.get('/previews/property-observatory/index.html')).headers()['x-frame-options']).toBe('SAMEORIGIN')
})

for (const width of [1280, 390, 360]) {
  test(`관측실 8개 메뉴와 제품 토큰 · ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/#property')
    const menu = page.getByRole('navigation', { name: '부동산 메뉴' })
    const frame = page.frameLocator('iframe[title="부동산 관측실 화면"]')
    await expect(menu.getByRole('button').first()).toHaveText('내 부동산')
    await expect(page.locator('.ledger-disclosure')).toBeVisible()
    await menu.getByRole('button', { name: '브리핑', exact: true }).click()
    await expect(frame.locator('#main')).not.toBeEmpty()
    for (const label of ['브리핑', '시장 관측', '관심 단지', '관심 지도', '급매 관측', '팔로우', '주간·월간', '리서치 노트']) {
      await menu.getByRole('button', { name: label, exact: true }).click()
      await expect(menu.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page')
      if (label === '브리핑' || label === '관심 단지') {
        await expect(page.getByLabel('관심 단지 검색')).toBeVisible()
        continue
      }
      await expect(frame.locator('#main')).not.toBeEmpty()
      const ids: Record<string, string> = { '브리핑': 'brief', '시장 관측': 'market', '관심 단지': 'watch', '관심 지도': 'map', '급매 관측': 'signals', '팔로우': 'voices', '주간·월간': 'journal', '리서치 노트': 'research' }
      await expect.poll(() => frame.locator('html').evaluate(() => location.hash)).toBe(`#${ids[label]}`)
      await expect(page.locator('.ledger-disclosure')).toHaveCount(0)
      await expect.poll(() => frame.locator('body').evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    }
    const hostSize = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--text-sm').trim())
    expect(await frame.locator('html').evaluate(el => getComputedStyle(el).getPropertyValue('--text-sm').trim())).toBe(hostSize)
    await menu.getByRole('button', { name: '브리핑', exact: true }).click()
    await expect(page.getByLabel('실제 자료 브리핑')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath(`property-${width}.png`), fullPage: true })
    await menu.getByRole('button', { name: '내 부동산' }).click()
    await expect(page.getByRole('heading', { name: '우리 집을 모두 팔면' })).toBeVisible()
    expect(errors).toEqual([])
  })
}

test('관심 선택은 메뉴 이동·새로고침 뒤 유지되고 장부에 쓰지 않는다', async ({ page }) => {
  const writes: string[] = []
  page.on('request', req => { if (req.url().includes('/api/') && ['POST', 'PUT', 'DELETE'].includes(req.method())) writes.push(req.url()) })
  await page.goto('/previews/property-observatory/index.html#watch')
  const frame = page
  const star = frame.locator('.iv-row .iw-star').first()
  await expect(star).toBeVisible()
  const name = await frame.locator('.iv-row .iv-name b').first().textContent()
  await star.click()
  await expect(frame.locator('.iv-row .iv-name b').filter({ hasText: name! })).toHaveCount(0)
  await page.goto('/previews/property-observatory/index.html#map')
  await page.reload()
  await page.goto('/previews/property-observatory/index.html#watch')
  await expect(frame.locator('.iv-row')).not.toHaveCount(0)
  await expect(frame.locator('.iv-row .iv-name b').filter({ hasText: name! })).toHaveCount(0)
  expect(writes).toEqual([])
})
