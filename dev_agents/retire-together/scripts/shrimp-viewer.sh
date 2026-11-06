#!/bin/sh
# Start the official viewer with the local Codex subscription extension.
set -eu
SHRIMP_PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export SHRIMP_VIEWER_PORT=9998
cd "$SHRIMP_PROJECT_DIR"
if [ "${1:-}" = '--restart' ]; then
    node scripts/shrimp-codex/stop-viewer.mjs
elif [ "$#" -gt 0 ]; then
    echo '사용법: sh scripts/shrimp-viewer.sh [--restart]' >&2
    exit 1
fi
if curl --silent --fail --max-time 2 'http://127.0.0.1:9998/api/agents' >/dev/null; then
    echo 'Shrimp 화면이 이미 열려 있어요: http://127.0.0.1:9998/?lang=ko&profile=retire-together'
    exit 0
fi
if [ ! -f .tools/shrimp-task-manager/tools/task-viewer/dist/index.html ]; then
    echo '먼저 Shrimp Task Viewer를 설치·빌드해 주세요. docs/LOCAL_DEVELOPMENT.md 참고.' >&2
    exit 1
fi
if [ ! -f .tools/shrimp-task-manager/tools/task-viewer/.codex-extension.json ]; then
    echo '먼저 node scripts/shrimp-codex/install.mjs 실행 후 Task Viewer를 빌드해 주세요.' >&2
    exit 1
fi
unset OPENAI_API_KEY CODEX_API_KEY OPEN_AI_KEY_SHRIMP_TASK_VIEWER CODEX_ACCESS_TOKEN
echo 'Shrimp 화면: http://127.0.0.1:9998/?lang=ko&profile=retire-together'
exec node .tools/shrimp-task-manager/tools/task-viewer/server.js
