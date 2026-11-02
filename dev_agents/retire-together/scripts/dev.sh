#!/usr/bin/env bash
# 화면 개발 서버. 기존 서버를 내리고 다시 띄운다.
# PYTHONPATH=. 이어야 Streamlit이 tools/·agent/ 모듈 변경도 감시해서 저장 즉시 다시 불러온다
# (기본은 app/ 안 모듈만 감시 → tools/를 고치면 ImportError·옛 코드가 남는다).
set -euo pipefail
cd "$(dirname "$0")/.."
pkill -f "streamlit run app/main.py" 2>/dev/null || true
sleep 1
exec env PYTHONPATH=. uv run streamlit run app/main.py "$@"
