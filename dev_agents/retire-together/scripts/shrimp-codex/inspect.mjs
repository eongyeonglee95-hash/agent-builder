// Read-only diagnostics, intentionally excludes session tokens and credentials.
const response = await fetch('http://127.0.0.1:9998/api/codex/status')
const state = await response.json()
console.log(JSON.stringify({ auth: state.auth, busy: state.busy, jobs: state.jobs.map(({ name, status, message, answer, logs }) => ({ name, status, message, answer, logs: logs.slice(-5) })) }, null, 2))
