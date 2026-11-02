import { expect, test, type Page, type APIRequestContext } from '@playwright/test'
import type { Candidate, MoveState, TrackEntry } from '../src/property-move/types'

const candidate = (id: string, name: string): Candidate => ({ id, name, address: null, area_m2: 84, price: 900_000_000, price_basis: 'manual', price_date: null, asking_low: 910_000_000, asking_high: 930_000_000, asking_date: '2026-11-02', purchase_costs: 30_000_000, memo: '', living: { school: '', commute: '', life: '', concerns: '' } })
const entry = (day: string, price: number, home: number, basis: TrackEntry['price_basis'], note: string): TrackEntry => ({ day, price, price_basis: basis, price_date: day, note, home_value: home, home_net: home - 100_000_000, own_funds: home, gap: price - home, needed: price - home + 30_000_000, costs_complete: true, saved_at: `${day}T09:00:00` })

async function fixture(page: Page, request: APIRequestContext) {
  const data: MoveState = await (await request.get('/api/property-move')).json()
  data.plan.candidates = [candidate('analysis-a', '분석 검수 강변'), candidate('analysis-b', '분석 검수 공원'), candidate('analysis-c', '분석 검수 미기록')]
  // Existing household plans can omit the field introduced after they were saved.
  delete (data.plan.candidates[2] as Partial<Candidate>).living
  data.track = {
    'analysis-a': [
      entry('2026-11-02', 910_000_000, 800_000_000, 'asking', '남향 고층 · 11월 매물 확인'),
      entry('2026-10-31', 890_000_000, 800_000_000, 'trade', '다른 가격 기준의 거래'),
      entry('2026-10-28', 900_000_000, 790_000_000, 'asking', '우리 집 평가 갱신'),
      entry('2026-09-01', 880_000_000, 790_000_000, 'asking', '첫 호가 관찰'),
    ],
    'analysis-b': [entry('2026-11-01', 760_000_000, 800_000_000, 'manual', '낮은 가격 후보의 첫 기록')],
    'analysis-c': [],
  }
  data.comparisons = data.plan.candidates.map(c => ({ ...data.funds, id: c.id, gap: 130_000_000, months: 16, future_gap: 82_000_000, costs_complete: true, price_gap: 100_000_000 }))
  await page.route('**/api/property-move?owner=*', route => {
    if (route.request().method() !== 'GET') return route.continue()
    const owner = new URL(route.request().url()).searchParams.get('owner')
    return route.fulfill({ json: owner === 'together' ? data : { ...data, plan: { ...data.plan, candidates: [] }, track: {}, comparisons: [] } })
  })
  await page.route('**/api/property/trades?**', route => route.fulfill({ json: { configured: true, trades: [] } }))
  await page.goto('/#property')
  await expect(page.getByRole('region', { name: '관심 부동산 분석', exact: true })).toBeVisible()
  return data
}

test('날짜 간격에 맞는 점·같은 가격 기준 연결·키보드 선택과 단일/빈 기록', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await fixture(page, request)
  const hero = page.locator('.property-analysis-hero')
  await expect(hero.locator('.property-hero-point')).toHaveCount(3)
  await expect(hero.getByTestId('property-history-line')).toHaveCount(1)
  await expect(hero.locator('.property-hero-chart-summary')).toContainText('기록과 같아요')
  const positions = await hero.locator('.property-hero-point-dot').evaluateAll(nodes => nodes.map(n => Number(n.getAttribute('cx'))))
  expect(positions[1] - positions[0]).toBeGreaterThan((positions[2] - positions[1]) * 5)
  await hero.getByRole('button', { name: /2026.09.01 호가 기록/ }).click()
  await expect(hero.locator('.property-hero-record-note')).toContainText('첫 호가 관찰')
  await hero.getByRole('button', { name: /2026.09.01 호가 기록/ }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(hero.getByRole('button', { name: /2026.10.28 호가 기록/ })).toBeFocused()
  await expect(hero.locator('.property-hero-record-note')).toContainText('우리 집 평가 갱신')
  await hero.getByLabel('기록 가격 기준').selectOption('trade')
  await expect(hero.locator('.property-hero-point')).toHaveCount(1)
  await expect(hero.getByTestId('property-history-line')).toHaveCount(0)
  await expect(hero.locator('.property-hero-chart-summary')).toContainText('첫 기록')
  await hero.getByRole('button', { name: /분석 검수 공원/ }).click()
  await expect(hero.locator('.property-hero-chart-summary strong')).toHaveText('−4,000만원')
  await expect(hero.getByTestId('property-history-line')).toHaveCount(0)
  await hero.getByRole('button', { name: /분석 검수 미기록/ }).click()
  await expect(hero.getByRole('button', { name: /첫 기록 남기기/ })).toBeVisible()
  await expect(hero.locator('svg.property-hero-chart-svg')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('히어로 편집·상세 진입과 가구 범위, 금액 숨김에 차트/메모가 남지 않는다', async ({ page, request }) => {
  await fixture(page, request)
  const hero = page.locator('.property-analysis-hero')
  await hero.getByRole('button', { name: '입력·수정하기', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByLabel('단지 이름', { exact: true })).toHaveValue('분석 검수 강변')
  await page.keyboard.press('Escape')
  await hero.getByRole('button', { name: /근거·기록 자세히/ }).click()
  const line = page.locator('.property-move-candidate-line').filter({ hasText: '분석 검수 강변' })
  await expect(line.getByRole('table', { name: '분석 검수 강변 추적 기록' })).toBeVisible()
  await expect(line.getByLabel('분석 검수 강변 호가 (만원)')).toBeFocused()
  await hero.getByRole('button', { name: /분석 검수 미기록/ }).click()
  await hero.getByRole('button', { name: /첫 기록 남기기/ }).click()
  const legacy = page.locator('.property-move-candidate-line').filter({ hasText: '분석 검수 미기록' })
  await expect(legacy.getByLabel('학군·통학')).toHaveValue('')
  await expect(legacy.getByLabel('분석 검수 미기록 호가 (만원)')).toBeFocused()
  await hero.getByRole('button', { name: /분석 검수 강변/ }).click()
  // The app keeps the hidden state while moving between screens.
  await page.evaluate(() => { location.hash = '#assets' })
  await page.getByRole('button', { name: '금액 숨기기', exact: true }).click()
  await page.evaluate(() => { location.hash = '#property' })
  await expect(hero.locator('.property-hero-chart-hidden')).toBeVisible()
  await expect(hero.locator('.property-hero-chart-svg')).toHaveCount(0)
  await expect(hero).not.toContainText('남향 고층')
  await expect(hero).not.toContainText('1억 1,000만원')
  await expect(hero.locator('.property-hero-point')).toHaveCount(0)
  await page.getByLabel('자산 소유자 선택').selectOption('me')
  await expect(hero.locator('.property-hero-start')).toBeVisible()
  await expect(hero).not.toContainText('분석 검수 강변')
})

test('히어로 데스크톱·모바일, 가로 넘침 없이 후보·점 선택', async ({ page, request }) => {
  await fixture(page, request)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [1440, 1024, 768, 390, 360]) {
    await page.setViewportSize({ width, height: 1050 })
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.locator('.property-analysis-hero').screenshot({ path: test.info().outputPath(`property-analysis-hero-${width}.png`) })
  }
  await page.locator('.property-hero-candidate').filter({ hasText: '분석 검수 공원' }).click()
  await expect(page.locator('.property-hero-analysis-heading h3')).toHaveText('분석 검수 공원')
  await page.locator('.property-hero-candidate').filter({ hasText: '분석 검수 강변' }).click()
  await page.locator('.property-hero-point').first().click()
  await expect(page.locator('.property-hero-record-note')).toContainText('첫 호가 관찰')
})
