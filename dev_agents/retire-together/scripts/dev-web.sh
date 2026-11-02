#!/usr/bin/env bash
# 개발 서버(화면 + 로컬 API)를 하나만 띄운다. 여러 세션(Claude·Codex)이 같이 쓰는 서버다 (2026-11-02 사용자 결정).
#
#   scripts/dev-web.sh            # 이미 떠 있으면 주소만 알려 주고 끝낸다(새로 띄우지 않음). 없으면 띄운다
#   scripts/dev-web.sh --restart  # 이 프로젝트의 개발 서버만 내리고 다시 띄운다 (다른 프로젝트 서버는 건드리지 않음)
#
# 주소는 늘 http://127.0.0.1:5180 (API 8010). 같은 PC의 다른 프로젝트가 5173/8000을 써서 고정했다.
# API는 --reload로 띄워 backend/·tools/·rules/를 고치면 저절로 다시 읽는다 → 어느 세션이 코드를 고쳐도 같은 주소에 바로 반영.
# 화면(Vite)은 원래 저장하면 바로 반영된다. 포트는 RETIRE_API_PORT·RETIRE_WEB_PORT로만 바꾼다(브라우저 테스트처럼 따로 띄울 때).
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
export RETIRE_API_PORT="${RETIRE_API_PORT:-8010}" RETIRE_WEB_PORT="${RETIRE_WEB_PORT:-5180}"
web_url="http://127.0.0.1:$RETIRE_WEB_PORT"
api_url="http://127.0.0.1:$RETIRE_API_PORT"

ours() {   # 이 포트를 듣는 프로세스가 이 프로젝트 것인가
  local pid cmd
  for pid in $(lsof -t -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null); do
    cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    [[ "$cmd" == *"$project_root"* || "$cmd" == *"backend.main:app"* ]] && echo "$pid"
  done
}
busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

if [[ "${1:-}" == "--restart" ]]; then
  echo "이 프로젝트의 개발 서버를 내립니다…"
  pkill -f "$project_root/scripts/dev-web.sh" 2>/dev/null || true
  pkill -f "uvicorn backend.main:app --host 127.0.0.1 --port $RETIRE_API_PORT" 2>/dev/null || true
  for port in "$RETIRE_API_PORT" "$RETIRE_WEB_PORT"; do
    for pid in $(ours "$port"); do kill "$pid" 2>/dev/null || true; done
  done
  for _ in {1..50}; do busy "$RETIRE_API_PORT" || busy "$RETIRE_WEB_PORT" || break; sleep 0.2; done
fi

if busy "$RETIRE_API_PORT" || busy "$RETIRE_WEB_PORT"; then
  if [[ -n "$(ours "$RETIRE_API_PORT")" && -n "$(ours "$RETIRE_WEB_PORT")" ]] && curl -sf "$api_url/api/health" >/dev/null && curl -sf "$web_url/" >/dev/null; then
    echo "개발 서버가 이미 떠 있어요: $web_url  (다시 띄울 필요 없음. 코드가 바뀌면 저절로 반영돼요. 꼭 다시 띄우려면 --restart)"
    exit 0
  fi
  echo "포트 $RETIRE_API_PORT 또는 $RETIRE_WEB_PORT 를 다른 프로그램이 쓰고 있어요. 확인한 뒤 --restart 하거나 포트를 바꿔 주세요." >&2
  lsof -nP -iTCP:"$RETIRE_API_PORT" -iTCP:"$RETIRE_WEB_PORT" -sTCP:LISTEN >&2 || true
  exit 1
fi

uv run --locked uvicorn backend.main:app --host 127.0.0.1 --port "$RETIRE_API_PORT" \
  --reload --reload-dir backend --reload-dir tools --reload-dir rules --reload-include '*.yaml' &
api_pid=$!
ui_pid=""
cleanup() {
  trap - EXIT INT TERM
  kill "$api_pid" ${ui_pid:+"$ui_pid"} 2>/dev/null || true
  wait "$api_pid" ${ui_pid:+"$ui_pid"} 2>/dev/null || true
}
trap cleanup EXIT INT TERM
# The API must be this process, not an unrelated server already on the port.
for attempt in {1..100}; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid"
    exit 1
  fi
  if curl --silent --fail "$api_url/api/health" >/dev/null; then
    break
  fi
  sleep 0.1
done
kill -0 "$api_pid"
cd "$project_root/web"
npm run dev &
ui_pid=$!
echo "개발 서버: $web_url"
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$ui_pid" 2>/dev/null; do
  sleep 1
done
# A child exit closes the sibling as well, so a broken API cannot leave a UI running.
exit 1
