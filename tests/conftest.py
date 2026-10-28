"""공통 픽스처: 테스트는 절대 실제 구글 시트·실제 업로드/스냅샷 폴더에 쓰지 않는다."""
import pytest


@pytest.fixture(autouse=True)
def _no_real_sheets(monkeypatch, tmp_path):
    monkeypatch.setenv("RETIRE_SHEETS", "off")
    monkeypatch.setenv("RETIRE_UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("RETIRE_SNAPSHOT_DIR", str(tmp_path / "snapshots"))
