#!/bin/sh
# Keep this MCP server and its task history inside the RetireTogether project.
set -eu
SHRIMP_PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export DATA_DIR="${RETIRE_SHRIMP_DATA_DIR:-$SHRIMP_PROJECT_DIR/data/local/shrimp}"
export TEMPLATES_USE=en
export ENABLE_GUI=false
# The task manager does not need the application's credentials.
export DOTENV_CONFIG_PATH=/dev/null
umask 077
mkdir -p "$DATA_DIR"
cd "$SHRIMP_PROJECT_DIR"
if [ ! -f "$SHRIMP_PROJECT_DIR/.tools/shrimp-task-manager/dist/index.js" ]; then
    echo 'Shrimp 설치본이 없어요. docs/LOCAL_DEVELOPMENT.md의 Shrimp 설치 안내를 확인하세요.' >&2
    exit 1
fi
exec node "$SHRIMP_PROJECT_DIR/.tools/shrimp-task-manager/dist/index.js"
