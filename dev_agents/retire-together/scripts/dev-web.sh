#!/usr/bin/env bash
# Start the React UI and its local API. Stop only children of this script.
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
# 포트: RETIRE_API_PORT(기본 8000)·RETIRE_WEB_PORT(기본 5173). 다른 프로젝트가 쓰고 있으면 바꿔서 띄운다
export RETIRE_API_PORT="${RETIRE_API_PORT:-8000}" RETIRE_WEB_PORT="${RETIRE_WEB_PORT:-5173}"
uv run --locked uvicorn backend.main:app --host 127.0.0.1 --port "$RETIRE_API_PORT" &
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
  if curl --silent --fail "http://127.0.0.1:$RETIRE_API_PORT/api/health" >/dev/null; then
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
