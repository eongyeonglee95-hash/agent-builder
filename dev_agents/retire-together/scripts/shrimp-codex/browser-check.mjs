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
  let expectedRunIds = [tasks[0].id]
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
    assert.deepEqual(route.request().postDataJSON().taskIds, expectedRunIds)
    if (blocked) return route.fulfill({ status: 409, json: { error: '선행 작업부터 선택해 주세요.' } })
    job = { id: 'browser-synthetic', name: '화면 검수용 샘플', status: 'running', message: '샘플 실행 중', logs: [{ text: '합성 로그' }] }
    busy = true
    await route.fulfill({ json: { message: '샘플 실행 요청 확인' } })
  })
  await page.route('**/api/codex/stop', async route => {
    busy = false; job.status = 'cancelled'; job.message = '샘플 중지 확인'
    await route.fulfill({ json: { message: '샘플 중지 요청 확인' } })
  })
  await page.route('**/api/codex/acknowledge', async route => {
    assert.equal(route.request().postDataJSON().jobId, 'browser-synthetic')
    job.acknowledgedAt = new Date().toISOString()
    await route.fulfill({ json: { message: '알림 정리 확인' } })
  })
  await page.locator('tbody input[type="checkbox"]').first().check()
  assert.equal(await page.getByRole('button', { name: /AI Assign Agents/ }).count(), 0)
  await panel.getByRole('button', { name: 'Codex에 배정', exact: true }).click()
  await page.locator('tbody tr').first().getByText('Codex · 구독', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '선택 작업 실행' }).click()
  await panel.getByText('샘플 실행 중', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: '알림 접기', exact: true }).count(), 0)
  assert.equal(await panel.getByRole('button', { name: '선택 작업 실행' }).isEnabled(), false)
  await panel.getByRole('button', { name: '실행 중지' }).click()
  await panel.getByText('샘플 중지 확인', { exact: true }).waitFor()
  blocked = true
  await panel.getByRole('button', { name: '선택 작업 실행' }).click()
  await panel.getByRole('alert').filter({ hasText: '선행 작업부터' }).waitFor()
  job.status = 'blocked'; job.createdAt = '2026-11-06T16:01:34.692Z'
  job.answer = '당시 OAuth 설정이 없어 멈췄습니다.'
  job.currentTask = { status: 'completed', summary: '이후 실제 로그인 검증 완료' }
  await panel.getByText('현재 작업: 완료', { exact: true }).waitFor()
  await panel.getByText('이 작업은 이후 완료되었습니다.', { exact: false }).waitFor()
  await panel.getByRole('button', { name: '알림 접기', exact: true }).click()
  await panel.getByText('확인한 실행 기록 (1건)', { exact: true }).waitFor()
  assert.equal(await panel.locator('.codex-jobs .codex-job').count(), 0)
  await page.reload()
  await panel.getByText('확인한 실행 기록 (1건)', { exact: true }).click()
  await panel.getByText('당시 실행 내용 보기', { exact: true }).click()
  await panel.getByText('당시 OAuth 설정이 없어 멈췄습니다.', { exact: true }).waitFor()
  assert.equal(job.status, 'blocked')
  // Acknowledging an incomplete job never turns its current status into completed.
  job.currentTask = { status: 'in_progress', displayStatus: 'awaiting_confirmation', summary: '' }
  await panel.getByText('현재 작업: 확인 대기', { exact: true }).waitFor()
  assert.equal(await panel.getByText('현재 작업: 완료', { exact: true }).count(), 0)
  // The archived timeout stays actionable, without rerunning a different checked row.
  job.taskId = tasks.find(task => task.name.startsWith('SHARE-05')).id
  job.status = 'failed'; job.message = '실행 제한 시간(60분)에 도달했습니다.'
  job.currentTask.displayStatus = 'retry_required'
  await page.reload()
  const retry = panel.getByRole('region', { name: '재실행이 필요한 작업' })
  await retry.getByText('현재 실행은 중단됐습니다.', { exact: false }).waitFor()
  assert.equal(await panel.locator('.codex-archive').getAttribute('open'), null)
  await page.locator('tbody input[type="checkbox"]').first().check()
  expectedRunIds = [job.taskId]; blocked = false
  await retry.getByRole('button', { name: '이 작업 다시 실행', exact: true }).click()
  await panel.getByText('샘플 실행 중', { exact: true }).waitFor()
  assert.equal(await retry.count(), 0)
  assert.equal(await panel.getByRole('button', { name: '선택 작업 실행' }).isEnabled(), false)
  await panel.getByRole('button', { name: '실행 중지' }).click()
  await panel.getByText('샘플 중지 확인', { exact: true }).waitFor()

  assert.deepEqual(errors, [])
  assert.equal(await readFile(taskFile, 'utf8'), before)
  console.log('PASS: 배정·실행·중지·선행 조건·현재 상태/과거 결과 구분·알림 정리/재조회·원문 보존·실제 작업 파일 보존·브라우저 오류 0')
  await page.unrouteAll({ behavior: 'wait' })
  await page.reload()
  await page.getByText('ChatGPT 구독 연결됨', { exact: true }).waitFor()
  await page.locator('tbody input[type="checkbox"]').first().check()
  await page.screenshot({ path: '/private/tmp/shrimp-codex-desktop.png', fullPage: true })
  // Real task data stays read-only: check the derived list/count/detail display.
  const liveState = await (await page.request.get('http://127.0.0.1:9998/api/codex/status')).json()
  const statuses = { awaiting_confirmation: ['waiting-tasks-counter', '확인 대기'], retry_required: ['retry-tasks-counter', '재실행 필요'] }
  const halted = tasks.filter(task => task.status === 'in_progress' && statuses[liveState.taskDisplayStatuses[task.id]])
  assert.equal(await page.locator('[name="in-progress-tasks-counter"] .value').innerText(), String(tasks.filter(task => task.status === 'in_progress').length - halted.length))
  for (const [status, [counter, label]] of Object.entries(statuses)) {
    const matching = halted.filter(task => liveState.taskDisplayStatuses[task.id] === status)
    await page.locator(`[name="${counter}"] .value`).getByText(String(matching.length), { exact: true }).waitFor()
    if (!matching.length) continue
    const row = page.locator('tbody tr').filter({ hasText: matching[0].name })
    await row.locator('.status-badge').getByText(label, { exact: true }).waitFor()
    await page.goto(`http://127.0.0.1:9998/?lang=ko&profile=retire-together&task-view=view&task-id=${matching[0].id}#projects`)
    await page.locator('.status-badge').getByText(label, { exact: true }).waitFor()
    await page.goto('http://127.0.0.1:9998/?lang=ko&profile=retire-together')
    await page.getByText('ChatGPT 구독 연결됨', { exact: true }).waitFor()
  }
  assert.equal(await readFile(taskFile, 'utf8'), before)
  console.log('PASS: 알림 접은 시간초과 작업 재실행 버튼·지정 작업만 요청·실제 목록/집계/상세 상태 일치·원본 보존')

} finally { await browser.close() }
