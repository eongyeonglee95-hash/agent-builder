import { money } from '../src/model'
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
  await page.getByRole('navigation', { name: '부동산 메뉴' }).getByRole('button', { name: '내 부동산' }).click()
  await expect(page.getByRole('region', { name: '부동산과 현금 합계' })).toBeVisible()
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
  await expect(page.locator('.property-move-home-list')).toContainText('검증용 처음 등록한 집')
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
  await page.getByRole('navigation', { name: '부동산 메뉴' }).getByRole('button', { name: '내 부동산' }).click()
  const homeLine = page.locator('.property-move-home-list article').first()
  await expect(homeLine).toContainText('8억 2,000만원')
  await expect(homeLine).toContainText('8억 5,000만원')
  await page.getByRole('button',{name:'검증용 햇살아파트 상세 보기',exact:true}).click()
  await page.getByRole('group',{name:'검증용 햇살아파트 상세 보기'}).getByRole('button',{name:'집 정보',exact:true}).click()
  await expect(homeLine).toContainText('6억원')
  await page.getByRole('button',{name:'정보 수정',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'집 정보'})).toBeVisible()
  await page.getByRole('button',{name:'닫기',exact:true}).click()
  for(const width of [1440,390,360]){
    await page.setViewportSize({width,height:1000})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  }
  expect(errors).toEqual([])
})

test('거래 조회 실패·무거래·미연결 상태에서 가격을 지어내지 않는다', async ({ page, request }) => {
  await request.post('/api/property', { data: { request_id: crypto.randomUUID(), name: '검증용 거래 없는 집', owner: 'me', value: 500000000, area_m2: 84, address: { road: '검증용', building: '검증용', sigungu_code: '11110' } } })
  for (const mode of ['error', 'empty', 'unconfigured']) {
    await page.unroute('**/api/property/trades?**')
    await page.route('**/api/property/trades?**', route => mode === 'error' ? route.fulfill({ status: 503, json: { detail: '검증용 조회 실패' } }) : route.fulfill({ json: { configured: mode !== 'unconfigured', trades: [] } }))
    await page.goto('/#property')
  await page.getByRole('navigation', { name: '부동산 메뉴' }).getByRole('button', { name: '내 부동산' }).click()
    await page.reload()
    const metric = page.locator('.property-move-home-list article').first().locator('dl > div').filter({has:page.getByText('최근 실거래',{exact:true})})
    await expect(metric).toContainText(mode === 'error' ? '조회 실패' : '—')
    await expect(metric).not.toContainText('8억')
  }
})

test('전체 매도 합계·공개 매물·이름 검색 후 평형만 등록하며 장부를 바꾸지 않는다', async ({ page, request }) => {
  const address = { road: '검증시 검증구 햇살로 1', jibun: '검증시 검증구 검증동 1', building: '검증용 햇살아파트', sigungu_code: '11110', bcode: '1111010100', apartment: true }
  await request.post('/api/property', { data: { request_id: crypto.randomUUID(), name: '검증용 햇살아파트', owner: 'joint', share_percent: 50, value: 800000000, area_m2: 84, address, new_loans: [{ name: '검증용 담보대출', amount: 200000000 }] } })
  await request.post('/api/property', { data: { request_id: crypto.randomUUID(), name: '검증용 두 번째 집', owner: 'partner', value: 500000000, area_m2: 59, tenure: 'jeonse', deposit: 100000000 } })
  const before = (await (await request.get('/api/property')).json()).homes
  await page.route('**/api/property/market/listings?**', route => {
    const kind = new URL(route.request().url()).searchParams.get('kind')
    const prices = kind === 'L' ? [600000000] : kind === 'M' ? [100000000] : [900000000, 920000000]
    return route.fulfill({ json: {
      status: 'matched', source: '부동산뱅크', source_url: 'https://neonet.co.kr', fetched_at: '2026-11-02T08:00:00Z', partial: false,
      summary: { low: prices[0], high: prices.at(-1), count: prices.length }, rent_offer: kind === 'M' ? { deposit: 100000000, monthly: 1200000 } : null,
      listings: prices.map((price, i) => ({ id: `${i}`, name: '검증용 햇살아파트 101동', price, ...(kind === 'M' ? { monthly: 1200000 } : {}), area: 84.99, supply_area: 112.4, floor_direction: '12층/25층 · 남향', checked_on: '2026-11-01', url: `https://neonet.co.kr/?fixture=${i}` })),
    } })
  })
  await page.route('**/api/property/market/areas?**', route => route.fulfill({ json: { sources: ['국토교통부 최근 12개월 거래', '부동산뱅크 매물'], warnings: [], areas: [{ area: 59.98, min: 59.98, max: 59.98, supply_pyeong: [] }, { area: 84.99, min: 84.92, max: 84.99, supply_pyeong: [34] }] } }))
  await page.addInitScript(`window.daum = { Postcode: class {
    constructor(options) { this.options = options }
    embed(box) { const button = document.createElement('button'); button.type = 'button'; button.textContent = '검증용 단지 검색 결과'; button.onclick = () => this.options.oncomplete({ roadAddress: '검증시 검증구 햇살로 1', jibunAddress: '검증시 검증구 검증동 1', buildingName: '검증용 햇살아파트', bcode: '1111010100', sigunguCode: '11110', zonecode: '12345', apartment: 'Y' }); box.append(button) }
  }};`)
  await page.goto('/#property')
  await page.getByRole('navigation', { name: '부동산 메뉴' }).getByRole('button', { name: '내 부동산' }).click()
  const total = page.getByRole('region',{name:'부동산과 현금 합계'})
  const capital=(await (await request.get('/api/property-move')).json()).capital
  await expect(total.locator('strong')).toHaveText(money(capital.net))
  await expect(total).toContainText('13억원')
  await expect(total).toContainText('3억원')
  await expect(total).toContainText('매도세금·비용 차감 전')
  await expect(page.getByLabel('부동산 자산 내역', { exact: true })).toHaveCount(0)
  await expect(page.getByText('입력 예시', { exact: true })).toHaveCount(0)
  await expect(page.locator('.property-public-listings')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '최근 매매 호가 더보기', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '검증용 햇살아파트 상세 보기', exact: true }).click()
  await page.getByRole('button', { name: '최근 매매 호가 더보기', exact: true }).first().click()
  const ads = page.locator('.property-public-listings').first()
  await expect(ads.locator('.property-public-row')).toHaveCount(2)
  await expect(ads).toContainText('9억원')
  await expect(ads).toContainText('전용 84.99㎡')
  await expect(ads).toContainText('26.11.01 확인')
  await page.getByRole('button', { name: '월세 더보기', exact: true }).first().click()
  await expect(ads).toContainText('1억원 / 월 120만원')
  await page.getByRole('button', { name: '월세 접기', exact: true }).first().click()
  await expect(page.locator('.property-public-listings')).toHaveCount(0)
  await page.getByRole('group', { name: '검증용 햇살아파트 상세 보기' }).getByRole('button', { name: '집 정보', exact: true }).click()
  await expect(page.getByRole('button', { name: '정보 수정', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '검증용 햇살아파트 상세 접기', exact: true }).click()
  expect((await (await request.get('/api/property')).json()).homes).toEqual(before)
  await page.getByRole('navigation', { name: '부동산 메뉴' }).getByRole('button', { name: '관심 단지', exact: true }).click()
  await page.getByRole('button', { name: '단지 추가', exact: true }).click()
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
  await page.getByRole('navigation', { name: '부동산 메뉴' }).getByRole('button', { name: '내 부동산', exact: true }).click()
  for (const width of [1440, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.locator('#property-move-homes').screenshot({ path: test.info().outputPath(`property-sale-listings-${width}.png`) })
  }
  await page.getByLabel('자산 소유자 선택').selectOption('me')
  const mine=(await (await request.get('/api/property-move?owner=me')).json()).capital
  await expect(total.locator('strong')).toHaveText(money(mine.net))
})
