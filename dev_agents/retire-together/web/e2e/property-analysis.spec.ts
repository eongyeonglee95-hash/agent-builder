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
  const now = new Date()
  const month = (offset: number) => { const d = new Date(now.getFullYear(), now.getMonth()+offset, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }
  await page.route('**/api/property-move/watch?**', route => route.fulfill({json:{configured:true,months:12,watch:data.plan.candidates.map((c,i)=>({id:c.id,name:c.name,summary:i===2?null:{count:2,areas:[{area:84,count:2,latest:{price:900000000,date:month(0)+'-01'},monthly:[{month:month(-2),count:1,median:800000000},{month:month(0),count:1,median:900000000}]}]}}))}}))
  await page.route('**/api/property-move/places?**', route=>route.fulfill({json:{configured:false,items:[]}}))
  await page.goto('/#property')
  await page.getByRole('navigation', { name: '부동산 메뉴' }).getByRole('button', { name: '관심 단지',exact:true }).click()
  await expect(page.getByRole('img',{name:'관심 단지 월별 가격과 합산 거래량'})).toBeVisible()
  return data
}

test('관심 단지 월별 차트는 거래가 없는 달을 연결하지 않는다', async ({ page, request }) => {
  await fixture(page,request)
  const chart=page.getByRole('img',{name:'관심 단지 월별 가격과 합산 거래량'})
  const paths=await chart.locator('path[fill="none"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')))
  expect(paths.some(p=>p?.includes('M'))).toBe(true)
  expect(paths.every(p=>!p?.includes('L'))).toBe(true)
  await page.getByText('월별 수치·출처',{exact:true}).click()
  await expect(page.locator('.research-data tbody tr')).toHaveCount(12)
  await expect(page.locator('.research-data table')).toContainText('—')
  await page.getByRole('button',{name:'시작점 100',exact:true}).click()
  await expect(page.getByText('시작월에 거래가 있는 단지를 선택해 주세요.')).toBeVisible()
})

test('관심 단지 선택·미기록 상태·수정 화면이 연결된다', async ({page,request})=>{
  await fixture(page,request)
  await page.getByRole('button',{name:'전체 제외',exact:true}).click()
  await expect(page.locator('.research-selection-count')).toHaveText('0개 비교 중')
  await page.getByLabel('분석 검수 미기록 차트 표시').check()
  await expect(page.locator('.research-insight h3')).toHaveText('분석 검수 미기록')
  await expect(page.getByText('선택한 단지·평형의 거래 자료가 없습니다.')).toBeVisible()
  await page.getByRole('button',{name:'단지 정보 수정',exact:true}).click()
  await expect(page.getByRole('dialog',{name:'관심 단지 수정'})).toBeVisible()
  await expect(page.getByLabel('단지 이름',{exact:true})).toHaveValue('분석 검수 미기록')
})

test('관심 단지 차트는 작은 화면에서도 넘치지 않고 금액 숨김을 따른다',async({page,request})=>{
  await fixture(page,request)
  for(const width of [1440,390,360]){
    await page.setViewportSize({width,height:1000})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  }
  await page.goto('/#assets')
  await page.getByRole('button',{name:'금액 숨기기',exact:true}).click()
  await page.goto('/#property')
  await page.getByRole('navigation',{name:'부동산 메뉴'}).getByRole('button',{name:'관심 단지',exact:true}).click()
  await expect(page.getByText('금액 숨김 상태입니다.',{exact:true})).toBeVisible()
  await expect(page.getByRole('img',{name:'관심 단지 월별 가격과 합산 거래량'})).toHaveCount(0)
})
