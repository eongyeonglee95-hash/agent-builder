"""Static checks are secret-free, side-effect-free and never attest live use."""
import json
import pytest
import requests

from backend import auth_config, shared_preflight


@pytest.fixture
def configured(monkeypatch, tmp_path):
    config = tmp_path / "client.json"
    config.write_text(json.dumps({"web": {"client_id": "synthetic.apps.googleusercontent.com",
        "client_secret": "synthetic-secret-marker", "redirect_uris": ["https://app.example" + auth_config.CALLBACK]}}))
    config.chmod(0o600)
    for key, value in {"RETIRE_AUTH_MODE": "web", "RETIRE_AUTH_ORIGIN": "https://app.example",
            "RETIRE_AUTH_ALLOW_HTTP": "0", "RETIRE_AUTH_BOOTSTRAP": "0", "RETIRE_SHEETS": "on",
            "RETIRE_GOOGLE_WEB_CLIENT": str(config), "RETIRE_AUTH_DB": str(tmp_path / "private" / "auth.sqlite3"),
            "RETIRE_GOOGLE_PICKER_API_KEY": "synthetic-picker-marker", "RETIRE_GOOGLE_PROJECT_NUMBER": "1234567890"}.items():
        monkeypatch.setenv(key, value)
    def forbid(*args, **kwargs):
        pytest.fail("preflight must not use network or initialize a database")
    monkeypatch.setattr(requests.sessions.Session, "request", forbid)
    import sqlite3
    monkeypatch.setattr(sqlite3, "connect", forbid)
    return tmp_path


def test_static_success_is_not_live_success_and_no_values_or_writes(configured, capsys):
    before = {p: p.read_bytes() for p in configured.rglob("*") if p.is_file()}
    assert shared_preflight.main([]) == 0
    output = capsys.readouterr().out
    result = json.loads(output)
    assert result["configuration_ok"] and result["live_verification"] == "not_run"
    assert len(result["integration_gaps"]) == 4 and len(result["pending_live_checks"]) == 9
    assert not any(value in output for value in ["synthetic-secret-marker", "synthetic-picker-marker",
        "1234567890", str(configured), "https://app.example", "synthetic.apps.googleusercontent.com"])
    assert before == {p: p.read_bytes() for p in configured.rglob("*") if p.is_file()}
    assert not (configured / "private").exists()


@pytest.mark.parametrize("field,value,check", [
    ("RETIRE_AUTH_MODE", "local", "web_mode"),
    ("RETIRE_SHEETS", "off", "sheets_enabled"),
    ("RETIRE_AUTH_BOOTSTRAP", "1", "bootstrap_closed"),
    ("RETIRE_AUTH_ALLOW_HTTP", "1", "http_disabled"),
    ("RETIRE_GOOGLE_PICKER_API_KEY", "", "picker_config"),
    ("RETIRE_GOOGLE_PICKER_API_KEY", " \n", "picker_config"),
    ("RETIRE_GOOGLE_PROJECT_NUMBER", "project-id", "picker_config"),
    ("RETIRE_GOOGLE_PROJECT_NUMBER", "１２３", "picker_config"),
    ("RETIRE_GOOGLE_PROJECT_NUMBER", "0", "picker_config"),
    ("RETIRE_GOOGLE_PROJECT_NUMBER", "", "picker_config"),
    ("RETIRE_AUTH_ORIGIN", "https://app.example/extra", "oauth_config"),
])
def test_collects_invalid_configuration(configured, monkeypatch, field, value, check):
    monkeypatch.setenv(field, value)
    result = shared_preflight.inspect()
    assert not result["configuration_ok"]
    assert next(c for c in result["checks"] if c["id"] == check)["status"] == "fail"


@pytest.mark.parametrize("bad", ["missing", "public", "malformed"])
def test_oauth_config_failure_still_reports_other_requirements(configured, bad):
    p = configured / "client.json"
    if bad == "missing": p.unlink()
    elif bad == "public": p.chmod(0o644)
    else: p.write_text("synthetic-secret-marker")
    result = shared_preflight.inspect()
    assert not result["configuration_ok"] and result["integration_gaps"]
    assert "synthetic-secret-marker" not in json.dumps(result)


@pytest.mark.parametrize("bad", ["public_db", "public_parent", "linked_db", "linked_backups", "same_ledger"])
def test_unsafe_storage_is_read_only_failure(configured, monkeypatch, bad):
    folder = configured / "private"
    folder.mkdir(mode=0o700)
    db = folder / "auth.sqlite3"
    db.write_bytes(b"synthetic-private-records")
    db.chmod(0o600)
    if bad == "public_db": db.chmod(0o644)
    elif bad == "public_parent": folder.chmod(0o755)
    elif bad == "linked_db":
        link = folder / "link.sqlite3"; link.symlink_to(db)
        monkeypatch.setenv("RETIRE_AUTH_DB", str(link))
    elif bad == "linked_backups": (folder / "shared-data-backups").symlink_to(configured, target_is_directory=True)
    else:
        monkeypatch.setattr(auth_config, "ROOT", configured)
        monkeypatch.setenv("RETIRE_AUTH_DB", str(configured / "data/local/retire-together.sqlite3"))
    before = db.read_bytes(), db.stat().st_mode, folder.stat().st_mode
    assert not shared_preflight.inspect()["configuration_ok"]
    assert before == (db.read_bytes(), db.stat().st_mode, folder.stat().st_mode)


def test_loopback_config_pass_does_not_pass_https_preflight(configured, monkeypatch):
    p = configured / "client.json"
    raw = json.loads(p.read_text())
    raw["web"]["redirect_uris"] = ["http://127.0.0.1:5180" + auth_config.CALLBACK]
    p.write_text(json.dumps(raw))
    monkeypatch.setenv("RETIRE_AUTH_ORIGIN", "http://127.0.0.1:5180")
    monkeypatch.setenv("RETIRE_AUTH_ALLOW_HTTP", "1")
    assert shared_preflight.inspect("local")["configuration_ok"]
    assert not shared_preflight.inspect("https")["configuration_ok"]
