import { expect, test } from '@playwright/test'

const state = (outlook: object, ai: object | null = null) => ({
  config: null, running: null, error: null, next_date: null,
  report: {
    created_at: '2026-11-19T10:00:00+09:00', scope: '합성 검증 자료', source: '테스트', limitations: '', ai_text: null, ai_status: ai ? 'ready' : 'unavailable', ai_report: ai,
    research: [], accounts: [],
    portfolio: { total_value: 10000000, account_count: 1, dates: ['2026-11-18'], mix: [{ asset_class: 'stock', label: '주식', current_pct: 60, target_pct: 50, sell: 0, buy: 0 }] },
    household: { retirement_outlook: outlook },
  },
})
const outlook = { available: true, monthly_need: 2000000, short_years: 1, scenarios: [], milestones: [{ year: 2046, income: 1500000, need: 2000000, shortfall: 500000 }], assumptions: { return_rate: .05, inflation: .02, end_age: 90 } }

test('종합 진단은 실제 계산 숫자·충족률·우선 행동을 먼저 보여주고 작은 화면에서도 읽힌다', async ({ page }) => {
  await page.route('**/api/workbook/review', route => route.fulfill({ json: state(outlook) }))
  await page.goto('/#rebalance')
  const summary = page.getByRole('region', { name: '연금 종합 진단', exact: true })
  await expect(summary.getByText('1,000만원', { exact: true })).toBeVisible()
  await expect(summary.getByText('150만원', { exact: true })).toBeVisible()
  await expect(summary.getByText('50만원', { exact: true })).toBeVisible()
  await expect(summary.getByRole('img', { name: '은퇴 첫해 목표 생활비의 75.0%를 연금으로 충족' })).toBeVisible()
  await expect(summary).toContainText('주식 비중이 선택한 목표보다 10.0%p 많아요.')
  await expect(summary).toContainText('계산 결과 · AI 해석 생성 전')
  await expect(summary.getByRole('region', { name: '우선 할 일' })).toContainText('매월 더 넣을 수 있는 금액')
  for (const width of [1280, 768, 360]) {
    await page.setViewportSize({ width, height: 1000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await expect(summary.getByRole('img', { name: '주식 현재 60.0%, 목표 50.0%' })).toBeVisible()
  }
})

test('첫해 충족을 평생 충족으로 말하지 않고 계획이 없으면 금액을 만들어내지 않는다', async ({ page }) => {
  let payload = state({ ...outlook, milestones: [{ year: 2046, income: 2100000, need: 2000000, shortfall: 0 }] })
  await page.route('**/api/workbook/review', route => route.fulfill({ json: payload }))
  await page.goto('/#rebalance')
  const summary = page.getByRole('region', { name: '연금 종합 진단', exact: true })
  await expect(summary).toContainText('은퇴 첫해는 충족하지만, 이후 부족한 해가 있어요.')
  payload = state({ available: false, missing: ['은퇴 계획'], scenarios: [] })
  await page.reload()
  await expect(summary).toContainText('은퇴 계획을 입력하면 준비 수준을 진단할 수 있어요.')
  await expect(summary.getByRole('img', { name: /목표 생활비의/ })).toHaveCount(0)
  await expect(summary.getByText('미확인', { exact: true })).toHaveCount(2)
})

test('AI 해석과 우선 행동을 첫 장에 연결하고 근거는 펼쳐 읽는다', async ({ page }) => {
  const ai = {
    headline: '합성 진단', summary: '합성 요약', findings: [], alternatives: [], questions: [],
    assessments: [{ dimension: '목표 적합성', status: '확인됨', judgment: '목표보다 많은 주식부터 조정 여부를 정하세요.', evidence: '합성 자료의 현재 비중과 목표를 비교했어요.', condition: '은퇴 시점과 손실 감내 범위를 함께 확인하세요.' }],
    actions: [{ timing: '이번 점검', action: '계좌별 주문 검토표에서 매도 수량을 확인하세요.', reason: '합성 판단 근거', completion: '수량 확인' }],
  }
  await page.route('**/api/workbook/review', route => route.fulfill({ json: state(outlook, ai) }))
  await page.goto('/#rebalance')
  const summary = page.getByRole('region', { name: '연금 종합 진단', exact: true })
  await expect(summary).toContainText(ai.assessments[0].judgment)
  await expect(summary).toContainText(ai.actions[0].action)
  await expect(summary.getByText(ai.assessments[0].evidence)).not.toBeVisible()
  await summary.getByText('판단 근거와 조건', { exact: true }).click()
  await expect(summary.getByText(ai.assessments[0].evidence)).toBeVisible()
  await expect(summary.getByText(ai.assessments[0].condition)).toBeVisible()
  await expect(summary).not.toContainText('AI 해석 생성 전')
})

test('시점별 연금과 납입 효과는 같은 금액 축으로 비교하고 계좌 배분을 시각화한다', async ({ page }) => {
  const payload = state({ ...outlook,
    milestones: [outlook.milestones[0], { year: 2051, income: 1800000, need: 2000000, shortfall: 200000 }],
    scenarios: [{ extra_monthly: 100000, income: 1600000, increase: 100000, shortfall: 400000, year: 2046 }],
  })
  await page.route('**/api/workbook/review', route => route.fulfill({ json: { ...payload, report: { ...payload.report, accounts: [{ label: '검증 연금', strategy: '선택 전략', mode: 'rebalance', findings: [], comparisons: [], plan: { kind: 'move', reduce_total: 0, increase_total: 0, leftover: 0, mix: payload.report.portfolio.mix } }] } } }))
  await page.goto('/#rebalance')
  const charts = page.getByRole('region', { name: '은퇴 생활비 시각 분석' })
  await expect(charts.getByRole('img', { name: '월 연금 150만원 · 목표 생활비 200만원', exact: true })).toBeVisible()
  await expect(charts.getByRole('img', { name: '월 연금 160만원 · 목표 생활비 200만원 · 추가 납입에 따른 증가 10만원', exact: true })).toBeVisible()
  const widths = await charts.locator('[role="img"] > span:first-child').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).style.width))
  expect(widths).toEqual(['75%', '90%', '75%'])
  await expect(page.getByRole('img', { name: '검증 연금 현재 배분: 주식 60.0%' })).toBeVisible()
  await page.setViewportSize({ width: 360, height: 1000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
})

test('이전 보고서에 리서치 필드가 없어도 같은 종합 진단 문서로 표시한다', async ({ page }) => {
  const payload = state(outlook)
  await page.route('**/api/workbook/review', route => route.fulfill({ json: { ...payload, report: { ...payload.report, research: undefined, ai_text: '이전에 저장한 진단 문장' } } }))
  await page.goto('/#rebalance')
  await expect(page.getByRole('region', { name: '연금 종합 진단', exact: true })).toBeVisible()
  await page.getByText('이전에 저장한 진단', { exact: true }).click()
  await expect(page.getByText('이전에 저장한 진단 문장', { exact: true })).toBeVisible()
})

test('리밸런싱 목록에 매매 묶음 없는 4층 추가연금을 표시한다', async ({ page }) => {
  await page.route('**/api/workbook/rebalance', route => route.fulfill({ json: { pools: [], empty_pools: [], additional_pensions: [
    { id: 'a', name: '추가연금 보험 A', account: '보험', amount: 10000000, owner: 'me' },
    { id: 'b', name: '추가연금 보험 B', account: '보험', amount: 20000000, owner: 'partner' },
  ] } }))
  await page.goto('/#rebalance')
  const list = page.getByRole('region', { name: '4층 추가연금 목록' })
  await expect(list).toContainText('추가연금 보험 A')
  await expect(list).toContainText('추가연금 보험 B')
  await expect(list).toContainText('등록 금액 3,000만원')
  await expect(list.getByRole('button', { name: '납입 정보 수정' })).toHaveCount(2)
  await expect(list.getByRole('button', { name: '사고팔기' })).toHaveCount(0)
  await page.setViewportSize({ width: 360, height: 1000 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
})
