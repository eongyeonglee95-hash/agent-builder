"""Isolated SHARE-02 browser fixture; never loads real credentials or financial data.

Only this test process replaces Google exchange. Signature/nonce validation is
covered by tests/test_web_auth.py using signed synthetic tokens.
"""
import json
import os
import html
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import parse_qs, urlencode, urlsplit
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend import auth_google, storage, shared_sheets_google
from fastapi import HTTPException
import uvicorn


def synthetic_identity(config, code, nonce, verifier):
    if code not in {"owner", "stranger"}:
        raise HTTPException(400, "Synthetic login rejected")
    return f"{code}-sub", f"{code}@example.test"


def synthetic_file_identity(config, code, nonce, verifier):
    sub, email = synthetic_identity(config, code, nonce, verifier)
    return sub, email, {"access_token": "synthetic-file-access", "refresh_token": "synthetic-file-refresh",
                        "expires_in": 3600, "token_type": "Bearer",
                        "scope": "openid email " + shared_sheets_google.FILE_SCOPE}


if __name__ == "__main__":
    port = int(os.environ.get("RETIRE_E2E_PORT", "8779"))
    origin = f"http://127.0.0.1:{port}"
    class Provider(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            query = parse_qs(urlsplit(self.path).query)
            allowed_scopes = ["openid email", "openid email " + shared_sheets_google.FILE_SCOPE]
            if query.get("redirect_uri") != [origin + "/api/auth/google/callback"] or query.get("scope", [None])[0] not in allowed_scopes:
                self.send_error(400)
                return
            state = query["state"][0]
            links = []
            for code, label in [("owner", "테스트 오너"), ("stranger", "테스트 외부 계정"), ("cancel", "취소")]:
                args = {"state": state, **({"error": "access_denied"} if code == "cancel" else {"code": code})}
                url = origin + "/api/auth/google/callback?" + urlencode(args)
                links.append(f'<p><a href="{html.escape(url, quote=True)}">{label}</a></p>')
            body = ('<!doctype html><meta charset="utf-8"><title>격리된 로그인 검수</title>' + ''.join(links)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    provider = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    Thread(target=provider.serve_forever, daemon=True).start()
    original_url = auth_google.authorization_url

    def local_provider(*args, **kwargs):
        query = urlsplit(original_url(*args, **kwargs)).query
        return f"http://localhost:{provider.server_port}/?{query}"

    auth_google.authorization_url = local_provider
    with TemporaryDirectory(prefix="retire-auth-browser-") as directory:
        root = Path(directory)
        credentials = root / "client.json"
        credentials.write_text(json.dumps({"web": {
            "client_id": "synthetic.apps.googleusercontent.com", "client_secret": "synthetic",
            "redirect_uris": [origin + "/api/auth/google/callback"],
        }}))
        credentials.chmod(0o600)
        os.environ.update({
            "RETIRE_AUTH_MODE": "web", "RETIRE_AUTH_ORIGIN": origin,
            "RETIRE_AUTH_BOOTSTRAP": "1", "RETIRE_AUTH_ALLOW_HTTP": "1",
            "RETIRE_GOOGLE_WEB_CLIENT": str(credentials), "RETIRE_AUTH_DB": str(root / "auth.sqlite3"),
            "RETIRE_SHEETS": "on", "RETIRE_UPLOAD_DIR": str(root / "uploads"),
            "RETIRE_SNAPSHOT_DIR": str(root / "snapshots"),
            "RETIRE_ACCOUNTS_PATH": str(root / "accounts.yaml"),
            "RETIRE_ASSET_MAP_PATH": str(root / "asset_map.yaml"),
            "RETIRE_DECISIONS_PATH": str(root / "DECISIONS.md"),
            "RETIRE_STRATEGIES_PATH": str(root / "strategies.yaml"),
        })
        (root / "accounts.yaml").write_text("accounts: []\npools: {}\n")
        (root / "asset_map.yaml").write_text("assets: {}\nclass_defaults: {}\n")
        shutil.copy(Path(__file__).resolve().parents[2] / "rules/strategies.yaml", root / "strategies.yaml")
        storage.DB_PATH = root / "financial.sqlite3"
        auth_google.exchange_identity = synthetic_identity
        auth_google.exchange_verified = synthetic_file_identity
        # Browser fixtures exercise consent only. Any Drive/Sheets transport is forbidden.
        def reject_google_request(*args, **kwargs):
            raise AssertionError("Real Google file requests are forbidden in the browser fixture")
        shared_sheets_google.GoogleFiles.request = reject_google_request
        try:
            uvicorn.run("backend.main:app", host="127.0.0.1", port=port, log_level="warning")
        finally:
            provider.shutdown()
