// Small local client for setup and inspection; AGENT_DESIGN remains the source.
import assert from 'node:assert/strict'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '../.tools/shrimp-task-manager/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StdioClientTransport, getDefaultEnvironment } from '../.tools/shrimp-task-manager/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'data/local/shrimp')
const dependencies = {
  'SHARE-02': [],
  'SHARE-03': ['SHARE-02'],
  'SHARE-04': ['SHARE-02', 'SHARE-03'],
  'SHARE-05': ['SHARE-02', 'SHARE-03'],
  'SHARE-06': ['SHARE-02', 'SHARE-03', 'SHARE-04', 'SHARE-05'],
  'SHARE-07': ['SHARE-02', 'SHARE-03', 'SHARE-04', 'SHARE-05', 'SHARE-06'],
}
const codeOf = task => task.name.match(/^SHARE-\d+/)?.[0]
const contentText = result => (result.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n')

async function connect(directory = dataDir) {
  const client = new Client({ name: 'retire-together-shrimp', version: '1.0.0' }, { capabilities: {} })
  const transport = new StdioClientTransport({
    command: '/bin/sh', args: [path.join(root, 'scripts/shrimp-mcp.sh')], cwd: root,
    env: { ...getDefaultEnvironment(), RETIRE_SHRIMP_DATA_DIR: directory }, stderr: 'pipe',
  })
  // Keep upstream diagnostics out of JSON-RPC stdout.
  transport.stderr?.on('data', chunk => process.stderr.write(chunk))
  await client.connect(transport)
  return client
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(contentText(result))
  return contentText(result)
}

async function readTasks(directory = dataDir) {
  try { return JSON.parse(await readFile(path.join(directory, 'tasks.json'), 'utf8')).tasks }
  catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

async function seed(client) {
  const source = await readFile(path.join(root, 'docs/AGENT_DESIGN.md'), 'utf8')
  const existing = await readTasks()
  const rows = source.split('\n').filter(line => /^\| SHARE-0[2-7] \|/.test(line))
  assert.equal(rows.length, 6, 'Expected six SHARE-02~07 rows in AGENT_DESIGN.md')
  const tasks = rows.map(row => {
    const [code, scope, , handoff, criteria] = row.split('|').slice(1, -1).map(s => s.trim())
    return {
      name: `${code} ${scope}`,
      description: `${scope}. 요구사항 원본: docs/GOOGLE_SHEETS.md. 작업 상태 원본: docs/AGENT_DESIGN.md §0.`,
      implementationGuide: `${handoff}. 구현 전 docs/DEV_HANDOFF.md에서 담당 경로를 확인하고 기존 작업을 보존한다.`,
      notes: '최초 사용자 본인이 고정 오너. 오너 양도 없음. 배우자는 초대로 합류. 실제 금융 자료와 인증 정보는 작업 기록에 넣지 않는다.',
      verificationCriteria: criteria,
      relatedFiles: [
        { path: 'docs/GOOGLE_SHEETS.md', type: 'REFERENCE', description: '로그인·초대·공통 시트 설계' },
        { path: 'docs/AGENT_DESIGN.md', type: 'REFERENCE', description: '작업 상태와 완료 조건 원본' },
        { path: 'docs/DEV_HANDOFF.md', type: 'REFERENCE', description: '파일 담당과 진행 중 작업' },
      ],
      dependencies: dependencies[code],
    }
  })
  const byCode = new Map()
  for (const task of existing) {
    const code = codeOf(task)
    if (!dependencies[code]) continue
    assert(!byCode.has(code), `Duplicate existing task: ${code}`)
    byCode.set(code, task)
  }
  const names = new Map(tasks.map(task => [codeOf(task), task.name]))
  const missing = tasks.filter(task => !byCode.has(codeOf(task))).map(task => ({
    ...task, dependencies: task.dependencies.map(code => byCode.get(code)?.id ?? names.get(code)),
  }))
  if (missing.length) {
    await call(client, 'split_tasks', {
      updateMode: 'append', tasksRaw: JSON.stringify(missing),
      globalAnalysisResult: '둘이서은퇴의 고정 오너·구글 로그인·배우자 초대·공통 시트 연결. 기존 문서가 원본이며 이 목록은 소규모 시범 운영용이다.',
    })
  }
  console.log(`작업 등록: ${missing.length}개 추가, 기존 작업 보존.`)
}

async function inspect(client, directory = dataDir) {
  const tools = (await client.listTools()).tools
  for (const name of ['split_tasks', 'list_tasks', 'get_task_detail', 'execute_task']) {
    assert(tools.some(tool => tool.name === name), `Missing MCP tool: ${name}`)
  }
  const listing = await call(client, 'list_tasks', { status: 'all' })
  const tasks = await readTasks(directory)
  for (const task of tasks) assert(listing.includes(task.name), `Task not returned by MCP: ${task.name}`)
  return { tasks, tools }
}

async function verify() {
  const first = await connect()
  let snapshot
  try { snapshot = await inspect(first) } finally { await first.close() }
  const second = await connect()
  try {
    const restored = await inspect(second)
    assert.deepEqual(restored.tasks, snapshot.tasks, 'Tasks changed across restart')
    const idToCode = new Map(restored.tasks.map(task => [task.id, codeOf(task)]))
    for (const [code, expected] of Object.entries(dependencies)) {
      const matches = restored.tasks.filter(task => codeOf(task) === code)
      assert.equal(matches.length, 1, `Missing or duplicate task: ${code}`)
      assert.deepEqual(matches[0].dependencies.map(dep => idToCode.get(dep.taskId)).sort(), [...expected].sort())
    }
  } finally { await second.close() }
  // Check blocked execution with synthetic tasks, without changing real status.
  const temporary = await mkdtemp(path.join(tmpdir(), 'retire-shrimp-check-'))
  const test = await connect(temporary)
  try {
    await call(test, 'split_tasks', { updateMode: 'append', tasksRaw: JSON.stringify([
      { name: 'Prerequisite', description: 'Synthetic prerequisite for dependency verification', implementationGuide: 'No product changes' },
      { name: 'Dependent', description: 'Synthetic blocked task for dependency verification', implementationGuide: 'No product changes', dependencies: ['Prerequisite'] },
    ]) })
    const before = await readTasks(temporary)
    assert.equal(before.length, 2)
    const prerequisite = before.find(task => task.name === 'Prerequisite')
    const dependent = before.find(task => task.name === 'Dependent')
    const blocked = await call(test, 'execute_task', { taskId: dependent.id })
    assert(blocked.includes(prerequisite.id), 'Missing unfinished prerequisite in response')
    assert.deepEqual(await readTasks(temporary), before, 'Blocked execution changed task data')
  } finally { await test.close() }
  console.log(`검증 통과: MCP 도구 ${snapshot.tools.length}개, 로그인 작업 6개, 의존성, 재시작 복원, 미완료 선행 작업 차단.`)
}

const command = process.argv[2] ?? 'list'
assert(['list', 'seed', 'verify'].includes(command), 'Usage: node scripts/shrimp-tasks.mjs [list|seed|verify]')
if (command === 'verify') {
  await verify()
} else {
  const client = await connect()
  try {
    if (command === 'seed') await seed(client)
    const { tasks } = await inspect(client)
    const byId = new Map(tasks.map(task => [task.id, task]))
    for (const task of tasks) {
      const blocked = task.dependencies.some(dep => byId.get(dep.taskId)?.status !== 'completed')
      console.log(`${task.status} | ${task.name}${blocked ? ' | 선행 작업 대기' : ''}`)
    }
  } finally { await client.close() }
}
