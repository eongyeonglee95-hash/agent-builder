import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable, Readable } from 'node:stream'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CodexRunner, executionOrder, subscriptionEnvironment } from './runner.mjs'
import { createCodexHandler } from './http.mjs'

const task = (id, dependencies = [], status = 'pending') => ({ id, name: `Task ${id}`, dependencies: dependencies.map(taskId => ({ taskId })), status })

async function fixture({ tasks = [task('a'), task('b', ['a'])], mode = 'complete', auth = 'ChatGPT' } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'shrimp-codex-test-'))
  const tasksFile = path.join(root, 'tasks.json')
  await writeFile(tasksFile, JSON.stringify({ tasks }))
  const calls = []
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter()
    child.stdout = new PassThrough(); child.stderr = new PassThrough()
    let closed = false
    const close = code => { if (!closed) { closed = true; child.emit('close', code) } }
    child.kill = () => { setImmediate(() => close(143)); return true }
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      const prompt = chunk.toString()
      calls.push({ command, args, options, prompt })
      if (mode === 'hang') { callback(); return }
      setImmediate(async () => {
        const check = prompt.includes('SHRIMP_CODEX_OK')
        if (!check && mode === 'complete') {
          const id = prompt.match(/작업 ID: ([^\n]+)/)[1]
          const data = JSON.parse(await readFile(tasksFile, 'utf8'))
          Object.assign(data.tasks.find(item => item.id === id), { status: 'completed', summary: 'Synthetic verification passed.' })
          await writeFile(tasksFile, JSON.stringify(data))
        }
        child.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: check ? 'SHRIMP_CODEX_OK' : '검증 결과입니다.' } }) + '\n')
        child.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\n')
        close(mode === 'failure' ? 1 : 0)
      })
      callback()
    } })
    if (args[0] === 'login') setImmediate(() => { child.stderr.write(`Logged in using ${auth}`); close(0) })
    return child
  }
  const runner = new CodexRunner({ root, tasksFile, stateDir: path.join(root, 'state'), spawnProcess })
  await runner.init()
  return { runner, root, calls, tasksFile }
}

test('dependency ordering and incomplete/missing/cyclic prerequisites', () => {
  assert.deepEqual(executionOrder([task('a'), task('b', ['a'])], ['b', 'a']).map(item => item.id), ['a', 'b'])
  assert.throws(() => executionOrder([task('a'), task('b', ['a'])], ['b']), /선행 작업/)
  assert.throws(() => executionOrder([task('a', ['missing'])], ['a']), /선행 작업/)
  assert.throws(() => executionOrder([task('a', ['b']), task('b', ['a'])], ['a', 'b']), /순환/)
  assert.throws(() => executionOrder([task('a'), task('b', [], 'in_progress')], ['a']), /진행 중/)
  assert.throws(() => executionOrder([task('a', [], 'completed')], ['a']), /완료/)
})

test('child environment never receives API keys, tokens or parent thread', () => {
  assert.deepEqual(subscriptionEnvironment({ HOME: '/home/test', PATH: '/bin', CODEX_API_KEY: 'secret',
    OPENAI_API_KEY: 'secret', CODEX_ACCESS_TOKEN: 'secret', CODEX_THREAD_ID: 'parent' }), { HOME: '/home/test', PATH: '/bin' })
})

test('assignment is durable and does not modify tasks or invoke a model', async () => {
  const { runner, calls, tasksFile } = await fixture()
  const before = await readFile(tasksFile, 'utf8')
  await runner.assign(['a', 'b'])
  assert.equal(calls.length, 0)
  assert.equal(await readFile(tasksFile, 'utf8'), before)
  assert.equal(JSON.parse(await readFile(path.join(runner.stateDir, 'state.json'), 'utf8')).assignments.b, 'codex')
})

test('selected queue executes in dependency order with sandbox and ChatGPT auth', async () => {
  const { runner, calls } = await fixture()
  await runner.start(['b', 'a'])
  await runner.worker
  assert.deepEqual(runner.state.jobs.map(job => [job.taskId, job.status]), [['a', 'completed'], ['b', 'completed']])
  assert.equal(calls.length, 2)
  assert.ok(calls[0].args.includes('workspace-write'))
  assert.ok(calls[0].args.includes('forced_login_method="chatgpt"'))
  assert.ok(calls[0].args.includes('approval_policy="never"'))
  assert.ok(calls[0].args.includes('mcp_servers.retire-together-shrimp.tools.execute_task.approval_mode="approve"'))
  assert.ok(!calls[0].args.some(arg => arg.includes('bypass')))
  assert.equal(runner.busy, false)
})

test('model success alone cannot complete a task or start its dependent', async () => {
  const { runner, calls } = await fixture({ mode: 'no-status-change' })
  await runner.start(['a', 'b']); await runner.worker
  assert.deepEqual(runner.state.jobs.map(job => job.status), ['blocked', 'cancelled'])
  assert.equal(calls.length, 1)
})

test('nonzero exit stops queue even when the model emits a completed turn', async () => {
  const { runner, calls } = await fixture({ mode: 'failure' })
  await runner.start(['a', 'b']); await runner.worker
  assert.deepEqual(runner.state.jobs.map(job => job.status), ['failed', 'cancelled'])
  assert.equal(calls.length, 1)
})

test('API-key login is rejected, and check is read-only without task changes', async () => {
  const rejected = await fixture({ auth: 'an API key' })
  await assert.rejects(rejected.runner.start(['a']), /ChatGPT/)
  assert.equal(rejected.calls.length, 0)
  const { runner, tasksFile, calls } = await fixture()
  const before = await readFile(tasksFile, 'utf8')
  await runner.start([], true); await runner.worker
  assert.equal(runner.state.jobs[0].status, 'completed')
  assert.ok(calls[0].args.includes('read-only'))
  assert.ok(calls[0].args.includes('mcp_servers.retire-together-shrimp.enabled_tools=["list_tasks"]'))
  assert.equal(await readFile(tasksFile, 'utf8'), before)
})

test('one worker only; stop cancels both process and remaining queue', async () => {
  const { runner, calls } = await fixture({ mode: 'hang' })
  await runner.start(['a', 'b'])
  for (let i = 0; !runner.child && i < 50; i++) await new Promise(resolve => setTimeout(resolve, 5))
  await assert.rejects(runner.start(['a']), /실행 중/)
  await assert.rejects(runner.assign(['b']), /실행 중/)
  await runner.cancel(); await runner.worker
  assert.deepEqual(runner.state.jobs.map(job => job.status), ['cancelled', 'cancelled'])
  assert.equal(calls.length, 1)
})

test('restart marks unfinished jobs interrupted without replaying them', async () => {
  const { runner, calls } = await fixture()
  runner.state.jobs = [{ id: 'old', status: 'running', logs: [] }]
  await runner.save(); await runner.init()
  assert.equal(runner.state.jobs[0].status, 'interrupted')
  assert.equal(calls.length, 0)
})

async function request(handler, { method = 'GET', url = '/api/codex/status', headers = {}, body } = {}) {
  const req = Readable.from(body ? [body] : [])
  Object.assign(req, { method, url, headers: { host: '127.0.0.1:9998', ...headers } })
  const res = { writeHead(status, value) { this.status = status; this.headers = value }, end(value) { this.data = JSON.parse(value) } }
  const handled = await handler(req, res)
  return { handled, ...res }
}

test('status reads current tasks without rewriting historical outcomes or either file', async () => {
  const { runner, tasksFile } = await fixture()
  const job = { id: 'old', taskId: 'a', status: 'blocked', message: 'OAuth setup missing then', logs: [], answer: 'Old answer' }
  runner.state.jobs = [job]; await runner.save()
  const history = await readFile(path.join(runner.stateDir, 'state.json'), 'utf8')
  assert.equal((await runner.snapshot()).jobs[0].currentTask.status, 'pending')
  const data = JSON.stringify({ tasks: [{ ...task('a', [], 'completed'), summary: 'Verified later' }] })
  await writeFile(tasksFile, data)
  const snapshot = await runner.snapshot()
  assert.equal(snapshot.jobs[0].currentTask.status, 'completed')
  assert.equal(snapshot.jobs[0].currentTask.summary, 'Verified later')
  assert.equal(snapshot.jobs[0].status, 'blocked')
  assert.equal(job.currentTask, undefined)
  assert.equal(await readFile(tasksFile, 'utf8'), data)
  assert.equal(await readFile(path.join(runner.stateDir, 'state.json'), 'utf8'), history)
  await writeFile(tasksFile, '{invalid')
  const unavailable = await runner.snapshot()
  assert.ok(unavailable.taskStateError)
  assert.equal(unavailable.jobs[0].currentTask, null)
  assert.equal(unavailable.jobs[0].status, 'blocked')
})

test('acknowledgement persists without changing task status, logs, answer or launching work', async () => {
  const { runner, tasksFile, calls } = await fixture()
  const before = await readFile(tasksFile, 'utf8')
  const original = { id: 'old', taskId: 'a', status: 'blocked', message: 'Needs confirmation', logs: [{ text: 'Original log' }], answer: 'Original answer' }
  runner.state.jobs = [{ ...original }]
  await runner.acknowledge('old')
  const timestamp = runner.state.jobs[0].acknowledgedAt
  assert.ok(timestamp)
  await runner.acknowledge('old')
  await runner.init()
  const { acknowledgedAt, ...preserved } = runner.state.jobs[0]
  assert.equal(acknowledgedAt, timestamp)
  assert.deepEqual(preserved, original)
  assert.equal(await readFile(tasksFile, 'utf8'), before)
  assert.equal(calls.length, 0)
  await assert.rejects(runner.acknowledge('missing'), /찾을 수/)
  runner.state.jobs.push({ id: 'active', status: 'running' })
  await assert.rejects(runner.acknowledge('active'), /진행 중/)
  runner.busy = true
  await assert.rejects(runner.acknowledge('old'), /현재 실행 중/)
})

test('waiting display follows the latest execution, survives acknowledgement and never changes dependencies', async () => {
  const { runner, tasksFile } = await fixture({ tasks: [task('a', [], 'in_progress'), task('b', ['a'])] })
  const before = await readFile(tasksFile, 'utf8')
  runner.state.jobs = [{ id: 'old', taskId: 'a', status: 'blocked', logs: [] }]
  let snapshot = await runner.snapshot()
  assert.equal(snapshot.taskDisplayStatuses.a, 'awaiting_confirmation')
  assert.equal(snapshot.jobs[0].currentTask.status, 'in_progress')
  await runner.acknowledge('old')
  assert.equal((await runner.snapshot()).taskDisplayStatuses.a, 'awaiting_confirmation')
  assert.throws(() => executionOrder(JSON.parse(before).tasks, ['b']), /선행 작업/)
  runner.state.jobs.push({ id: 'retry', taskId: 'a', status: 'queued', logs: [] })
  assert.equal((await runner.snapshot()).taskDisplayStatuses.a, 'in_progress')
  runner.state.jobs[1].status = 'running'
  assert.equal((await runner.snapshot()).taskDisplayStatuses.a, 'in_progress')
  runner.state.jobs[1].status = 'interrupted'
  assert.equal((await runner.snapshot()).taskDisplayStatuses.a, 'retry_required')
  for (const status of ['failed', 'cancelled']) {
    runner.state.jobs[1].status = status
    await runner.acknowledge('retry')
    assert.equal((await runner.snapshot()).taskDisplayStatuses.a, 'retry_required')
    assert.throws(() => executionOrder(JSON.parse(before).tasks, ['b']), /선행 작업/)
    assert.deepEqual(executionOrder(JSON.parse(before).tasks, ['a']).map(item => item.id), ['a'])
  }
  assert.equal(await readFile(tasksFile, 'utf8'), before)
  await writeFile(tasksFile, JSON.stringify({ tasks: [task('a', [], 'completed'), task('b', ['a'])] }))
  assert.equal((await runner.snapshot()).taskDisplayStatuses.a, 'completed')
})

test('acknowledgement API requires same-origin token and leaves work incomplete', async () => {
  const { runner, tasksFile } = await fixture()
  const handler = await createCodexHandler({ runner })
  runner.state.jobs = [{ id: 'blocked', taskId: 'a', status: 'blocked', logs: [] }]
  const token = (await request(handler)).data.token
  const input = { method: 'POST', url: '/api/codex/acknowledge', headers: { origin: 'http://127.0.0.1:9998', 'content-type': 'application/json' }, body: JSON.stringify({ projectId: 'retire-together', jobId: 'blocked' }) }
  assert.equal((await request(handler, input)).status, 403)
  assert.equal(runner.state.jobs[0].acknowledgedAt, undefined)
  input.headers['x-shrimp-codex-token'] = token
  assert.equal((await request(handler, { ...input, headers: { ...input.headers, origin: 'https://other.example' } })).status, 403)
  assert.equal((await request(handler, input)).status, 200)
  assert.ok(runner.state.jobs[0].acknowledgedAt)
  assert.equal(runner.state.jobs[0].status, 'blocked')
  assert.equal(JSON.parse(await readFile(tasksFile, 'utf8')).tasks[0].status, 'pending')
})

test('HTTP boundary rejects cross-site, wrong host, missing token and foreign project', async () => {
  const { runner } = await fixture()
  const handler = await createCodexHandler({ runner })
  assert.equal((await request(handler, { headers: { origin: 'https://attacker.example' } })).status, 403)
  assert.equal((await request(handler, { headers: { host: 'attacker.example:9998' } })).status, 403)
  const status = await request(handler)
  assert.equal(status.status, 200)
  assert.equal(status.headers['Access-Control-Allow-Origin'], undefined)
  const headers = { origin: 'http://127.0.0.1:9998', 'content-type': 'application/json' }
  const input = { method: 'POST', url: '/api/codex/assign', headers, body: JSON.stringify({ projectId: 'retire-together', taskIds: ['a'] }) }
  assert.equal((await request(handler, input)).status, 403)
  headers['x-shrimp-codex-token'] = status.data.token
  assert.equal((await request(handler, { ...input, body: JSON.stringify({ projectId: '../other', taskIds: ['a'] }) })).status, 400)
  assert.equal((await request(handler, input)).status, 200)
  assert.equal(runner.state.assignments.a, 'codex')
  assert.equal((await request(handler, { ...input, body: '{' })).status, 400)
  runner.busy = true
  assert.equal((await request(handler, { method: 'PUT', url: '/api/tasks/retire-together/update', headers })).status, 409)
  assert.equal((await request(handler, { url: '/api/tasks/retire-together' })).handled, false)
})
