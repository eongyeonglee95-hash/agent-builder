#!/usr/bin/env bash
# Start the React UI and its local API. Stop only children of this script.
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
uv run --locked uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
api_pid=$!
ui_pid=""
cleanup() {
  trap - EXIT INT TERM
  kill "$api_pid" ${ui_pid:+"$ui_pid"} 2>/dev/null || true
  wait "$api_pid" ${ui_pid:+"$ui_pid"} 2>/dev/null || true
}
trap cleanup EXIT INT TERM
# The API must be this process, not an unrelated server already on the port.
for attempt in {1..50}; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid"
    exit 1
  fi
  if curl --silent --fail http://127.0.0.1:8000/api/health >/dev/null; then
    break
  fi
  sleep 0.1
done
kill -0 "$api_pid"
cd "$project_root/web"
npm run dev &
ui_pid=$!
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$ui_pid" 2>/dev/null; do
  sleep 1
done
# A child exit closes the sibling as well, so a broken API cannot leave a UI running.
exit 1
