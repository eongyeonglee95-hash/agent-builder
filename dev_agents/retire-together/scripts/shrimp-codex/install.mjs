// Reproducible extension of the pinned upstream; refuse to overwrite manual edits.
import { readFile, writeFile, copyFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const upstream = path.join(root, '.tools/shrimp-task-manager')
const viewer = path.join(upstream, 'tools/task-viewer')
const hash = text => createHash('sha256').update(text).digest('hex')
const manifestPath = path.join(viewer, '.codex-extension.json')
let previous = {}
try { previous = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim()
if (revision !== '8a3be6bced310c7b660e5cfc3f42e4e5e45f2f61') throw new Error('설치된 Shrimp 버전이 다릅니다. 확장 호환성을 먼저 확인해 주세요.')
const patchOnce = (source, before, after) => {
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) throw new Error(`확장 위치가 달라졌습니다: ${before.slice(0, 70)}`)
  return source.replace(before, after)
}
const files = ['server.js', 'src/components/TaskTable.jsx', 'src/App.jsx', 'src/components/TaskDetailView.jsx']
const pending = []
for (const file of files) {
  const original = execFileSync('git', ['show', `HEAD:tools/task-viewer/${file}`], { cwd: upstream, encoding: 'utf8' })
  const current = await readFile(path.join(viewer, file), 'utf8')
  if (current !== original && hash(current) !== previous[file]) throw new Error(`${file}에 별도 변경이 있습니다. 덮어쓰지 않았습니다.`)
  let updated = original
  if (file === 'server.js') {
    updated = patchOnce(updated, "import http from 'http';", "import http from 'http';\nimport { createCodexHandler } from '../../../../scripts/shrimp-codex/http.mjs';")
    updated = patchOnce(updated, '    const server = http.createServer(async (req, res) => {',
      `    const codexHandler = await createCodexHandler();\n    for (const signal of ['SIGINT', 'SIGTERM']) {\n        process.once(signal, async () => {\n            await codexHandler.runner.cancel();\n            if (codexHandler.runner.worker) await codexHandler.runner.worker;\n            process.exit(0);\n        });\n    }\n    const server = http.createServer(async (req, res) => {\n        if (await codexHandler(req, res)) return;`)
  } else if (file === 'src/App.jsx') {
    updated = patchOnce(updated, '  const [tasks, setTasks] = useState([]);', '  const [tasks, setTasks] = useState([]);\n  const [codexTaskStatuses, setCodexTaskStatuses] = useState({});')
    updated = patchOnce(updated, '    const inProgress = tasks.filter(t => t.status === \'in_progress\').length;', `    const waiting = selectedProfile === 'retire-together' ? tasks.filter(t => t.status === 'in_progress' && codexTaskStatuses[t.id] === 'awaiting_confirmation').length : 0;\n    const retry = selectedProfile === 'retire-together' ? tasks.filter(t => t.status === 'in_progress' && codexTaskStatuses[t.id] === 'retry_required').length : 0;\n    const inProgress = tasks.filter(t => t.status === 'in_progress').length - waiting - retry;`)
    updated = patchOnce(updated, '    return { total, completed, inProgress, pending };\n  }, [tasks]);', '    return { total, completed, inProgress, pending, waiting, retry };\n  }, [tasks, selectedProfile, codexTaskStatuses]);')
    updated = patchOnce(updated, '                    <div className="stat-card" name="pending-tasks-counter"', `                    {selectedProfile === 'retire-together' && <div className="stat-card" name="waiting-tasks-counter" title="실행 종료 후 추가 확인이 필요한 작업"><h3>확인 대기</h3><div className="value">{stats.waiting}</div></div>}\n                    <div className="stat-card" name="pending-tasks-counter"`)
    updated = patchOnce(updated, '                <TaskTable ', '                <TaskTable codexTaskStatuses={codexTaskStatuses} onTaskStatusesChange={setCodexTaskStatuses} ')
    updated = patchOnce(updated, '                    <div className="stat-card" name="pending-tasks-counter"', `                    {selectedProfile === 'retire-together' && <div className="stat-card" name="retry-tasks-counter" title="실행 오류 또는 중단 후 다시 실행할 작업"><h3>재실행 필요</h3><div className="value">{stats.retry}</div></div>}\n                    <div className="stat-card" name="pending-tasks-counter"`)
  } else if (file === 'src/components/TaskDetailView.jsx') {
    updated = patchOnce(updated, 'function TaskDetailView({ task,', 'function TaskDetailView({ displayStatus, task,')
    updated = patchOnce(updated, '<span className={`status-badge status-${task.status}`} style={{ backgroundColor: getStatusColor(task.status) }}>\n              {task.status?.replace(\'_\', \' \')}', '<span className={`status-badge status-${displayStatus || task.status}`} style={["awaiting_confirmation", "retry_required"].includes(displayStatus) ? undefined : { backgroundColor: getStatusColor(task.status) }}>\n              {{ awaiting_confirmation: "확인 대기", retry_required: "재실행 필요" }[displayStatus] || task.status?.replace("_", " ")}')
  } else {
    updated = patchOnce(updated, 'function TaskTable({ data,', 'function TaskTable({ codexTaskStatuses = {}, onTaskStatusesChange, data,')
    updated = patchOnce(updated, "import Tooltip from './Tooltip';", "import Tooltip from './Tooltip';\nimport CodexPanel from './CodexPanel';")
    updated = patchOnce(updated, '  const [loading, setLoading] = useState(false);', '  const [loading, setLoading] = useState(false);\n  const [codexAssignments, setCodexAssignments] = useState({});')
    updated = patchOnce(updated, "        const currentAgent = row.original.agent || '';", `        if (profileId === 'retire-together' && codexAssignments[row.original.id]) return <span className="codex-assigned">Codex · 구독</span>;\n        const currentAgent = row.original.agent || '';`)
    updated = patchOnce(updated, 'onTaskSaved, selectedRows]);', 'onTaskSaved, selectedRows, codexAssignments, codexTaskStatuses]);')
    updated = patchOnce(updated, '      {showBulkActions && (', `      {profileId === 'retire-together' && <CodexPanel selectedRows={selectedRows} onAssignmentsChange={setCodexAssignments} onTaskStatusesChange={onTaskStatusesChange} onTaskSaved={onTaskSaved} />}\n      {showBulkActions && profileId !== 'retire-together' && (`)
    updated = patchOnce(updated, `      cell: ({ getValue }) => (\n        <span className={\`status-badge status-\${getValue()}\`}>\n          {getValue()?.replace('_', ' ')}\n        </span>\n      ),`, `      cell: ({ getValue, row }) => {\n        const status = profileId === 'retire-together' ? codexTaskStatuses[row.original.id] || getValue() : getValue();\n        return <span className={\`status-badge status-\${status}\`}>{{ awaiting_confirmation: '확인 대기', retry_required: '재실행 필요' }[status] || status?.replace('_', ' ')}</span>;\n      },`)
    updated = patchOnce(updated, "row.original.status === 'in_progress' ? 'task-in-progress' : ''", "row.original.status === 'in_progress' && !(profileId === 'retire-together' && ['awaiting_confirmation', 'retry_required'].includes(codexTaskStatuses[row.original.id])) ? 'task-in-progress' : ''")
    updated = patchOnce(updated, '        <TaskDetailView ', `        <TaskDetailView displayStatus={profileId === 'retire-together' ? codexTaskStatuses[selectedTask.id] : undefined} `)
    // The panel unmounts in detail view; keep status polling there, including direct links.
    updated = patchOnce(updated, '  // Generate task number mapping', `  useEffect(() => {\n    if (profileId !== 'retire-together' || !selectedTask) return;\n    let mounted = true, timer;\n    const poll = async () => {\n      try { const response = await fetch('/api/codex/status', { cache: 'no-store' }); const result = await response.json(); if (mounted && response.ok) onTaskStatusesChange?.(result.taskDisplayStatuses ?? {}); } catch { /* Keep the last known task display during a transient outage. */ }\n      if (mounted) timer = setTimeout(poll, 2000);\n    };\n    poll(); return () => { mounted = false; clearTimeout(timer); };\n  }, [profileId, selectedTask?.id, onTaskStatusesChange]);\n\n  // Generate task number mapping`)
  }
  pending.push({ file, updated })
}
// All compatibility checks complete before touching the installed source.
for (const { file, updated } of pending) { await writeFile(path.join(viewer, file), updated); previous[file] = hash(updated) }
for (const file of ['CodexPanel.jsx', 'codex-panel.css']) await copyFile(path.join(here, file), path.join(viewer, 'src/components', file))
await writeFile(manifestPath, JSON.stringify(previous, null, 2))
console.log('Shrimp Codex 구독 확장 적용 완료. Task Viewer를 빌드한 뒤 다시 시작해 주세요.')
