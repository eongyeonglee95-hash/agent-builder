"""SHARE-03: real routes/SQLite/Google adapter, synthetic signed OAuth and files.

No Google account, real financial data or development server is used.
"""
from concurrent.futures import ThreadPoolExecutor
import base64
from hashlib import sha256
import json
import select
import sqlite3
import subprocess
import sys
import time
from types import SimpleNamespace
from urllib.parse import parse_qs, unquote, urlsplit

from fastapi import HTTPException
from fastapi.testclient import TestClient
from google.auth import jwt
import pytest
import requests

from backend import auth, auth_config, auth_google, ledger, shared_sheets, storage
from backend.auth_store import digest
from backend.main import app
from backend.shared_sheets_google import DRIVE, FILE_SCOPE, MIME, GoogleFiles
from backend.shared_sheets_store import SheetStore
from tools import sheets
from tests.test_web_auth import signing_material, setup, client, login, ORIGIN  # reuse isolated auth fixtures

SID = "synthetic_common_sheet_123456789"
OTHER = "synthetic_other_sheet_123456789"
ROOT = "/api/google/shared"


def response(body=None, status=200):
    r = requests.Response()
    r.status_code = status
    r._content = json.dumps(body or {}).encode()
    return r


class FakeGoogle:
    def __init__(self):
        self.files = {}
        self.calls = []
        self.create_failure = None
        self.status = 200
        self.delay = 0
        self.hidden = False
        self.fail_prepare = False

    def add(self, sid=SID, *, operation=None):
        self.files[sid] = {
            "meta": {"id": sid, "name": "합성 파일", "mimeType": MIME, "trashed": False,
                     "ownedByMe": True, "capabilities": {"canEdit": True},
                     "appProperties": {"retire_operation": operation} if operation else {}},
            "tabs": {t: [list(c)] for t, c in sheets.TABS.items()},
        }
        return self.files[sid]

    def request(self, method, url, *, headers, timeout, allow_redirects, params=None, json=None):
        assert headers == {"Authorization": "Bearer synthetic-file-token"}
        assert allow_redirects is False and timeout == 20
        self.calls.append((method, url, params, json))
        if self.status != 200:
            return response({"error": {"message": "must-not-leak-provider-body"}}, self.status)
        if url == DRIVE and method == "POST":
            time.sleep(self.delay)
            if self.create_failure == "before":
                raise requests.Timeout("must-not-leak-token")
            assert json["mimeType"] == MIME and "permissions" not in json
            assert not self.files, "duplicate create"
            self.add(operation=json["appProperties"]["retire_operation"])["tabs"] = {}
            if self.create_failure == "lost":
                raise requests.Timeout("must-not-leak-token")
            if self.create_failure == "bad_response":
                return response({})
            return response({"id": SID})
        if url == DRIVE and method == "GET":
            assert "appProperties has" in params["q"]
            return response({"files": [] if self.hidden else [{"id": sid} for sid, f in self.files.items()
                             if f["meta"]["appProperties"].get("retire_operation", "not-matching") in params["q"]]})
        if url.startswith(DRIVE + "/"):
            sid = url.rsplit("/", 1)[1]
            return response(self.files[sid]["meta"]) if sid in self.files else response(status=404)
        assert url.startswith(sheets.API + "/")
        tail = unquote(url[len(sheets.API) + 1:])
        sid = tail.split(":", 1)[0].split("/", 1)[0]
        if sid not in self.files:
            return response(status=404)
        tabs = self.files[sid]["tabs"]
        if tail.endswith(":batchUpdate"):
            if self.fail_prepare:
                self.fail_prepare = False
                return response(status=503)
            for item in json["requests"]:
                title = item["addSheet"]["properties"]["title"]
                assert title not in tabs
                tabs[title] = []
            return response()
        if "/values/" not in tail:
            return response({"sheets": [{"properties": {"title": t}} for t in tabs]})
        tab = tail.split("/values/", 1)[1].split("!", 1)[0]
        if method == "PUT":
            # Initialization may write headers, never test financial rows.
            assert not tabs[tab] and json["values"] == [sheets.TABS[tab]]
            tabs[tab] = json["values"]
            return response()
        assert method == "GET", "unexpected financial write"
        values = tabs[tab]
        if tail.rsplit(":", 1)[-1].endswith("1"):
            values = values[:1]
        return response({"values": values})

    @property
    def creates(self):
        return sum(m == "POST" and url == DRIVE for m, url, _, _ in self.calls)


@pytest.fixture
def shared(setup, client, monkeypatch):
    login(client, setup)
    config = auth_config.load_config()
    identity = client.get("/api/auth/session").json()
    store = SheetStore(config.db_path)
    headers = {"Origin": ORIGIN, "X-Retire-CSRF": identity["csrf_token"]}
    fake = FakeGoogle()
    monkeypatch.setenv("RETIRE_SHEETS", "on")
    monkeypatch.delenv("RETIRE_GOOGLE_PICKER_API_KEY", raising=False)
    monkeypatch.delenv("RETIRE_GOOGLE_PROJECT_NUMBER", raising=False)
    monkeypatch.setattr(requests, "request", fake.request)
    # Using a desktop credential is always a regression in these tests.
    def legacy_forbidden(*args, **kwargs):
        raise AssertionError("legacy global Google connection used")
    monkeypatch.setattr(sheets, "open_sheets", legacy_forbidden)
    original_exchange = requests.post
    grant_data = {"access_token": "synthetic-file-token", "refresh_token": "synthetic-refresh",
                  "expires_in": 3600, "token_type": "Bearer", "scope": "openid email " + FILE_SCOPE}
    refresh_calls = []
    def exchange(url, **kwargs):
        if kwargs["data"]["grant_type"] == "refresh_token":
            assert kwargs["allow_redirects"] is False
            refresh_calls.append(True)
            return response({**grant_data, "refresh_token": "rotated-refresh"})
        r = original_exchange(url, **kwargs)
        return response({**r.json(), **grant_data})
    monkeypatch.setattr(requests, "post", exchange)
    return SimpleNamespace(config=config, store=store, identity=identity, headers=headers,
                           fake=fake, grant_data=grant_data, refresh_calls=refresh_calls)


def consent(client, setup, shared, *, sub="owner-sub", claims=None):
    result = client.post(ROOT + "/connect", headers=shared.headers)
    assert result.status_code == 200, result.text
    q = parse_qs(urlsplit(result.json()["authorization_url"]).query)
    assert set(q["scope"][0].split()) == {"openid", "email", FILE_SCOPE}
    assert q["access_type"] == ["offline"] and q["include_granted_scopes"] == ["false"]
    assert "client_secret" not in q
    with shared.store.connection() as db:
        flow = db.execute("SELECT * FROM sheet_flows WHERE state_hash=?", (digest(q["state"][0]),)).fetchone()
    assert q["code_challenge"] == [base64.urlsafe_b64encode(sha256(flow["verifier"].encode()).digest()).rstrip(b"=").decode()]
    payload = {"sub": sub, "email": "owner@example.test", "email_verified": True, "nonce": q["nonce"][0],
               "iss": "https://accounts.google.com", "aud": shared.config.client_id,
               "iat": int(time.time()) - 1, "exp": int(time.time()) + 600, **(claims or {})}
    code = "file-code-" + q["state"][0]
    setup.tokens[code] = (jwt.encode(setup.signer, payload).decode(), flow["verifier"])
    return {"state": q["state"][0], "code": code}


def authorize(client, setup, shared):
    result = client.get(auth_config.CALLBACK, params=consent(client, setup, shared))
    assert result.status_code == 303, result.text


def create(client, shared):
    return client.post(ROOT + "/spreadsheet", headers=shared.headers)


def test_grant_is_separate_bound_and_private(client, setup, shared):
    assert shared.store.grant(shared.identity["user_id"]) is None
    authorize(client, setup, shared)
    grant = shared.store.grant(shared.identity["user_id"])
    assert grant["refresh_token"] == "synthetic-refresh"
    assert shared.store.path.stat().st_mode & 0o777 == 0o600
    assert "synthetic-file-token" not in client.get(ROOT + "/status").text
    assert "synthetic-refresh" not in client.get("/api/auth/session").text
    assert not (setup.path / "google" / "token.json").exists()


@pytest.mark.parametrize("claims,sub,status", [({}, "other-sub", 403), ({"nonce": "wrong"}, "owner-sub", 400),
    ({"email_verified": False}, "owner-sub", 400), ({"exp": 1}, "owner-sub", 400)])
def test_file_consent_verifies_identity(client, setup, shared, claims, sub, status):
    params = consent(client, setup, shared, sub=sub, claims=claims)
    assert client.get(auth_config.CALLBACK, params=params).status_code == status
    assert shared.store.grant(shared.identity["user_id"]) is None
    assert client.get(auth_config.CALLBACK, params=params).status_code == 400


@pytest.mark.parametrize("change", ["session", "browser", "expired", "cancel", "duplicate"])
def test_file_flow_binding_and_cancellation(client, setup, shared, change):
    params = consent(client, setup, shared)
    if change == "session":
        client.cookies.set(shared.config.session_cookie, "wrong-session", domain="127.0.0.1", path="/")
    elif change == "browser":
        client.cookies.set(shared.config.flow_cookie + "_files", "wrong-browser", domain="127.0.0.1", path="/")
    elif change == "expired":
        with shared.store.connection() as db:
            db.execute("UPDATE sheet_flows SET expires_at=0")
    elif change == "cancel":
        params = {"state": params["state"], "error": "access_denied"}
    else:
        params = [("state", params["state"]), ("state", "duplicate"), ("code", params["code"])]
    assert client.get(auth_config.CALLBACK, params=params).status_code == 400
    assert shared.store.grant(shared.identity["user_id"]) is None


def test_missing_scope_cannot_authorize_files(client, setup, shared):
    shared.grant_data["scope"] = "openid email"
    assert client.get(auth_config.CALLBACK, params=consent(client, setup, shared)).status_code == 409
    assert shared.store.grant(shared.identity["user_id"]) is None


@pytest.mark.parametrize("case,reason", [("cancel", "cancelled"), ("stranger", "owner"), ("scope", "failed")])
def test_browser_file_consent_failure_returns_to_app_without_grant(client, setup, shared, case, reason):
    params = consent(client, setup, shared, sub="stranger-sub" if case == "stranger" else "owner-sub")
    if case == "cancel":
        params = {"state": params["state"], "error": "access_denied"}
    if case == "scope":
        shared.grant_data["scope"] = "openid email"
    result = client.get(auth_config.CALLBACK, params=params, headers={"Accept": "text/html"})
    assert result.status_code == 303
    assert result.headers["location"] == shared.config.origin + "/?sheet_connection=" + reason
    assert shared.store.grant(shared.identity["user_id"]) is None
    assert shared.store.binding(shared.identity["household_id"]) is None
    assert client.get("/api/auth/session").status_code == 200


def test_create_once_restore_after_login_and_new_store(client, setup, shared):
    authorize(client, setup, shared)
    first = create(client, shared)
    assert first.status_code == 200, first.text
    assert first.json()["spreadsheet"]["spreadsheet_id"] == SID
    assert first.json()["migrated"] == 0 and first.json()["read_only"] is True
    assert create(client, shared).json() == first.json()
    assert SheetStore(shared.store.path).binding(1)["spreadsheet_id"] == SID
    assert client.post("/api/auth/logout", headers=shared.headers).status_code == 204
    login(client, setup)
    restored = client.get(ROOT + "/status").json()
    assert restored["active"] and restored["spreadsheet"]["spreadsheet_id"] == SID
    assert shared.fake.creates == 1
    assert shared.store.grant(shared.identity["user_id"]) is not None


@pytest.mark.parametrize("mode", ["lost", "bad_response"])
def test_uncertain_success_recovers_same_file(client, setup, shared, mode):
    authorize(client, setup, shared)
    shared.fake.create_failure = mode
    assert create(client, shared).status_code in (422, 503)
    assert shared.store.binding(1)["spreadsheet_id"] is None
    result = create(client, shared)
    assert result.status_code == 200, result.text
    assert result.json()["spreadsheet"]["spreadsheet_id"] == SID and shared.fake.creates == 1


@pytest.mark.parametrize("mode", ["before", "lost"])
def test_unknown_create_never_reissued_or_switched(client, setup, shared, mode):
    authorize(client, setup, shared)
    shared.fake.create_failure = mode
    shared.fake.hidden = True
    assert create(client, shared).status_code == 503
    for _ in range(2):
        assert create(client, shared).status_code == 409
    assert shared.fake.creates == 1
    assert client.put(ROOT + "/spreadsheet", json={"spreadsheet_id": OTHER}, headers=shared.headers).status_code == 409
    assert client.get("/api/assets").status_code == 409


def test_schema_initialization_failure_keeps_file_and_retries(client, setup, shared):
    authorize(client, setup, shared)
    shared.fake.fail_prepare = True
    assert create(client, shared).status_code == 503
    assert shared.store.binding(1)["spreadsheet_id"] == SID
    assert not shared.store.binding(1)["ready"]
    assert client.get("/api/assets").status_code == 409
    assert create(client, shared).status_code == 200
    assert shared.fake.creates == 1


def test_multi_tab_create_and_select_are_serialized(client, setup, shared):
    authorize(client, setup, shared)
    shared.fake.delay = .12
    cookies = dict(client.cookies)
    def attempt(i):
        with TestClient(app, base_url=ORIGIN, cookies=cookies, follow_redirects=False) as tab:
            return create(tab, shared).status_code
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(attempt, range(6)))
    assert 200 in results and set(results) <= {200, 409}
    assert shared.fake.creates == 1


def test_operation_lock_cross_process(shared):
    # A clean interpreter avoids inheriting TestClient threads or pytest's
    # app/Streamlit module aliases from unrelated tests in the full suite.
    code = """import sys
from pathlib import Path
from backend.shared_sheets_store import SheetStore
with SheetStore(Path(sys.argv[1])).operation():
    print('locked', flush=True)
    sys.stdin.readline()
"""
    process = subprocess.Popen([sys.executable, "-c", code, str(shared.store.path)],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert select.select([process.stdout], [], [], 5)[0]
        assert process.stdout.readline().strip() == "locked"
        with pytest.raises(HTTPException) as error:
            with SheetStore(shared.store.path).operation():
                pytest.fail("cross-process lock not held")
        assert error.value.status_code == 409
    finally:
        _, stderr = process.communicate("\n", timeout=5)
    assert process.returncode == 0, stderr
    with shared.store.operation():
        pass


def test_select_existing_reads_only_and_preserves_financial_db(client, setup, shared):
    authorize(client, setup, shared)
    source = shared.fake.add()
    cols = sheets.ASSET_COLUMNS
    row = {"id": "synthetic-row", "owner": "me", "pocket": "cash", "assetClass": "cash", "amount": 1234,
           "name": "합성 자산", "version": 1}
    source["tabs"][sheets.ASSET_TAB].append([row.get(c, "") for c in cols])
    before = json.dumps(source, sort_keys=True)
    financial_before = storage.DB_PATH.read_bytes() if storage.DB_PATH.exists() else None
    selected = client.put(ROOT + "/spreadsheet", json={"spreadsheet_id": SID}, headers=shared.headers)
    assert selected.status_code == 200, selected.text
    # Connection checks only need headers; don't download financial rows.
    assert all(url.endswith("1") for _, url, _, _ in shared.fake.calls if "/values/" in url)
    assert client.get("/api/assets").json()[0]["amount"] == 1234
    assert json.dumps(source, sort_keys=True) == before
    assert all(method == "GET" for method, _, _, _ in shared.fake.calls)
    assert (storage.DB_PATH.read_bytes() if storage.DB_PATH.exists() else None) == financial_before
    assert client.put(ROOT + "/spreadsheet", json={"spreadsheet_id": OTHER}, headers=shared.headers).status_code == 409
    with pytest.raises(sqlite3.IntegrityError):
        with shared.store.connection() as db:
            db.execute("UPDATE household_sheets SET spreadsheet_id=?", (OTHER,))


def test_supported_shorter_headers_keep_existing_rows(client, setup, shared):
    authorize(client, setup, shared)
    source = shared.fake.add()
    asset_cols = sheets.ASSET_COLUMNS[:13]
    holding_cols = sheets.HOLDING_COLUMNS[:7]
    row = {"id": "synthetic-legacy-row", "owner": "me", "pocket": "cash", "assetClass": "cash",
           "amount": 1234, "name": "합성 이전 양식", "version": 1}
    source["tabs"][sheets.ASSET_TAB] = [asset_cols, [row.get(c, "") for c in asset_cols]]
    source["tabs"][sheets.HOLDING_TAB] = [holding_cols]
    before = json.dumps(source)
    assert client.put(ROOT + "/spreadsheet", json={"spreadsheet_id": SID}, headers=shared.headers).status_code == 200
    assert client.get(ROOT + "/status").json()["active"] is True
    assert client.get("/api/assets").json()[0]["amount"] == 1234
    assert json.dumps(source) == before
    assert all(method == "GET" for method, _, _, _ in shared.fake.calls)


@pytest.mark.parametrize("patch", [{"ownedByMe": False}, {"trashed": True}, {"mimeType": "text/plain"},
                                  {"capabilities": {"canEdit": False}}])
def test_only_owner_owned_editable_sheet_accepted(client, setup, shared, patch):
    authorize(client, setup, shared)
    shared.fake.add()["meta"].update(patch)
    r = client.put(ROOT + "/spreadsheet", json={"spreadsheet_id": SID}, headers=shared.headers)
    assert r.status_code == 409
    assert shared.store.binding(1) is None
    assert all(m == "GET" for m, _, _, _ in shared.fake.calls)


@pytest.mark.parametrize("change", ["missing_tab", "wrong_header", "empty_tab", "empty_header", "blank_header"])
def test_existing_bad_schema_never_rewritten(client, setup, shared, change):
    authorize(client, setup, shared)
    tabs = shared.fake.add()["tabs"]
    if change == "missing_tab":
        tabs.pop(sheets.HOLDING_TAB)
    elif change == "empty_tab":
        tabs[sheets.ASSET_TAB] = []
    elif change == "empty_header":
        tabs[sheets.ASSET_TAB] = [[], ["synthetic-existing-row"]]
    elif change == "blank_header":
        tabs[sheets.ASSET_TAB] = [["", "  "]]
    else:
        tabs[sheets.ASSET_TAB] = [["important user's data"]]
    before = json.dumps(tabs)
    assert client.put(ROOT + "/spreadsheet", json={"spreadsheet_id": SID}, headers=shared.headers).status_code == 409
    assert shared.store.binding(1) is None and json.dumps(tabs) == before
    assert all(method == "GET" for method, _, _, _ in shared.fake.calls)


@pytest.mark.parametrize("tab", list(sheets.TABS))
@pytest.mark.parametrize("change", ["missing_tab", "wrong_header", "empty_tab"])
def test_restore_rechecks_schema_without_rewriting_or_unbinding(client, setup, shared, tab, change):
    authorize(client, setup, shared)
    assert create(client, shared).status_code == 200
    binding = shared.store.binding(1)
    tabs = shared.fake.files[SID]["tabs"]
    original = tabs[tab]
    if change == "missing_tab":
        del tabs[tab]
    else:
        tabs[tab] = [["synthetic-unrelated-header"]] if change == "wrong_header" else []
    before = json.dumps(tabs)
    call_count = len(shared.fake.calls)
    assert client.post("/api/auth/logout", headers=shared.headers).status_code == 204
    login(client, setup)
    shared.headers["X-Retire-CSRF"] = client.get("/api/auth/session").json()["csrf_token"]
    result = client.get(ROOT + "/status").json()
    assert result["health"] == "attention" and result["active"] is False
    assert result["spreadsheet"]["spreadsheet_id"] == SID
    assert create(client, shared).status_code == 409
    assert client.put(ROOT + "/spreadsheet", json={"spreadsheet_id": SID}, headers=shared.headers).status_code == 409
    assert json.dumps(tabs) == before and shared.store.binding(1) == binding
    assert all(method == "GET" for method, _, _, _ in shared.fake.calls[call_count:])
    # Repair belongs to the file owner; the app only rechecks the same binding.
    tabs[tab] = original
    assert client.get(ROOT + "/status").json()["active"] is True
    assert create(client, shared).status_code == 200
    assert shared.fake.creates == 1 and shared.store.binding(1) == binding


def test_blank_header_after_binding_is_not_an_empty_ledger(client, setup, shared):
    authorize(client, setup, shared)
    assert create(client, shared).status_code == 200
    shared.fake.files[SID]["tabs"][sheets.ASSET_TAB] = []
    assert client.get("/api/assets").status_code in (409, 503)
    assert shared.store.binding(1)["spreadsheet_id"] == SID
    assert shared.fake.creates == 1


@pytest.mark.parametrize("code", [401, 403, 404, 429, 500])
def test_errors_retain_binding_no_local_fallback_or_create(client, setup, shared, code):
    authorize(client, setup, shared)
    assert create(client, shared).status_code == 200
    shared.fake.status = code
    status = client.get(ROOT + "/status")
    assert status.json()["health"] == "attention" and not status.json()["active"]
    assert status.json()["spreadsheet"]["spreadsheet_id"] == SID
    assert "must-not-leak" not in status.text
    assert client.get("/api/assets").status_code in (409, 503)
    assert create(client, shared).status_code in (409, 503)
    assert shared.fake.creates == 1 and shared.store.binding(1)["spreadsheet_id"] == SID


def test_ownership_transfer_does_not_change_fixed_owner(client, setup, shared):
    authorize(client, setup, shared)
    assert create(client, shared).status_code == 200
    shared.fake.files[SID]["meta"]["ownedByMe"] = False
    assert client.get("/api/assets").status_code == 409
    assert client.get(ROOT + "/status").json()["health"] == "attention"
    assert client.get("/api/auth/session").json()["owner_user_id"] == shared.identity["owner_user_id"]


def test_disconnect_and_reconsent_keep_binding_and_session(client, setup, shared):
    authorize(client, setup, shared)
    assert create(client, shared).status_code == 200
    r = client.delete(ROOT + "/connection", headers=shared.headers)
    assert r.json()["spreadsheet"]["spreadsheet_id"] == SID and not r.json()["connected"]
    assert client.get("/api/assets").status_code == 409
    assert client.get("/api/auth/session").status_code == 200
    assert create(client, shared).status_code == 409
    authorize(client, setup, shared)
    assert client.get(ROOT + "/status").json()["active"]
    assert shared.fake.creates == 1


def test_refresh_is_persisted_and_failure_does_not_unbind(client, setup, shared, monkeypatch):
    authorize(client, setup, shared)
    assert create(client, shared).status_code == 200
    with shared.store.connection() as db:
        db.execute("UPDATE sheet_grants SET expires_at=0")
    assert client.get(ROOT + "/status").json()["active"]
    assert len(shared.refresh_calls) == 1
    assert shared.store.grant(shared.identity["user_id"])["refresh_token"] == "rotated-refresh"
    with shared.store.connection() as db:
        db.execute("UPDATE sheet_grants SET expires_at=0")
    monkeypatch.setattr(requests, "post", lambda *a, **kw: response({"error": "invalid_grant"}, 400))
    assert client.get("/api/assets").status_code == 409
    assert shared.store.binding(1)["spreadsheet_id"] == SID and shared.fake.creates == 1


def test_unbound_web_ignores_legacy_and_bound_writes_disabled(client, setup, shared):
    assert client.get("/api/assets").status_code == 200
    authorize(client, setup, shared)
    assert create(client, shared).status_code == 200
    api = GoogleFiles(shared.config, shared.store, shared.identity["user_id"])
    with pytest.raises(HTTPException) as error:
        api.sheets(SID).write(sheets.ASSET_TAB, [])
    assert error.value.status_code == 409
    with pytest.raises(HTTPException):
        ledger.open_sheets()  # no authenticated request context


def test_csrf_third_party_and_partner_cannot_create_household_file(client, setup, shared):
    assert client.post(ROOT + "/connect").status_code == 403
    assert client.post(ROOT + "/spreadsheet", headers={**shared.headers, "Origin": "https://other.test"}).status_code == 403
    with TestClient(app, base_url=ORIGIN) as outsider:
        assert outsider.get(ROOT + "/status").status_code == 401
    with shared.store.connection() as db:
        db.execute("INSERT INTO users VALUES ('synthetic-partner','partner-sub','partner@example.test')")
        db.execute("INSERT INTO memberships VALUES ('partner-member',1,'synthetic-partner','partner',1)")
    token = shared.store.login("partner-sub", "partner@example.test", False, "")
    with TestClient(app, base_url=ORIGIN, cookies={shared.config.session_cookie: token}) as partner:
        # SHARE-04 permits members to inspect their own grant/common file, while
        # only the fixed owner can create or replace the household binding.
        assert partner.get(ROOT + "/status").status_code == 200
        headers = {"Origin": ORIGIN, "X-Retire-CSRF": auth.csrf_token(token)}
        assert partner.post(ROOT + "/spreadsheet", headers=headers).status_code == 403
    assert shared.fake.creates == 0


def test_picker_config_and_ephemeral_token_contract(client, setup, shared, monkeypatch):
    assert client.post(ROOT + "/picker", headers=shared.headers).status_code == 503
    monkeypatch.setenv("RETIRE_GOOGLE_PICKER_API_KEY", "synthetic-browser-key")
    monkeypatch.setenv("RETIRE_GOOGLE_PROJECT_NUMBER", "123456")
    assert client.post(ROOT + "/picker", headers=shared.headers).status_code == 409
    authorize(client, setup, shared)
    r = client.post(ROOT + "/picker", headers=shared.headers)
    assert r.status_code == 200 and r.json()["access_token"] == "synthetic-file-token"
    assert r.headers["cache-control"] == "no-store" and "refresh" not in r.text
    assert r.json()["expires_at"] > time.time()


def test_off_switch_never_falls_back_after_binding(client, setup, shared, monkeypatch):
    authorize(client, setup, shared)
    assert create(client, shared).status_code == 200
    monkeypatch.setenv("RETIRE_SHEETS", "off")
    assert client.get("/api/assets").status_code == 409
    assert create(client, shared).status_code == 409
    assert shared.store.binding(1)["spreadsheet_id"] == SID


@pytest.mark.parametrize("path,method", [("/api/assets", "POST"), ("/api/register/commit", "POST"),
    ("/api/register/contracts", "POST"), ("/api/family", "PUT"), ("/api/retirement/plan", "PUT"),
    ("/api/register/accounts", "POST"), ("/api/property", "POST")])
def test_shared_write_gate_prevents_local_side_effects(client, setup, shared, path, method):
    authorize(client, setup, shared)
    assert create(client, shared).status_code == 200
    financial_before = storage.DB_PATH.read_bytes() if storage.DB_PATH.exists() else None
    # Rejected at the boundary even before body parsing, snapshot/tag writes.
    r = client.request(method, path, json={}, headers=shared.headers)
    assert r.status_code == 409 and "읽기만" in r.text
    assert (storage.DB_PATH.read_bytes() if storage.DB_PATH.exists() else None) == financial_before
    assert not (setup.path / "snapshots").exists()


def test_setup_and_local_mutation_cannot_overlap(client, setup, shared):
    authorize(client, setup, shared)
    with shared_sheets.financial_write_guard(shared.config, shared.identity):
        assert create(client, shared).status_code == 409
    assert shared.fake.creates == 0 and shared.store.binding(1) is None
    assert create(client, shared).status_code == 200


def test_broad_grant_is_not_accepted(client, setup, shared):
    shared.grant_data["scope"] += " https://www.googleapis.com/auth/drive"
    assert client.get(auth_config.CALLBACK, params=consent(client, setup, shared)).status_code == 409
    assert shared.store.grant(shared.identity["user_id"]) is None


@pytest.mark.parametrize("code", [400, 401, 403, 404, 429])
def test_definitive_create_rejection_can_retry_after_configuration_fix(client, setup, shared, code):
    authorize(client, setup, shared)
    shared.fake.status = code
    assert create(client, shared).status_code == 409
    assert client.get(ROOT + "/status").json()["health"] == "create_rejected"
    binding = shared.store.binding(1)
    assert binding["retryable"] and not binding["spreadsheet_id"]
    assert not shared.fake.files
    shared.fake.status = 200
    assert create(client, shared).status_code == 200
    assert len(shared.fake.files) == 1
    assert shared.store.binding(1)["operation_id"] == binding["operation_id"]


def test_create_server_error_is_ambiguous_not_retryable(client, setup, shared):
    authorize(client, setup, shared)
    shared.fake.status = 500
    assert create(client, shared).status_code == 503
    assert not shared.store.binding(1)["retryable"]
    shared.fake.status = 200
    assert create(client, shared).status_code == 409 and shared.fake.creates == 1


def test_additive_schema_upgrade_keeps_existing_owner_and_pending_operation(client, setup, shared):
    shared.store.reserve(1, "create")
    before = shared.store.binding(1)
    # Emulate the early live-reload table; all real identity rows are synthetic.
    with sqlite3.connect(shared.store.path) as db:
        db.execute("ALTER TABLE household_sheets DROP COLUMN retryable")
    upgraded = SheetStore(shared.store.path)
    assert upgraded.binding(1) == before
    assert client.get("/api/auth/session").json()["owner_user_id"] == shared.identity["owner_user_id"]
    with pytest.raises(sqlite3.IntegrityError):
        with upgraded.connection() as db:
            db.execute("DELETE FROM household_sheets")
