#!/usr/bin/env bash
# Build the UI and serve it with FastAPI on a single local origin.
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root/web"
npm run build
cd "$project_root"
exec uv run --locked uvicorn backend.main:app --host 127.0.0.1 --port 8000
