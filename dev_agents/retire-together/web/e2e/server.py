"""Dedicated browser-test server; never opens the household's database."""
import os
import shutil
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend import storage
import uvicorn

with TemporaryDirectory(prefix="retire-browser-") as test_data:
    storage.DB_PATH = Path(test_data) / "test.sqlite3"
    os.environ["RETIRE_AUTH_MODE"] = "local"
    os.environ["RETIRE_AUTH_DB"] = str(Path(test_data) / "auth.sqlite3")
    os.environ["RETIRE_GOOGLE_WEB_CLIENT"] = str(Path(test_data) / "web-client.json")
    # REG-01/SHEET-01: 등록 테스트가 실제 규칙 파일·스냅샷·구글 시트를 건드리지 않도록 임시 경로
    os.environ["RETIRE_SHEETS"] = "off"
    os.environ["RETIRE_ACCOUNTS_PATH"] = str(Path(test_data) / "accounts.yaml")
    os.environ["RETIRE_ASSET_MAP_PATH"] = str(Path(test_data) / "asset_map.yaml")
    os.environ["RETIRE_UPLOAD_DIR"] = str(Path(test_data) / "uploads")
    os.environ["RETIRE_SNAPSHOT_DIR"] = str(Path(test_data) / "snapshots")
    os.environ["RETIRE_DECISIONS_PATH"] = str(Path(test_data) / "DECISIONS.md")
    # 포트폴리오 따라가기·직접 설정 저장이 실제 rules/strategies.yaml을 고치지 않도록 복사본
    os.environ["RETIRE_STRATEGIES_PATH"] = str(Path(test_data) / "strategies.yaml")
    shutil.copy(Path(__file__).resolve().parents[2] / "rules" / "strategies.yaml", os.environ["RETIRE_STRATEGIES_PATH"])
    Path(test_data, "accounts.yaml").write_text("accounts: []\npools: {}\n", encoding="utf-8")
    Path(test_data, "asset_map.yaml").write_text("assets: {}\nclass_defaults: {}\n", encoding="utf-8")
    uvicorn.run("backend.main:app", host="127.0.0.1", port=int(os.environ.get("RETIRE_E2E_PORT", "8765")), log_level="warning")
