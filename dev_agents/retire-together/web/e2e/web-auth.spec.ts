import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  test.skip(!process.env.RETIRE_AUTH_BROWSER_TEST, '전용 auth.playwright.config.ts로 실행')
  // Block unrelated external requests as an additional guard around the local IdP.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
})
async function login(page: Page, account = '테스트 오너') {
  const original = page.url()
  const opened = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'Google로 로그인', exact: true }).click()
  const popup = await opened
  await expect(popup).toHaveURL(/^http:\/\/localhost:\d+\//)
  await popup.getByRole('link', { name: account, exact: true }).click()
  await expect.poll(() => popup.isClosed()).toBe(true)
  expect(page.url()).toBe(original)
}
async function identity(page: Page) {
  return page.evaluate(async () => (await fetch('/api/auth/session')).json())
}

test('첫 로그인 화면 → 오너 생성 → 실제 화면 저장 → 재로그인 → 로그아웃', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const privateReads: string[] = []
  page.on('request', r => { if (/\/api\/(family|assets|workbook\/)/.test(r.url())) privateReads.push(r.url()) })
  await page.goto('/#home')
  await expect(page.getByText('처음 로그인하는 본인 계정', { exact: false })).toBeVisible()
  expect(privateReads).toEqual([])
  await expect(page.locator('.auth-scenery')).toHaveJSProperty('complete', true)
  expect(await page.locator('.auth-scenery').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: width < 500 ? 780 : 900 })
    await expect(page.getByRole('link', { name: 'Google로 로그인' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Google로 로그인' })).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`login-${width}.png`), animations: 'disabled' })
  }
  await login(page)
  await expect(page.getByRole('button', { name: '로그인 계정', exact: true })).toBeVisible()
  const first = await identity(page)
  expect(first.role).toBe('owner')
  expect(await page.evaluate(() => document.cookie)).not.toContain('retire_session')
  const cookie = (await page.context().cookies()).find(c => c.name === 'retire_session_local')!
  expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe('Lax')
  // The welcome preview displays no private data and preserves the existing session.
  await page.goto('/?view=welcome#home')
  await expect(page.getByRole('button', { name: '나의 가계 노트 열기' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Google로 로그인' })).toHaveCount(0)
  expect((await page.context().cookies()).find(c => c.name === 'retire_session_local')!.value).toBe(cookie.value)
  await page.getByRole('button', { name: '나의 가계 노트 열기' }).click()
  await expect(page).toHaveURL(/\/#home$/)
  await expect(page.getByRole('button', { name: '로그인 계정', exact: true })).toBeVisible()
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`authenticated-${width}.png`), animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/#home')
  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /직접 입력/ }).click()
  await dialog.locator('[name="account"]').fill('인증 검수 연금')
  await dialog.locator('[name="amount"]').fill('10000000')
  await dialog.getByRole('button', { name: '입력 내용 확인' }).click()
  const saved = page.waitForResponse(r => r.url().endsWith('/api/assets') && r.request().method() === 'POST')
  await dialog.getByRole('button', { name: '저장하기', exact: true }).click()
  const result = await saved
  expect(result.status()).toBe(201)
  expect(result.request().headers()['x-retire-csrf']).toBe(first.csrf_token)
  await expect(dialog).toBeHidden()
  await page.reload()
  await expect(page.locator('.stat-number').first()).toContainText('1,000만원')
  // HTTP cookie rotation and immutable owner identity through a second round trip.
  await page.goto('/api/auth/google/login')
  await page.getByRole('link', { name: '테스트 오너', exact: true }).click()
  await expect(page.getByRole('button', { name: '로그인 계정', exact: true })).toBeVisible()
  const again = await identity(page)
  expect(again.user_id).toBe(first.user_id); expect(again.member_id).toBe(first.member_id)
  expect((await page.context().cookies()).find(c => c.name === 'retire_session_local')!.value).not.toBe(cookie.value)
  expect(await page.evaluate(async () => (await fetch('/api/auth/logout', { method: 'POST' })).status)).toBe(403)
  await page.getByRole('button', { name: '로그인 계정', exact: true }).click()
  await expect(dialog).toContainText('owner@example.test')
  await dialog.getByRole('button', { name: '로그아웃', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Google로 로그인' })).toBeVisible()
  expect(await page.evaluate(async () => (await fetch('/api/family')).status)).toBe(401)
  expect((await page.context().cookies()).some(c => c.name === 'retire_session_local')).toBe(false)
  expect(errors).toEqual([])
})

test('다른 계정과 취소는 로그인 화면으로 복귀하며 가계 자료를 노출하지 않는다', async ({ page }) => {
  await page.goto('/?view=welcome')
  await login(page, '테스트 외부 계정')
  await expect(page.getByRole('alert')).toContainText('등록된 계정이 아닙니다')
  expect(await page.evaluate(async () => (await fetch('/api/family')).status)).toBe(401)
  await login(page, '취소')
  await expect(page.getByRole('alert')).toContainText('취소되었거나')
  expect(await page.evaluate(() => location.search)).toBe('?view=welcome')
  await expect(page.getByRole('link', { name: 'Google로 로그인' })).toBeVisible()
})

test('로그인 설정 조회 실패는 가계 화면 대신 재시도 화면을 보여준다', async ({ page }) => {
  await page.route('**/api/auth/status', r => r.fulfill({ status: 503, json: { detail: 'test' } }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('설정을 확인할 수 없습니다')
  await expect(page.getByRole('button', { name: '로그인 계정' })).toHaveCount(0)
  await page.unroute('**/api/auth/status')
  await page.getByRole('button', { name: '다시 확인' }).click()
  await expect(page.getByRole('link', { name: 'Google로 로그인' })).toBeVisible()
})

test('업로드 전송도 CSRF를 포함하고 세션 만료 시 로그인을 다시 요구한다', async ({ page }) => {
  await page.goto('/')
  await login(page)
  await expect(page.getByRole('button', { name: '로그인 계정' })).toBeVisible()
  await page.goto('/#assets')
  await page.getByRole('button', { name: '자산 등록', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /엑셀·CSV 파일/ }).click()
  await dialog.locator('input[type=file]').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('invalid\nfixture') })
  const uploaded = page.waitForResponse(r => r.url().includes('/api/register/file') && r.request().method() === 'POST')
  await dialog.getByRole('button', { name: '표로 바꾸기' }).click()
  const response = await uploaded
  expect(response.status()).not.toBe(403)
  expect(response.status()).not.toBe(401)
  expect(response.request().headers()['x-retire-csrf']).toBeTruthy()
  expect(response.request().headers()['content-type']).toContain('multipart/form-data; boundary=')
  await dialog.getByRole('button', { name: '닫기', exact: true }).click()
  await page.context().clearCookies()
  await page.getByRole('button', { name: '표로 보기', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Google로 로그인' })).toBeVisible()
})


test('팝업 차단 시 같은 탭에서 로그인하고 메인으로 돌아온다', async ({ page }) => {
  await page.addInitScript(() => { window.open = () => null })
  await page.goto('/')
  await page.getByRole('link', { name: 'Google로 로그인', exact: true }).click()
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\//)
  await page.getByRole('link', { name: '테스트 오너', exact: true }).click()
  await expect(page.getByRole('button', { name: '로그인 계정' })).toBeVisible()
  await expect(page.getByRole('region', { name: '자산 요약' })).toBeVisible()
  await expect(page.getByRole('grid', { name: '요약 시트' })).toHaveCount(0)
})

test('팝업 닫기·재시도와 opener 단절을 처리하고 위조 완료 메시지는 무시한다', async ({ page }) => {
  await page.goto('/')
  let opened = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'Google로 로그인', exact: true }).click()
  let popup = await opened
  await expect(popup).toHaveURL(/^http:\/\/localhost:\d+\//)
  await page.evaluate(() => window.postMessage({ type: 'retire:login-result', error: '' }, location.origin))
  await popup.evaluate(() => window.opener.postMessage({ type: 'retire:login-result', error: '' }, '*'))
  await expect(page.getByRole('button', { name: '로그인 계정' })).toHaveCount(0)
  expect(await page.evaluate(async () => (await fetch('/api/auth/session')).status)).toBe(401)
  await popup.close()
  await expect(page.getByRole('status')).toContainText('다시 눌러')
  opened = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'Google로 로그인', exact: true }).click()
  popup = await opened
  await expect(popup).toHaveURL(/^http:\/\/localhost:\d+\//)
  await popup.evaluate(() => { window.opener = null })
  await popup.getByRole('link', { name: '테스트 오너', exact: true }).click()
  await expect(page.getByRole('button', { name: '로그인 계정' })).toBeVisible()
})
