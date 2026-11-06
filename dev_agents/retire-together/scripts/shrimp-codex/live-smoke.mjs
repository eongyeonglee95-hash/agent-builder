// Explicit live integration check. Uses subscription usage and an isolated temporary task.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { CodexRunner } from './runner.mjs'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const realFile = path.join(project, 'data/local/shrimp/tasks.json')
const before = await readFile(realFile, 'utf8')
const root = await mkdtemp(path.join(tmpdir(), 'shrimp-codex-live-'))
const dataDir = path.join(root, 'tasks')
await mkdir(dataDir)
const id = randomUUID(), now = new Date().toISOString()
await writeFile(path.join(dataDir, 'tasks.json'), JSON.stringify({ tasks: [{ id, name: 'Isolated connection sample',
  description: 'Write result.txt containing SHRIMP_SAMPLE_OK in this temporary workspace. Verify its exact content.',
  implementationGuide: 'Only change result.txt in the current temporary workspace. Use the configured local task MCP to record start and completion.',
  verificationCriteria: 'A shell assertion must verify the exact contents of result.txt.',
  status: 'pending', dependencies: [], relatedFiles: [], createdAt: now, updatedAt: now }] }))
const runner = new CodexRunner({ root, tasksFile: path.join(dataDir, 'tasks.json'), stateDir: path.join(root, 'runs'),
  spawnProcess(command, args, options) {
    if (args[0] === 'exec') args = [...args.slice(0, -1), '--skip-git-repo-check',
      '-c', 'mcp_servers.retire-together-shrimp.command="/bin/sh"',
      '-c', `mcp_servers.retire-together-shrimp.args=${JSON.stringify([path.join(project, 'scripts/shrimp-mcp.sh')])}`,
      '-c', `mcp_servers.retire-together-shrimp.env.RETIRE_SHRIMP_DATA_DIR=${JSON.stringify(dataDir)}`, '-']
    return spawn(command, args, options)
  },
})
runner.prompt = task => `This is an explicitly authorized isolated integration test. Work only in ${root}.
Use retire-together-shrimp MCP get_task_detail and execute_task for ${task.id}.
Create result.txt containing exactly SHRIMP_SAMPLE_OK (a trailing newline is allowed) and verify with a shell assertion.
Then call verify_task with score 100 and a summary of at least 30 characters describing the actual verification.
Do not read or modify any product repository files. Do not start other tasks. Finally briefly report the result.`
await runner.init()
const timeout = setTimeout(() => runner.cancel(), 180000)
try {
  await runner.start([id]); await runner.worker
  const job = runner.state.jobs[0]
  console.log(JSON.stringify({ status: job.status, message: job.message, answer: job.answer }, null, 2))
  assert.equal(job.status, 'completed')
  assert.equal((await readFile(path.join(root, 'result.txt'), 'utf8')).trim(), 'SHRIMP_SAMPLE_OK')
  assert.equal(await readFile(realFile, 'utf8'), before)
  console.log('PASS: 실제 구독 → 샘플 작업 조회·착수 → 파일 작성·검증 → MCP 완료 기록. 제품 작업 원본 보존.')
} finally { clearTimeout(timeout); if (runner.busy) await runner.cancel() }
