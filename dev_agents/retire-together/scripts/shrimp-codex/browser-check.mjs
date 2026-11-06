// Browser QA: task writes/runs are mocked; only the optional read-only connection check is live.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from '../../web/node_modules/@playwright/test/index.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const taskFile = path.join(root, 'data/local/shrimp/tasks.json')
const before = await readFile(taskFile, 'utf8')
const tasks = JSON.parse(before).tasks
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:9998/?lang=ko&profile=retire-together')
  try { await page.getByText('ChatGPT 구독 연결됨', { exact: true }).waitFor() }
  catch (error) {
    console.log('Page errors:', errors)
    console.log((await page.locator('body').innerText()).slice(0, 3500))
    await page.screenshot({ path: '/private/tmp/shrimp-codex-diagnostic.png', fullPage: true })
    throw error
  }
  const panel = page.getByRole('region', { name: 'Codex 구독 실행' })
  assert.equal(await page.locator('tbody input[type="checkbox"]').count(), 6)
  assert.equal(await panel.getByRole('button', { name: '선택 작업 실행' }).isEnabled(), false)

  if (process.env.SHRIMP_RUN_LIVE_CHECK === '1' || process.argv.includes('--live')) {
    await panel.getByRole('button', { name: '연결 테스트' }).click()
    await page.getByText('구독 연결 확인 완료. 실제 작업은 실행하지 않았습니다.', { exact: true }).first().waitFor({ timeout: 90000 })
    console.log('PASS: 실제 ChatGPT 구독으로 읽기 전용 응답 확인')
  }

  // Exercise frontend actions without assigning or executing a real product task.
  let assignments = {}, job = null, busy = false, blocked = false
  await page.route('**/api/codex/status', async route => {
    const response = await route.fetch()
    const state = await response.json()
    await route.fulfill({ json: { ...state, assignments, busy, jobs: job ? [job] : state.jobs } })
  })
  await page.route('**/api/codex/assign', async route => {
    assert.deepEqual(route.request().postDataJSON().taskIds, [tasks[0].id])
    assignments = { [tasks[0].id]: 'codex' }
    await route.fulfill({ json: { message: '배정 확인: 아직 실행하지 않았습니다.' } })
  })
  await page.route('**/api/codex/run', async route => {
    assert.deepEqual(route.request().postDataJSON().taskIds, [tasks[0].id])
    if (blocked) return route.fulfill({ status: 409, json: { error: '선행 작업부터 선택해 주세요.' } })
    job = { id: 'browser-synthetic', name: '화면 검수용 샘플', status: 'running', message: '샘플 실행 중', logs: [{ text: '합성 로그' }] }
    busy = true
    await route.fulfill({ json: { message: '샘플 실행 요청 확인' } })
  })
  await page.route('**/api/codex/stop', async route => {
    busy = false; job.status = 'cancelled'; job.message = '샘플 중지 확인'
    await route.fulfill({ json: { message: '샘플 중지 요청 확인' } })
  })
  await page.locator('tbody input[type="checkbox"]').first().check()
  assert.equal(await page.getByRole('button', { name: /AI Assign Agents/ }).count(), 0)
  await panel.getByRole('button', { name: 'Codex에 배정', exact: true }).click()
  await page.getByText('Codex · 구독', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '선택 작업 실행' }).click()
  await panel.getByText('샘플 실행 중', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: '선택 작업 실행' }).isEnabled(), false)
  await panel.getByRole('button', { name: '실행 중지' }).click()
  await panel.getByText('샘플 중지 확인', { exact: true }).waitFor()
  blocked = true
  await panel.getByRole('button', { name: '선택 작업 실행' }).click()
  await panel.getByRole('alert').filter({ hasText: '선행 작업부터' }).waitFor()
  assert.deepEqual(errors, [])
  assert.equal(await readFile(taskFile, 'utf8'), before)
  console.log('PASS: 배정·실행·진행·중지·선행 조건 오류·실제 작업 파일 보존·브라우저 오류 0')
  await page.unrouteAll({ behavior: 'wait' })
  await page.reload()
  await page.getByText('ChatGPT 구독 연결됨', { exact: true }).waitFor()
  await page.locator('tbody input[type="checkbox"]').first().check()
  await page.screenshot({ path: '/private/tmp/shrimp-codex-desktop.png', fullPage: true })
} finally { await browser.close() }
