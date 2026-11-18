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
  test(`부동산 5개 메뉴와 하위 보기 · ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto('/#property')
    const menu = page.getByRole('navigation', { name: '부동산 메뉴' })
    const frame = page.frameLocator('iframe[title="부동산 관측실 화면"]')
    await expect(menu.getByRole('button')).toHaveCount(5)
    for (const label of ['내 부동산', '갈아타기 계획', '관심 단지', '매물·소식', '시장·리서치']) {
      await menu.getByRole('button', { name: label, exact: true }).click()
      await expect(menu.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-current', 'page')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    }
    for (const [label, id] of [['시장 동향', 'market'], ['주간·월간', 'journal'], ['리서치 노트', 'research']]) {
      await page.getByRole('group', { name: '부동산 보기' }).getByRole('button', { name: label }).click()
      await expect.poll(() => frame.locator('html').evaluate(() => location.hash)).toBe('#' + id)
    }
    await menu.getByRole('button', { name: '관심 단지', exact: true }).click()
    await expect(page.getByLabel('관심 단지 검색')).toBeVisible()
    await page.getByRole('button', { name: '지도', exact: true }).click()
    await expect.poll(() => frame.locator('html').evaluate(() => location.hash)).toBe('#map')
    await menu.getByRole('button', { name: '매물·소식' }).click()
    await expect(frame.locator('#sg-source-panel')).toBeVisible()
    await expect.poll(() => frame.locator('body').evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: test.info().outputPath(`property-menu-${width}.png`), fullPage: true })
    expect(errors).toEqual([])
  })
}

test('이전 팔로우 메뉴 복원과 통합 정보원 필터·저장 유지', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('property-menu', 'voices'))
  await page.goto('/#property')
  const menu = page.getByRole('navigation', { name: '부동산 메뉴' })
  await expect(menu.getByRole('button', { name: '매물·소식' })).toHaveAttribute('aria-current', 'page')
  const frame = page.frameLocator('iframe[title="부동산 관측실 화면"]')
  await expect(frame.locator('.sg-table tbody tr')).toHaveCount(18)
  await frame.locator('#sg-followed-only').check()
  await frame.locator('#sg-source-panel summary').click()
  await frame.getByLabel('유다로 팔로우').uncheck()
  await expect(frame.locator('.sg-table tbody tr')).toHaveCount(0)
  await expect(frame.locator('#sg-source-panel')).toHaveAttribute('open', '')
  await page.reload()
  await frame.locator('#sg-source-panel summary').click()
  await expect(frame.getByLabel('유다로 팔로우')).not.toBeChecked()
  await frame.getByLabel('유다로 팔로우').check()
  await frame.locator('#sg-followed-only').check()
  await expect(frame.locator('.sg-table tbody tr')).toHaveCount(18)
})

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
