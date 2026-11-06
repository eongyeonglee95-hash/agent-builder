// Local development tool. Never copy ChatGPT credentials into the viewer.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'

const live = job => ['queued', 'running', 'stopping'].includes(job.status)
const dependencyId = dep => typeof dep === 'string' ? dep : dep.taskId ?? dep.id
const redact = text => String(text).replace(/\x1b\[[0-9;]*m/g, '').replace(/\bsk-[\w-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(-6000)

export function subscriptionEnvironment(source = process.env) {
  // Deliberately omit API keys, access tokens and the parent conversation identity.
  return Object.fromEntries(['HOME', 'USER', 'LOGNAME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL',
    'SSL_CERT_FILE', 'CODEX_CA_CERTIFICATE'].filter(key => source[key]).map(key => [key, source[key]]))
}

export function executionOrder(tasks, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 30 || ids.some(id => typeof id !== 'string')) throw new Error('작업을 1~30개 선택해 주세요.')
  const selected = new Set(ids)
  const byId = new Map(tasks.map(task => [task.id, task]))
  const ordered = [], seen = new Set(), visiting = new Set()
  function visit(id) {
    if (seen.has(id)) return
    const task = byId.get(id)
    if (!task) throw new Error('목록에 없는 작업입니다. 새로고침해 주세요.')
    if (task.status === 'completed') throw new Error(`${task.name}: 이미 완료된 작업입니다.`)
    if (visiting.has(id)) throw new Error('작업 의존성이 순환합니다.')
    visiting.add(id)
    for (const dep of task.dependencies ?? []) {
      const predecessor = byId.get(dependencyId(dep))
      if (predecessor?.status === 'completed') continue
      if (!predecessor || !selected.has(predecessor.id)) throw new Error(`${task.name}: 선행 작업 ${predecessor?.name ?? dependencyId(dep)}부터 선택해 주세요.`)
      visit(predecessor.id)
    }
    visiting.delete(id); seen.add(id); ordered.push(task)
  }
  ids.forEach(visit)
  const elsewhere = tasks.find(task => task.status === 'in_progress' && !selected.has(task.id))
  if (elsewhere) throw new Error(`${elsewhere.name} 작업이 진행 중입니다. 먼저 확인해 주세요.`)
  return ordered
}

export class CodexRunner {
  constructor({ root, stateDir = path.join(root, 'data/local/shrimp-runner'),
    tasksFile = path.join(root, 'data/local/shrimp/tasks.json'), spawnProcess = spawn } = {}) {
    this.root = root; this.stateDir = stateDir; this.tasksFile = tasksFile
    this.spawnProcess = spawnProcess; this.state = { version: 1, assignments: {}, jobs: [] }
    this.busy = false; this.child = null; this.auth = null; this.authAt = 0; this.saveChain = Promise.resolve()
  }
  async init() {
    await mkdir(this.stateDir, { recursive: true, mode: 0o700 })
    try { this.state = JSON.parse(await readFile(path.join(this.stateDir, 'state.json'), 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    for (const job of this.state.jobs) {
      if (live(job)) {
        if (job.pid) {
          try { process.kill(job.pid, 0); this.orphan = true } catch { /* child exited */ }
        }
        job.status = 'interrupted'; job.message = '서버가 재시작되었습니다. 변경 내용을 확인한 뒤 다시 실행해 주세요.'
      }
    }
    await this.save()
  }
  async tasks() {
    const data = JSON.parse(await readFile(this.tasksFile, 'utf8'))
    return Array.isArray(data) ? data : data.tasks
  }
  save() {
    const data = JSON.stringify(this.state, null, 2)
    this.saveChain = this.saveChain.then(async () => {
      const file = path.join(this.stateDir, 'state.json')
      await writeFile(`${file}.tmp`, data, { mode: 0o600 })
      await rename(`${file}.tmp`, file)
    })
    return this.saveChain
  }
  capture(args, timeout = 10000) {
    return new Promise(resolve => {
      const child = this.spawnProcess('codex', args, { cwd: this.root, env: subscriptionEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] })
      let output = '', settled = false
      const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result) } }
      const timer = setTimeout(() => { child.kill('SIGTERM'); finish({ code: -1, output: 'Codex 응답 시간 초과' }) }, timeout)
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-12000) })
      child.once('error', () => finish({ code: -1, output: 'Codex CLI를 찾을 수 없습니다.' }))
      child.once('close', code => finish({ code, output }))
    })
  }
  async authentication(force = false) {
    if (!force && this.auth && Date.now() - this.authAt < 30000) return this.auth
    const result = await this.capture(['login', 'status'])
    this.auth = { connected: result.code === 0 && /Logged in using ChatGPT/i.test(result.output),
      message: result.code === 0 && /Logged in using ChatGPT/i.test(result.output) ? 'ChatGPT 구독 연결됨' : '터미널에서 codex login으로 ChatGPT 계정에 로그인해 주세요.' }
    this.authAt = Date.now()
    return this.auth
  }
  async snapshot() {
    return { ...this.state, auth: await this.authentication(), busy: this.busy,
      orphan: !!this.orphan, jobs: this.state.jobs.map(({ pid, ...job }) => job) }
  }
  async reserve(fn) {
    if (this.busy || this.orphan) throw new Error(this.orphan ? '이전 Codex 프로세스가 남아 있습니다. 종료 여부를 확인한 뒤 뷰어를 다시 시작해 주세요.' : '현재 실행 중입니다. 완료하거나 중지한 뒤 다시 시도해 주세요.')
    this.busy = true
    try { return await fn() } finally { if (!this.worker) this.busy = false }
  }
  async assign(ids) {
    return this.reserve(async () => {
      const tasks = await this.tasks()
      if (!Array.isArray(ids) || !ids.length || ids.length > 30 || ids.some(id => !tasks.some(task => task.id === id))) throw new Error('목록에서 작업을 선택해 주세요.')
      for (const id of ids) this.state.assignments[id] = 'codex'
      await this.save()
      return { message: `${ids.length}개 작업을 Codex에 배정했습니다. 아직 실행하지 않았습니다.` }
    })
  }
  async start(ids, checkOnly = false) {
    return this.reserve(async () => {
      this.stopping = false
      if (!(await this.authentication(true)).connected) throw new Error(this.auth.message)
      const tasks = checkOnly ? [{ id: null, name: '구독 연결 확인' }] : executionOrder(await this.tasks(), ids)
      if (this.stopping) throw new Error('실행 준비 중 중지되었습니다.')
      const batch = randomUUID()
      const jobs = tasks.map(task => ({ id: randomUUID(), batch, taskId: task.id, name: task.name,
        checkOnly, status: 'queued', createdAt: new Date().toISOString(), logs: [], message: '실행 대기' }))
      for (const task of tasks) if (task.id) this.state.assignments[task.id] = 'codex'
      this.state.jobs = [...this.state.jobs.filter(job => !live(job)).slice(-20), ...jobs]
      await this.save()
      this.worker = this.run(jobs).catch(async error => {
        for (const job of jobs.filter(live)) { job.status = 'failed'; job.message = redact(error.message) }
        await this.save()
      }).finally(() => { this.worker = null; this.busy = false; this.child = null })
      return { message: checkOnly ? '읽기 전용으로 구독 연결을 확인합니다.' : `${jobs.length}개 작업을 순서대로 실행합니다.` }
    })
  }
  prompt(task) {
    return `사용자가 Shrimp 웹에서 다음 작업 하나의 개발 실행을 요청했습니다. 작업 ID: ${task.id}\n` +
      `이 세션은 새로운 로컬 Codex 세션입니다. 이전 대화의 문맥이 있다고 가정하지 마세요.\n` +
      `AGENTS.md, CLAUDE.md, docs/DEV_HANDOFF.md, docs/AGENT_DESIGN.md의 담당/범위를 먼저 읽으세요.\n` +
      `기존 미커밋 변경을 보존하고 해당 작업만 구현·검증하세요. 커밋/푸시/배포/구매/금융 실데이터 변경/다른 세션 재개는 요청 범위가 아닙니다.\n` +
      `retire-together-shrimp MCP의 get_task_detail, execute_task로 이 ID의 선행 조건을 확인하고 착수 상태를 기록하세요.\n` +
      `관련 테스트가 실제 통과하고 모든 완료 기준을 충족했을 때만 verify_task로 완료 처리하고 문서 작업표·인계·CHANGELOG에 근거를 남기세요.\n` +
      `운영 API 키·계정·OAuth 설정이 없어도 독립적으로 가능한 코드 구현·설정 검증·가짜 응답/임시 자료 테스트는 먼저 완료하세요. 설정 누락만으로 전체 구현을 중단하지 마세요. 실제 계정 접근·외부 설정 변경 등 해당 정보나 권한에 의존하는 단계만 보류하고 구체적인 다음 조치를 설명하세요.\n` +
      `실제 검증이 남아 있으면 완료로 처리하지 말고 구현/자동 테스트 완료와 실제 연결 대기를 구분하세요. 허위 완료 처리는 금지합니다. 다음 작업은 별도 실행기가 처리하므로 시작하지 마세요.\n` +
      `마지막 답변은 한국어로 변경 내용, 실제 검증 결과, 남은 제약을 적어 주세요.\n\n작업 자료:\n${JSON.stringify(task, null, 2)}`
  }
  log(job, text) {
    if (!text) return
    job.logs.push({ at: new Date().toISOString(), text: redact(text) })
    job.logs = job.logs.slice(-60)
  }
  async run(jobs) {
    for (const job of jobs) {
      if (this.stopping) break
      let task
      if (!job.checkOnly) {
        const tasks = await this.tasks()
        task = tasks.find(candidate => candidate.id === job.taskId)
        executionOrder(tasks, [job.taskId]) // Re-check the live graph immediately before each task.
      }
      job.status = 'running'; job.message = job.checkOnly ? '구독 응답 확인 중' : 'Codex가 작업을 진행하고 있습니다.'
      await this.save()
      const result = await this.execute(job, task)
      job.endedAt = new Date().toISOString(); delete job.pid
      if (this.stopping) { job.status = 'cancelled'; job.message = '중지됨. 이미 변경된 파일은 유지됩니다.' }
      else if (result.code !== 0 || result.error) { job.status = 'failed'; job.message = result.error || `Codex가 종료 코드 ${result.code}로 멈췄습니다. 실행 내용을 확인해 주세요.` }
      else if (job.checkOnly) {
        job.status = /SHRIMP_CODEX_OK/.test(result.answer) ? 'completed' : 'blocked'
        job.message = job.status === 'completed' ? '구독 연결 확인 완료. 실제 작업은 실행하지 않았습니다.' : '응답을 확인하지 못했습니다. 실행 내용을 확인해 주세요.'
      } else {
        const updated = (await this.tasks()).find(candidate => candidate.id === job.taskId)
        job.status = updated?.status === 'completed' && updated.summary?.trim() && result.answer.trim() ? 'completed' : 'blocked'
        job.message = job.status === 'completed' ? '작업 완료와 검증 기록을 확인했습니다.' : '추가 확인이 필요합니다. 다음 작업은 시작하지 않았습니다.'
      }
      job.answer = redact(result.answer)
      await this.save()
      if (job.status !== 'completed') break
    }
    for (const job of jobs.filter(item => item.status === 'queued')) {
      job.status = 'cancelled'; job.message = this.stopping ? '사용자가 대기열을 중지했습니다.' : '앞 작업이 완료되지 않아 실행하지 않았습니다.'
    }
    await this.save()
  }
  execute(job, task) {
    return new Promise(resolve => {
      // Preserve Codex's workspace sandbox. Non-interactive runs cannot approve extra permissions.
      const args = ['exec', '--json', '--color', 'never', '--ephemeral', '-C', this.root,
        '-s', job.checkOnly ? 'read-only' : 'workspace-write', '-c', 'approval_policy="never"',
        '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"']
      // Only the already-authorized local task tools may run without an interactive prompt.
      // This is scoped to this child process; global config and other MCP tools stay unchanged.
      const taskTools = job.checkOnly ? ['list_tasks'] : ['list_tasks', 'get_task_detail', 'execute_task', 'verify_task', 'update_task']
      args.push('-c', 'mcp_servers.retire-together-shrimp.required=true',
        '-c', `mcp_servers.retire-together-shrimp.enabled_tools=${JSON.stringify(taskTools)}`)
      for (const tool of taskTools) args.push('-c', `mcp_servers.retire-together-shrimp.tools.${tool}.approval_mode="approve"`)
      args.push('-')
      const child = this.spawnProcess('codex', args, { cwd: this.root, env: subscriptionEnvironment(),
        detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
      this.child = child; job.pid = child.pid
      let buffer = '', answer = '', error = '', completed = false, settled = false
      this.save().catch(() => this.cancel())
      const timer = setTimeout(() => { error = '실행 제한 시간(60분)에 도달했습니다.'; this.killChild() }, 60 * 60 * 1000)
      const parse = line => {
        let event
        try { event = JSON.parse(line) } catch { return }
        if (event.type === 'turn.completed') completed = true
        if (event.type === 'error' || event.type === 'turn.failed') { error = redact(event.message ?? event.error?.message ?? 'Codex 실행 오류'); this.log(job, error) }
        const item = event.item
        if (event.type === 'item.completed' && item?.type === 'agent_message') { answer = item.text ?? ''; this.log(job, answer) }
        if (item?.type === 'command_execution') {
          if (event.type === 'item.started') this.log(job, `실행: ${item.command}`)
          if (event.type === 'item.completed') this.log(job, `명령 종료: ${item.exit_code ?? '?'}\n${item.aggregated_output ?? ''}`)
        }
        if (event.type === 'item.completed' && item?.type === 'file_change') this.log(job, `파일 변경: ${(item.changes ?? []).map(change => change.path).join(', ')}`)
        if (event.type === 'item.started' && item?.type === 'mcp_tool_call') this.log(job, `작업 도구: ${item.tool ?? item.name ?? ''}`)
      }
      child.stdout.on('data', chunk => {
        buffer += chunk.toString()
        let at
        while ((at = buffer.indexOf('\n')) !== -1) { parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1) }
        if (buffer.length > 1024 * 1024) { error = '실행 출력이 너무 큽니다.'; this.killChild() }
      })
      child.stderr.on('data', chunk => { this.log(job, chunk.toString()) })
      const finish = code => {
        if (settled) return
        settled = true; clearTimeout(timer); if (buffer.trim()) parse(buffer)
        this.child = null
        resolve({ code, answer, error: error || (!completed && code === 0 ? '완료 이벤트를 받지 못했습니다.' : '') })
      }
      child.once('error', err => { error = redact(err.message); finish(-1) })
      child.once('close', finish)
      child.stdin.on('error', () => {})
      child.stdin.end(job.checkOnly ? '연결 확인입니다. retire-together-shrimp MCP의 list_tasks를 status=all로 한 번 호출하여 읽기 연결을 확인하세요. 파일 수정·작업 실행·상태 변경은 금지합니다. 도구 호출이 성공했을 때만 SHRIMP_CODEX_OK 한 줄을 답하세요. 실패하면 원인만 답하세요.' : this.prompt(task))
    })
  }
  killChild() {
    const child = this.child
    if (!child) return
    const kill = signal => { try { process.kill(-child.pid, signal) } catch { child.kill(signal) } }
    kill('SIGTERM')
    const timer = setTimeout(() => { if (this.child === child) kill('SIGKILL') }, 3000)
    timer.unref()
  }
  async cancel() {
    this.stopping = true
    for (const job of this.state.jobs) {
      if (job.status === 'queued') { job.status = 'cancelled'; job.message = '사용자가 대기열을 중지했습니다.' }
      if (job.status === 'running') job.status = 'stopping'
    }
    this.killChild()
    await this.save()
    return { message: '중지를 요청했습니다. 변경된 파일은 되돌리지 않습니다.' }
  }
}
