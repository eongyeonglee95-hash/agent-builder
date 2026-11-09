import { expect, test, type BrowserContext, type Page } from '@playwright/test'
const SID = 'synthetic_common_sheet_123456789'
const dialog = (page: Page) => page.getByRole('dialog', { name: '구글 시트 연결', exact: true })
async function controls(page: Page, body: object) { const r = await page.request.post('/__share_fixture', { data: body }); expect(r.ok()).toBe(true); return r.json() }
async function guard(context: BrowserContext) {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
}
async function login(page: Page, person = '테스트 오너') {
  await page.goto('/#home')
  const opened = page.waitForEvent('popup')
  await page.getByRole('link', { name: 'Google로 로그인', exact: true }).click()
  const popup = await opened
  await popup.getByRole('link', { name: person, exact: true }).click()
  await expect.poll(() => popup.isClosed()).toBe(true)
  await expect(page.getByRole('button', { name: '로그인 계정', exact: true })).toBeVisible()
}
async function panel(page: Page) { await page.getByRole('button', { name: '구글 시트 연결 설정', exact: true }).click(); await expect(dialog(page)).toBeVisible() }
async function consent(page: Page) {
  await panel(page)
  await dialog(page).getByRole('button', { name: 'Google에서 접근 허용' }).click()
  await page.getByRole('link', { name: '테스트 오너', exact: true }).click()
  await expect(dialog(page).getByText('Google 파일 접근 동의가 완료됐어요.')).toBeVisible()
}
async function setupFile(page: Page) {
  await login(page); await consent(page)
  await dialog(page).getByRole('button', { name: '새 공통 시트 만들기' }).click()
  await expect(dialog(page).getByRole('link', { name: '연결된 Google 시트 열기' })).toBeVisible()
}
async function migrate(page: Page) {
  await dialog(page).getByRole('button', { name: '우리 자료', exact: true }).click()
  await dialog(page).getByRole('button', { name: '이전할 자료 대조' }).click()
  await expect(dialog(page).getByRole('heading', { name: '이전 전 대조' })).toBeVisible()
  await dialog(page).getByLabel('명의·건수·금액과 충돌 선택을 확인했어요').check()
  await dialog(page).getByRole('button', { name: '확인한 자료 이전' }).click()
  await expect(dialog(page).getByText('공유 자료 이전과 저장 후 대조를 마쳤어요.')).toBeVisible()
}
async function issue(page: Page) {
  await dialog(page).getByRole('button', { name: '배우자 초대', exact: true }).click()
  await dialog(page).getByLabel('배우자 이메일').fill('partner@example.test')
  await dialog(page).getByRole('button', { name: '초대 링크 만들기' }).click()
  return dialog(page).getByLabel('전달할 초대 링크').inputValue()
}
async function accept(page: Page, link: string, account = '테스트 배우자') {
  await page.goto(link)
  await expect(page).toHaveURL(/#invite$/)
  await page.getByRole('button', { name: 'Google로 초대 수락' }).click()
  await page.getByRole('link', { name: account, exact: true }).click()
}
async function picker(page: Page, action = 'picked', id = SID) {
  await controls(page, { picker: true })
  await page.route('https://apis.google.com/js/api.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.gapi={load:(_,o)=>o.callback()};
    window.google={picker:{ViewId:{SPREADSHEETS:'spreadsheets'},DocsView:class{constructor(id){if(id!=='spreadsheets')throw Error('wrong view')}},PickerBuilder:class{
      setOAuthToken(v){if(!v.startsWith('synthetic-'))throw Error('token');return this} setDeveloperKey(v){if(v!=='synthetic-picker-key')throw Error('key');return this}
      setAppId(v){if(v!=='1234567890')throw Error('project');return this} setOrigin(v){if(v!==location.origin)throw Error('origin');return this}
      setLocale(){return this} setTitle(){return this} setSize(){return this} addView(){return this} setCallback(fn){this.cb=fn;return this}
      build(){let el;const cb=this.cb;return {setVisible(){el=document.createElement('div');el.setAttribute('role','dialog');el.setAttribute('aria-label','합성 Google 파일 선택');el.style='position:fixed;inset:20px;background:white;z-index:2147483647;padding:20px';const btn=document.createElement('button');btn.textContent='파일 선택 결과';btn.onclick=()=>cb({action:${JSON.stringify(action)},docs:[{id:${JSON.stringify(id)}}]});el.append(btn);document.body.append(el);btn.focus()},dispose(){el?.remove()}}}
    }} };
  ` }))
}

test.beforeEach(async ({ page, context }) => { await guard(context); await controls(page, { reset: true, picker: false }) })

test('오너 시작·생성 응답 유실 재시도·재방문·동의 해제/재연결은 같은 파일', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await login(page); await consent(page)
  let lose = true
  await page.route('**/api/google/shared/spreadsheet', async route => {
    if (lose && route.request().method() === 'POST') { lose = false; await route.fetch(); await route.abort(); return }
    await route.continue()
  })
  await dialog(page).getByRole('button', { name: '새 공통 시트 만들기' }).click()
  await expect(dialog(page).getByRole('alert')).toBeVisible()
  await dialog(page).getByRole('button', { name: '새 공통 시트 만들기' }).click()
  await expect(dialog(page).getByRole('link', { name: '연결된 Google 시트 열기' })).toHaveAttribute('href', new RegExp(SID))
  expect((await controls(page, {})).creates).toBe(1)
  await dialog(page).getByRole('button', { name: '내 파일 접근 동의 해제' }).click()
  await dialog(page).getByRole('button', { name: '동의 해제 확인' }).click()
  await expect(dialog(page).getByRole('button', { name: 'Google에서 접근 허용' })).toBeVisible()
  await expect(dialog(page).getByRole('link', { name: '연결된 Google 시트 열기' })).toHaveAttribute('href', new RegExp(SID))
  await page.reload(); await panel(page)
  await dialog(page).getByRole('button', { name: 'Google에서 접근 허용' }).click()
  await page.getByRole('link', { name: '테스트 오너', exact: true }).click()
  await expect(dialog(page).getByText('같은 공통 시트가 연결되어 있어요.', { exact: false })).toBeVisible()
  expect((await controls(page, {})).creates).toBe(1)
  await controls(page, { status: 503 })
  await dialog(page).getByRole('button', { name: '연결 상태 다시 확인' }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('기존 연결은 유지')
  await expect(dialog(page).getByRole('button', { name: '새 공통 시트 만들기' })).toHaveCount(0)
  await controls(page, { status: 200 })
  await dialog(page).getByRole('button', { name: '연결 상태 다시 확인' }).click()
  await expect(dialog(page).getByRole('alert')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Picker 미설정·로딩 실패·취소·오너/양식 거부·선택 ID 서버 검증', async ({ page }) => {
  await controls(page, { reset: true, empty: false })
  await login(page); await consent(page)
  const select = () => dialog(page).getByRole('button', { name: 'Google에서 기존 시트 선택' }).click()
  await select(); await expect(dialog(page).getByRole('alert')).toContainText('Picker API 키와 프로젝트 번호')
  await controls(page, { picker: true }); await select()
  await expect(dialog(page).getByRole('alert')).toContainText('선택창을 열지 못했어요')
  await picker(page, 'cancel'); await select(); await page.getByRole('button', { name: '파일 선택 결과' }).click()
  await expect(dialog(page).getByText('파일 선택을 취소했어요.', { exact: false })).toBeVisible()
  // Reset the loaded fake library to configure the next picker response.
  await page.reload(); await panel(page); await picker(page)
  await controls(page, { owned: false }); await select(); await page.getByRole('button', { name: '파일 선택 결과' }).click()
  await expect(dialog(page).getByRole('alert')).toContainText('고정 오너')
  await controls(page, { owned: true, headers_valid: false }); await select(); await page.getByRole('button', { name: '파일 선택 결과' }).click()
  await expect(dialog(page).getByRole('alert')).toBeVisible()
  await controls(page, { headers_valid: true }); await select(); await page.getByRole('button', { name: '파일 선택 결과' }).click()
  await expect(dialog(page).getByRole('link', { name: '연결된 Google 시트 열기' })).toHaveAttribute('href', new RegExp(SID))
  expect((await controls(page, {})).creates).toBe(0)
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toMatch(/synthetic-.*token|picker-key/)
})

test('이전·두 사람 첫 흐름과 재방문·나/배우자·고정 지분·개인 편집 허용', async ({ page, browser }) => {
  await setupFile(page); await migrate(page)
  const link = await issue(page)
  const context = await browser.newContext(); await guard(context); const partner = await context.newPage()
  await accept(partner, link)
  await expect(partner.getByRole('button', { name: '로그인 계정', exact: true })).toBeVisible()
  await expect(partner.getByRole('region', { name: '자산 요약' })).toContainText('1,300만원')
  await partner.getByRole('group', { name: '자산 소유자 선택' }).getByRole('button', { name: '나', exact: true }).click()
  await expect(partner.getByRole('heading', { name: '배우자 이름의 자산 현황' })).toBeVisible()
  await expect(partner.getByRole('region', { name: '자산 요약' })).toContainText('800만원')
  await expect(partner.locator('.retirement-card')).toContainText('배우자 기준')
  await panel(partner); await dialog(partner).getByRole('button', { name: '우리 자료', exact: true }).click()
  await expect(dialog(partner).getByText('나:')).toContainText('배우자 이름')
  await expect(dialog(partner).getByRole('button', { name: '배우자 정보 수정' })).toBeDisabled()
  await dialog(partner).getByRole('button', { name: '내 정보 수정' }).click()
  await dialog(partner).getByLabel('이름', { exact: true }).fill('배우자 수정 이름')
  await dialog(partner).getByRole('button', { name: '가족 정보 저장' }).click()
  await expect(dialog(partner).getByText('가족 정보를 저장했어요.')).toBeVisible()
  // A rejected permission change must restore the checkbox and keep server access unchanged.
  await partner.route('**/api/shared-data/permissions', route => route.fulfill({ status: 409, json: { detail: '편집 허용 저장에 실패했어요.' } }))
  await dialog(partner).getByLabel('배우자가 내 자료를 앱에서 편집하도록 허용').check()
  await expect(dialog(partner).getByRole('alert')).toContainText('편집 허용 저장에 실패')
  await expect(dialog(partner).getByLabel('배우자가 내 자료를 앱에서 편집하도록 허용')).not.toBeChecked()
  const unchanged = await (await partner.request.get('/api/shared-data')).json()
  expect(unchanged.permissions[unchanged.viewer.me]).toBe(false)
  await partner.unroute('**/api/shared-data/permissions')
  await dialog(partner).getByLabel('배우자가 내 자료를 앱에서 편집하도록 허용').check()
  await expect(dialog(partner).getByText('내 자료의 앱 편집 허용을 변경했어요.')).toBeVisible()
  await dialog(page).getByRole('button', { name: '우리 자료', exact: true }).click()
  await expect(dialog(page).getByRole('button', { name: '배우자 정보 수정' })).toBeEnabled()
  await expect(dialog(page).getByText('배우자 · 배우자 수정 이름', { exact: true })).toBeVisible()
  await dialog(partner).getByRole('button', { name: '닫기', exact: true }).click()
  await partner.getByRole('button', { name: '로그인 계정', exact: true }).click()
  await expect(partner.getByRole('dialog')).toContainText('배우자')
  await partner.getByRole('button', { name: '로그아웃', exact: true }).click()
  await login(partner, '테스트 배우자')
  await panel(partner); await expect(dialog(partner).getByRole('link', { name: '연결된 Google 시트 열기' })).toHaveAttribute('href', new RegExp(SID))
  await expect(dialog(partner).getByRole('button', { name: '새 공통 시트 만들기' })).toHaveCount(0)
  await context.close()
})

test('초대 취소·대상 거부·만료 안내와 성공처럼 보이는 URL 거부', async ({ page, browser }) => {
  await setupFile(page)
  const link = await issue(page)
  const context = await browser.newContext(); await guard(context); const partner = await context.newPage()
  await accept(partner, link, '취소')
  await expect(partner.getByRole('alert')).toContainText('취소')
  await accept(partner, link, '테스트 외부 계정')
  await expect(partner.getByRole('alert')).toContainText('초대받은 이메일')
  await dialog(page).getByRole('button', { name: '초대 취소', exact: true }).click()
  await dialog(page).getByRole('button', { name: '확인하고 진행' }).click()
  await partner.goto(link); await partner.getByRole('button', { name: 'Google로 초대 수락' }).click()
  await expect(partner.getByRole('alert')).toContainText('취소')
  const renewed = await issue(page)
  await controls(page, { expire: true })
  await partner.goto(renewed); await partner.getByRole('button', { name: 'Google로 초대 수락' }).click()
  await expect(partner.getByRole('alert')).toContainText('만료')
  await partner.goto('/?invitation=ready#home')
  await expect(partner.getByRole('link', { name: 'Google로 로그인', exact: true })).toBeVisible()
  expect((await partner.request.get('/api/shared-data')).status()).toBe(401)
  await context.close()
})

test('가입 대기 새로고침·Picker 같은 파일 검사·공유 재개·앱/Drive 해제 분리', async ({ page, browser }) => {
  await setupFile(page); await migrate(page); const link = await issue(page)
  await controls(page, { member_access: false })
  const context = await browser.newContext(); await guard(context); const partner = await context.newPage()
  await accept(partner, link)
  await expect(partner.getByText('아직 가입이 끝나지 않았어요.', { exact: false })).toBeVisible()
  await partner.reload()
  await partner.getByRole('button', { name: '공유 확인 후 합류' }).click()
  await expect(partner.getByRole('alert')).toBeVisible()
  await partner.getByRole('button', { name: '공통 시트 접근 승인' }).click()
  await expect(partner.getByRole('alert')).toContainText('Picker API 키')
  await picker(partner, 'picked', 'synthetic_other_sheet_123456789')
  await partner.getByRole('button', { name: '공통 시트 접근 승인' }).click()
  await partner.getByRole('button', { name: '파일 선택 결과' }).click()
  await expect(partner.getByRole('alert')).toContainText('이미 연결된')
  await partner.reload(); await picker(partner); await controls(page, { member_access: true })
  await partner.getByRole('button', { name: '공통 시트 접근 승인' }).click(); await partner.getByRole('button', { name: '파일 선택 결과' }).click()
  await expect(partner.getByRole('button', { name: '로그인 계정' })).toBeVisible()
  await dialog(page).getByRole('button', { name: '초대 상태 다시 확인' }).click()
  await controls(page, { fail_delete: true })
  await dialog(page).getByRole('button', { name: '배우자 접근 해제' }).click()
  await dialog(page).getByRole('button', { name: '확인하고 진행' }).click()
  await expect(dialog(page).getByText('앱 접근은 차단했습니다.', { exact: false })).toBeVisible()
  expect((await partner.request.get('/api/shared-data')).status()).toBe(401)
  await partner.reload(); await expect(partner.getByRole('link', { name: 'Google로 로그인', exact: true })).toBeVisible()
  await controls(page, { fail_delete: false })
  await dialog(page).getByRole('button', { name: '공유 정리 다시 확인' }).click()
  await expect(dialog(page).getByText('앱 접근 차단과 앱 공유 권한 정리를 확인했습니다.')).toBeVisible()
  await context.close()
})

test('수정 충돌은 초안 유지·다시 읽기·백업 대조 복구', async ({ page }) => {
  await setupFile(page); await migrate(page)
  const p = dialog(page)
  await p.getByRole('button', { name: '내 정보 수정' }).click()
  await p.getByLabel('이름', { exact: true }).fill('충돌 초안')
  // A second browser-equivalent write changes the server revision.
  await page.evaluate(async () => {
    const session = await (await fetch('/api/auth/session')).json()
    const data = await (await fetch('/api/shared-data')).json()
    const r = data.state.records.find((r: { kind: string; member_id: string }) => r.kind === 'profile' && r.member_id === data.viewer.me)
    await fetch('/api/shared-data/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Retire-CSRF': session.csrf_token }, body: JSON.stringify({ operation_id: crypto.randomUUID(), expected_revision: data.revision, upsert: [{ ...r, payload: { ...r.payload, name: '다른 창 이름' } }] }) })
  })
  await p.getByRole('button', { name: '가족 정보 저장' }).click()
  await expect(p.getByRole('alert')).toContainText('다른 화면이나 시트')
  await expect(p.getByLabel('이름', { exact: true })).toHaveValue('충돌 초안')
  await p.getByRole('button', { name: '최신 공유 자료 다시 읽기' }).click()
  await expect(p.getByText('나 · 다른 창 이름', { exact: true })).toBeVisible()
  await p.getByText('백업 대조·복구', { exact: true }).click()
  await p.getByRole('button', { name: '백업 목록 확인' }).click()
  await p.getByLabel('복구할 백업').selectOption({ index: 1 })
  await expect(p.getByLabel('복구 버전')).toBeVisible()
  await p.getByLabel('이 버전의 명의·건수·금액으로 복구할게요').check()
  await p.getByRole('button', { name: '확인한 백업 복구' }).click()
  await expect(p.getByText('백업 복구와 대조를 마쳤어요.')).toBeVisible()
  await expect(p.getByText('나 · 오너 이름', { exact: true })).toBeVisible()
})

test('360/390/1440px·키보드 파일/초대/자료 화면·JSON 입력 없음', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await setupFile(page); await migrate(page)
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 900 })
    for (const tab of ['공통 시트', '우리 자료', '배우자 초대']) {
      const button = dialog(page).getByRole('button', { name: tab, exact: true })
      await button.focus(); await page.keyboard.press('Enter')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await dialog(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
      await expect(dialog(page).locator('textarea')).toHaveCount(0)
      await page.keyboard.press('Tab')
      expect(await dialog(page).evaluate(el => el.contains(document.activeElement))).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`share-${width}-${tab}.png`), animations: 'disabled' })
    }
  }
  await page.keyboard.press('Escape'); await expect(dialog(page)).toBeHidden()
  expect(errors).toEqual([])
})


test('이전 충돌 선택 뒤 실제 선택 합계 재대조를 거쳐 확정', async ({ page }) => {
  await setupFile(page)
  await controls(page, { legacy_conflict: true })
  const p = dialog(page)
  await p.getByRole('button', { name: '우리 자료', exact: true }).click()
  await p.getByRole('button', { name: '이전할 자료 대조' }).click()
  await expect(p.getByRole('button', { name: '확인한 자료 이전' })).toBeDisabled()
  await p.getByRole('radio', { name: /기존 시트 자료/ }).check()
  await expect(p.getByLabel('명의·건수·금액과 충돌 선택을 확인했어요')).toBeDisabled()
  await p.getByRole('button', { name: '선택 결과 대조' }).click()
  await expect(p.getByText('오너 이름 · 자산 150만원 / 대출 0원', { exact: true }).last()).toBeVisible()
  await p.getByLabel('명의·건수·금액과 충돌 선택을 확인했어요').check()
  await p.getByRole('button', { name: '확인한 자료 이전' }).click()
  await expect(p.getByText('공유 자료 이전과 저장 후 대조를 마쳤어요.')).toBeVisible()
})
