import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
let pids
try { pids = execFileSync('/usr/sbin/lsof', ['-nP', '-tiTCP:9998', '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean) }
catch (error) { if (error.status === 1) process.exit(0); throw error }
if (pids.length !== 1) throw new Error('9998번 포트의 서버를 식별하지 못했습니다.')
const pid = Number(pids[0])
const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
const cwd = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).split('\n').find(line => line.startsWith('n'))?.slice(1)
if (cwd !== root || !command.endsWith('.tools/shrimp-task-manager/tools/task-viewer/server.js')) throw new Error('다른 프로그램이 9998번 포트를 사용 중입니다. 종료하지 않았습니다.')
const response = await fetch('http://127.0.0.1:9998/api/codex/status', { signal: AbortSignal.timeout(12000) })
if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
  const state = await response.json()
  if (state.busy) throw new Error('Codex 작업이 진행 중입니다. 화면에서 중지하거나 완료된 뒤 다시 시작해 주세요.')
} else if (response.status !== 404 && !(response.ok && response.headers.get('content-type')?.includes('text/html'))) throw new Error('서버 상태를 확인하지 못했습니다. 종료하지 않았습니다.')
process.kill(pid, 'SIGTERM')
for (let i = 0; i < 30; i++) {
  await new Promise(resolve => setTimeout(resolve, 200))
  try { process.kill(pid, 0) } catch { console.log('기존 Shrimp 화면 서버를 종료했습니다.'); process.exit(0) }
}
throw new Error('기존 서버가 아직 종료 중입니다. 잠시 후 다시 실행해 주세요.')
