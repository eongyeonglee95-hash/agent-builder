import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page, request }) => {
  const current = await (await request.get('/api/property-move')).json()
  await request.put('/api/property-move', { data: { version: current.plan.version, candidates: [], source_home_ids: [] } })
  const homes = await (await request.get('/api/property')).json()
  for (const h of homes.homes) await request.delete(`/api/property/${h.asset.id}?version=${h.asset.version}`)
  await page.route('**/api/property/trades?**', route => route.fulfill({ json: { configured: true, trades: [
    { name: '검증용 햇살아파트', date: '2026-10-15', price: 820000000, area: 84, floor: 12, kind: '중개거래' },
    { name: '검증용 햇살아파트', date: '2026-09-10', price: 790000000, area: 84, floor: 8, kind: '중개거래' },
    { name: '검증용 햇살아파트', date: '2026-07-12', price: 800000000, area: 84, floor: 16, kind: '중개거래' },
  ] } }))
  await page.route('**/api/property/market/listings?**', route => route.fulfill({ json: { status: 'unmatched', source: '부동산뱅크', source_url: 'https://neonet.co.kr', fetched_at: new Date().toISOString(), partial: false, listings: [], summary: null } }))
  await page.route('https://t1.daumcdn.net/**', route => route.abort())
})

test('빈 장부에서 기존 집 등록 흐름을 열고 저장한다', async ({ page, request }) => {
  await page.goto('/#property')
  await expect(page.getByRole('heading', { name: '우리 집을 모두 팔면' })).toBeVisible()
  await expect(page.locator('.property-move-funds-own strong')).toHaveText('—')
  await page.getByRole('button', { name: '우리 집 등록', exact: true }).click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: '주소 없이 이름만 적기' }).click()
  await modal.getByLabel('부를 이름').fill('검증용 처음 등록한 집')
  await modal.getByRole('button', { name: '다음', exact: true }).click()
  await modal.getByRole('button', { name: /단독$/ }).first().click()
  await modal.getByRole('button', { name: '다음', exact: true }).click()
  await modal.locator('.pe-money-input input').fill('50000')
  await modal.getByRole('button', { name: '다음', exact: true }).click()
  await modal.getByRole('button', { name: '다음', exact: true }).click()
  await modal.getByRole('button', { name: '확인하러 가기' }).click()
  await modal.getByRole('button', { name: '저장하기', exact: true }).click()
  await expect(modal).not.toBeVisible()
  await expect(page.locator('.property-move-home-list')).toContainText('검증용 처음 등록한 집')
  await expect(page.locator('.property-move-home-list')).toContainText('시세 확인 필요')
  const h = (await (await request.get('/api/property')).json()).homes[0]
  expect(h.full_value).toBe(500000000)
  expect(h.detail.value_source.kind).toBe('purchase')
})

test('기존 가격 자료·자금 계산과 단순 등록·수정·화면 폭', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  const today = new Date().toLocaleDateString('sv-SE')
  const h = await (await request.post('/api/property', { data: { request_id: crypto.randomUUID(), name: '검증용 햇살아파트', owner: 'joint', share_percent: 50, value: 800000000, purchase_price: 600000000, purchase_month: '2019-05', area_m2: 84,
    address: { road: '검증시 검증구 햇살로 1', jibun: '검증시 검증구 검증동 1', building: '검증용 햇살아파트', sigungu_code: '11110', apartment: true }, new_loans: [{ name: '검증용 주택대출', amount: 200000000 }] } })).json()
  await request.put(`/api/property/${h.asset.id}/listings`, { data: { detail_version: h.detail.version, listings: [{ price: 850000000, floor: '고층', memo: '검증용', checked_on: today }, { price: 870000000, floor: '12층', memo: '검증용', checked_on: today }] } })
  await page.goto('/#property')
  const homeLine = page.locator('.property-move-home-line')
  await expect(homeLine).toContainText('8억 2,000만원')
  await expect(homeLine).toContainText('8억 5,000만원 ~ 8억 7,000만원')
  await homeLine.getByRole('button', { name: /상세 보기/ }).click()
  await expect(page.getByRole('heading', { name: '실거래 리포트' })).toBeVisible()
  await expect(page.getByRole('img', { name: /최근 3건 실거래/ })).toBeVisible()
  await homeLine.getByRole('button', { name: /상세 접기/ }).click()
  await page.getByRole('button', { name: '비교할 아파트 추가', exact: true }).click()
  let modal = page.getByRole('dialog')
  await modal.getByLabel('단지 이름', { exact: true }).fill('검증용 강변아파트')
  await modal.getByLabel('전용면적 (㎡)').fill('84')
  await modal.getByRole('button', { name: '후보 저장' }).click()
  await expect(modal).not.toBeVisible()
  // 기존에 저장된 가격 자료의 계산은 유지한다. 신규 등록창은 가격을 입력받지 않는다.
  let legacy = (await (await request.get('/api/property-move')).json()).plan
  legacy.candidates[0] = { ...legacy.candidates[0], price: 1100000000, purchase_costs: 30000000 }
  await request.put('/api/property-move', { data: legacy })
  await page.reload()
  await page.getByRole('button', { name: '자금·시점 설정' }).click()
  modal = page.getByRole('dialog')
  await modal.getByRole('checkbox', { name: /검증용 햇살아파트/ }).check()
  await modal.getByLabel('이사에 쓸 모아둔 돈', { exact: true }).fill('20000')
  await modal.getByLabel('매도세금·비용', { exact: true }).fill('1000')
  await modal.getByLabel('추가 대출 가정', { exact: true }).fill('5000')
  await modal.getByLabel('이사 목표 시점').fill('2030-11')
  await modal.getByLabel('매달 더 모을 돈', { exact: true }).fill('300')
  await modal.getByRole('button', { name: '자금 계획 저장' }).click()
  await expect(page.locator('.property-move-funds-own strong')).toHaveText('7억 9,000만원')
  await expect(page.locator('.property-move-funds-saving strong')).toHaveText('1억 4,400만원')
  await expect(page.locator('.property-move-funds-reach strong')).toHaveText('지금 닿는 곳 0곳')
  // 계획 저장이 오늘 기록을 자동으로 남긴다: 격차 = 11억 − 등록 시세 8억, 더 필요한 돈 = 2.9억
  const targetLine = page.locator('.property-move-candidate-line').filter({ hasText: '검증용 강변아파트' })
  await expect(targetLine.locator('.property-move-diff-cell strong')).toHaveText('+3억원')
  await targetLine.getByRole('button', { name: '검증용 강변아파트 분석 보기' }).click()
  const trackTable = page.getByRole('table', { name: '검증용 강변아파트 추적 기록' })
  await expect(trackTable.locator('tbody tr')).toHaveCount(1)
  await expect(trackTable.locator('tbody tr').first()).toContainText(today)
  await expect(trackTable.locator('tbody tr').first()).toContainText('2억 9,000만원')
  // 호가 한 번 적으면 후보의 호가가 갱신되고 같은 날 기록이 호가 기준으로 덮어써진다
  await targetLine.getByLabel('검증용 강변아파트 호가 (만원)').fill('112000')
  await targetLine.getByRole('button', { name: '호가로 기록' }).click()
  await expect(targetLine).toContainText('11억 2,000만원')
  await expect(trackTable.locator('tbody tr')).toHaveCount(1)
  await expect(trackTable.locator('tbody tr').first()).toContainText('호가')
  await expect(trackTable.locator('tbody tr').first()).toContainText('+3억 2,000만원')
  // 거주 정보는 직접 적은 메모로 저장되고 새로고침 후에도 남는다
  await targetLine.getByLabel('학군·통학').fill('검증초 도보 5분')
  await targetLine.getByRole('button', { name: '거주 정보 저장' }).click()
  await expect(targetLine.getByRole('button', { name: '거주 정보 저장' })).toHaveCount(0)
  await targetLine.getByRole('button', { name: '검증용 강변아파트 분석 접기' }).click()
  await page.getByRole('button', { name: '비교할 아파트 추가', exact: true }).click()
  modal = page.getByRole('dialog')
  await modal.getByLabel('단지 이름', { exact: true }).fill('검증용 공원아파트')
  await modal.getByLabel('전용면적 (㎡)').fill('74')
  await modal.getByRole('button', { name: '후보 저장' }).click()
  await expect(modal).not.toBeVisible()
  legacy = (await (await request.get('/api/property-move')).json()).plan
  legacy.candidates[1] = { ...legacy.candidates[1], price: 950000000, purchase_costs: 20000000, asking_low: 930000000, asking_high: 980000000, asking_date: today }
  await request.put('/api/property-move', { data: legacy })
  await page.reload()
  const lower = page.locator('.property-move-candidate-line').filter({ hasText: '검증용 공원아파트' })
  await expect(lower.locator('.property-move-gap-cell')).toContainText('1억 3,000만원')
  await expect(lower.locator('.property-move-future-cell strong')).toHaveText('0원')
  // 기본 정렬은 더 필요한 돈 적은 순: 공원아파트가 먼저
  await expect(page.locator('.property-move-candidate-line').first()).toContainText('검증용 공원아파트')
  await expect(page.locator('.property-move-funds-reach strong')).toHaveText('지금 닿는 곳 0곳')
  await expect(page.locator('.property-move-funds-reach')).toContainText('목표 시점엔 1곳')
  for (const width of [1440, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => window.scrollTo(0, 0))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: test.info().outputPath(`property-move-${width}.png`), fullPage: true })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await expect(page.locator('.property-move-candidate-line').first()).toContainText('검증용 공원아파트')
  await targetLine.getByRole('button', { name: '검증용 강변아파트 분석 보기' }).click()
  await expect(targetLine.getByLabel('학군·통학')).toHaveValue('검증초 도보 5분')
  await targetLine.getByRole('button', { name: '검증용 강변아파트 분석 접기' }).click()
  // 저장 오류가 초안을 지우거나 창을 닫지 않는다. 모바일 입력창도 화면에 들어온다.
  await page.setViewportSize({ width: 390, height: 850 })
  await lower.locator('.property-move-candidate-name').click()
  modal = page.getByRole('dialog')
  await modal.getByLabel('비교 메모').fill('검증용 저장 실패 후 유지할 메모')
  await page.route('**/api/property-move?owner=together', route => route.request().method() === 'PUT' ? route.fulfill({ status: 409, json: { detail: '다른 화면에서 변경되었어요.' } }) : route.continue())
  await modal.getByRole('button', { name: '후보 저장' }).click()
  await expect(modal.getByRole('alert')).toContainText('다른 화면에서 변경')
  await expect(modal.getByLabel('비교 메모')).toHaveValue('검증용 저장 실패 후 유지할 메모')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.unroute('**/api/property-move?owner=together')
  await modal.getByRole('button', { name: '후보 저장' }).click()
  await expect(modal).not.toBeVisible()
  const preserved = (await (await request.get('/api/property-move')).json()).plan.candidates.find((c: { name: string }) => c.name === '검증용 공원아파트')
  expect(preserved.price).toBe(950000000)
  expect(preserved.purchase_costs).toBe(20000000)
  expect(preserved.asking_low).toBe(930000000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByLabel('자산 소유자 선택').selectOption('me')
  await expect(page.locator('.property-move-candidate-line')).toHaveCount(0)
  await expect(page.locator('.property-move-funds-own strong')).toHaveText('—')
  expect(errors).toEqual([])
})

test('거래 조회 실패·무거래·미연결 상태에서 가격을 지어내지 않는다', async ({ page, request }) => {
  await request.post('/api/property', { data: { request_id: crypto.randomUUID(), name: '검증용 거래 없는 집', owner: 'me', value: 500000000, area_m2: 84, address: { road: '검증용', building: '검증용', sigungu_code: '11110' } } })
  for (const mode of ['error', 'empty', 'unconfigured']) {
    await page.unroute('**/api/property/trades?**')
    await page.route('**/api/property/trades?**', route => mode === 'error' ? route.fulfill({ status: 503, json: { detail: '검증용 조회 실패' } }) : route.fulfill({ json: { configured: mode !== 'unconfigured', trades: [] } }))
    await page.goto('/#property')
    await page.reload()
    await expect(page.locator('.property-move-home-line')).toContainText(mode === 'error' ? '조회 실패' : mode === 'empty' ? '최근 12개월 일치 거래 미확인' : '실거래 연결 설정 필요')
  }
})

test('전체 매도 합계·공개 매물·이름 검색 후 평형만 등록하며 장부를 바꾸지 않는다', async ({ page, request }) => {
  const address = { road: '검증시 검증구 햇살로 1', jibun: '검증시 검증구 검증동 1', building: '검증용 햇살아파트', sigungu_code: '11110', bcode: '1111010100', apartment: true }
  await request.post('/api/property', { data: { request_id: crypto.randomUUID(), name: '검증용 햇살아파트', owner: 'joint', share_percent: 50, value: 800000000, area_m2: 84, address, new_loans: [{ name: '검증용 담보대출', amount: 200000000 }] } })
  await request.post('/api/property', { data: { request_id: crypto.randomUUID(), name: '검증용 두 번째 집', owner: 'partner', value: 500000000, area_m2: 59, tenure: 'jeonse', deposit: 100000000 } })
  const before = (await (await request.get('/api/property')).json()).homes
  await page.route('**/api/property/market/listings?**', route => route.fulfill({ json: {
    status: 'matched', source: '부동산뱅크', source_url: 'https://neonet.co.kr', fetched_at: '2026-11-02T08:00:00Z', partial: false,
    summary: { low: 900000000, high: 920000000, count: 2 }, listings: [900000000, 920000000].map((price, i) => ({ id: `${i}`, name: '검증용 햇살아파트 101동', price, area: 84.99, supply_area: 112.4, floor_direction: '12층/25층 · 남향', checked_on: '2026-11-01', url: `https://neonet.co.kr/?fixture=${i}` })),
  } }))
  await page.route('**/api/property/market/areas?**', route => route.fulfill({ json: { sources: ['국토교통부 최근 12개월 거래', '부동산뱅크 매물'], warnings: [], areas: [{ area: 59.98, min: 59.98, max: 59.98, supply_pyeong: [] }, { area: 84.99, min: 84.92, max: 84.99, supply_pyeong: [34] }] } }))
  await page.addInitScript(`window.daum = { Postcode: class {
    constructor(options) { this.options = options }
    embed(box) { const button = document.createElement('button'); button.type = 'button'; button.textContent = '검증용 단지 검색 결과'; button.onclick = () => this.options.oncomplete({ roadAddress: '검증시 검증구 햇살로 1', jibunAddress: '검증시 검증구 검증동 1', buildingName: '검증용 햇살아파트', bcode: '1111010100', sigunguCode: '11110', zonecode: '12345', apartment: 'Y' }); box.append(button) }
  }};`)
  await page.goto('/#property')
  const total = page.getByLabel('전체 매도 합계')
  await expect(total.locator('.property-sale-net strong')).toHaveText('10억원')
  await expect(total).toContainText('13억원')
  await expect(total).toContainText('2억원')
  await expect(total).toContainText('1억원')
  await expect(total).toContainText('매도세금·중개비 차감 전')
  const ads = page.locator('.property-public-listings').first()
  await expect(ads.locator('.property-public-row')).toHaveCount(2)
  await expect(ads).toContainText('9억원')
  await expect(ads).toContainText('전용 84.99㎡')
  await expect(ads).toContainText('26.11.01 확인')
  expect((await (await request.get('/api/property')).json()).homes).toEqual(before)
  await page.getByRole('button', { name: '비교할 아파트 추가', exact: true }).click()
  const modal = page.getByRole('dialog')
  await expect(modal.getByLabel('계획 매수가', { exact: true })).toHaveCount(0)
  await expect(modal.locator('details')).toHaveCount(0)
  await expect(modal.getByLabel('비교 메모')).toBeVisible()
  await expect(modal.getByLabel('취득세·중개·이사비', { exact: true })).toHaveCount(0)
  await modal.getByRole('button', { name: /아파트 이름으로 검색/ }).click()
  await modal.getByRole('button', { name: '검증용 단지 검색 결과' }).click()
  await modal.getByRole('button', { name: /전용 84㎡/ }).click()
  await expect(modal.getByRole('button', { name: /전용 84㎡/ })).toHaveAttribute('aria-pressed', 'true')
  for (const width of [1440, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await modal.screenshot({ path: test.info().outputPath(`property-area-picker-${width}.png`) })
  }
  await modal.getByRole('button', { name: '후보 저장' }).click()
  await expect(modal).not.toBeVisible()
  const saved = await (await request.get('/api/property-move')).json()
  expect(saved.plan.candidates[0].area_m2).toBe(84.99)
  expect(saved.plan.candidates[0].price).toBeNull()
  expect(saved.plan.candidates[0].purchase_costs).toBeNull()
  expect(saved.track[saved.plan.candidates[0].id] ?? []).toHaveLength(0)
  for (const width of [1440, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.locator('#property-move-homes').screenshot({ path: test.info().outputPath(`property-sale-listings-${width}.png`) })
  }
  await page.getByLabel('자산 소유자 선택').selectOption('me')
  await expect(total.locator('.property-sale-net strong')).toHaveText('3억원')
  await expect(total).toContainText('선택한 소유자 지분')
})
