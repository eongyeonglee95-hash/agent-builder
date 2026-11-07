"""SHARE-02: real signature verification, fake Google transport, temporary auth DB.

No actual OAuth account, sheet, financial database or server process is used.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import base64
from hashlib import sha256
import json
import logging
import sqlite3
import time
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import HTTPException
from fastapi.testclient import TestClient
from google.auth import crypt, jwt
import pytest
import requests

from backend import auth, auth_config, auth_google, auth_store, storage
from backend.main import app

ORIGIN = "http://127.0.0.1:5180"


@pytest.fixture(scope="module")
def signing_material():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "synthetic-google")])
    now = datetime.now(timezone.utc)
    certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                   .public_key(key.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=1))
                   .sign(key, hashes.SHA256()))
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption())
    return crypt.RSASigner.from_string(pem, key_id="synthetic-key"), certificate.public_bytes(serialization.Encoding.PEM).decode()


@pytest.fixture
def setup(monkeypatch, tmp_path, signing_material):
    client_file = tmp_path / "web-client.json"
    client_file.write_text(json.dumps({"web": {
        "client_id": "synthetic.apps.googleusercontent.com", "client_secret": "synthetic-secret",
        "redirect_uris": [ORIGIN + auth_config.CALLBACK, "https://app.example" + auth_config.CALLBACK],
    }}))
    client_file.chmod(0o600)
    monkeypatch.setenv("RETIRE_AUTH_MODE", "web")
    monkeypatch.setenv("RETIRE_AUTH_ORIGIN", ORIGIN)
    monkeypatch.setenv("RETIRE_AUTH_ALLOW_HTTP", "1")
    monkeypatch.setenv("RETIRE_AUTH_BOOTSTRAP", "1")
    monkeypatch.setenv("RETIRE_GOOGLE_WEB_CLIENT", str(client_file))
    monkeypatch.setenv("RETIRE_AUTH_DB", str(tmp_path / "auth.sqlite3"))
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "financial.sqlite3")
    # End-to-end adapter tests retain google-auth's signature/claims verification.
    signer, certificate = signing_material
    tokens, exchanges = {}, []

    def exchange(url, *, data, timeout, allow_redirects):
        assert url == auth_google.TOKEN_URL and timeout == 10 and allow_redirects is False
        assert data["client_secret"] == "synthetic-secret"
        assert data["redirect_uri"] == auth_config.load_config().redirect_uri
        token, verifier = tokens[data["code"]]
        assert data["code_verifier"] == verifier
        exchanges.append(data["code"])
        return SimpleNamespace(status_code=200, json=lambda: {"id_token": token, "access_token": "never-persist"})

    def certificate_response(self, *args, **kwargs):
        return SimpleNamespace(status=200, data=json.dumps({"synthetic-key": certificate}).encode())

    monkeypatch.setattr(auth_google.requests, "post", exchange)
    monkeypatch.setattr(auth_google.BoundedGoogleRequest, "__call__", certificate_response)
    state = SimpleNamespace(client_file=client_file, tokens=tokens, exchanges=exchanges,
                            signer=signer, path=tmp_path, store=auth_store.AuthStore(tmp_path / "auth.sqlite3"))
    yield state


@pytest.fixture
def client(setup):
    with TestClient(app, base_url=ORIGIN, client=("127.0.0.1", 12345), follow_redirects=False) as client:
        yield client


def begin(client, setup, sub="owner-sub", email="owner@example.test", claims=None, popup=False):
    response = client.get("/api/auth/google/login", params={"popup": "1"} if popup else {})
    assert response.status_code == 303, response.text
    query = parse_qs(urlsplit(response.headers["location"]).query)
    assert query["scope"] == ["openid email"]
    assert query["code_challenge_method"] == ["S256"]
    assert "client_secret" not in query
    with setup.store.connection() as db:
        flow = db.execute("SELECT * FROM oauth_flows WHERE state_hash=?",
                          (auth_store.digest(query["state"][0]),)).fetchone()
    assert query["code_challenge"] == [base64.urlsafe_b64encode(
        sha256(flow["verifier"].encode()).digest()).rstrip(b"=").decode()]
    now = int(time.time())
    payload = {"sub": sub, "email": email, "email_verified": True, "nonce": query["nonce"][0],
               "iss": "https://accounts.google.com", "aud": "synthetic.apps.googleusercontent.com",
               "iat": now - 1, "exp": now + 600}
    payload.update(claims or {})
    for key in [k for k, v in payload.items() if v is None]:
        del payload[key]
    code = "code-" + query["state"][0]
    setup.tokens[code] = (jwt.encode(setup.signer, payload).decode(), flow["verifier"])
    return {"state": query["state"][0], "code": code}


def finish(client, params):
    return client.get(auth_config.CALLBACK, params=params, headers={"Sec-Fetch-Site": "cross-site"})


def login(client, setup, **kwargs):
    response = finish(client, begin(client, setup, **kwargs))
    assert response.status_code == 303, response.text
    return client.get("/api/auth/session").json()


def write_headers(session, origin=ORIGIN):
    return {"Origin": origin, "X-Retire-CSRF": session["csrf_token"]}


def test_first_owner_relogin_email_change_session_rotation_and_logout(client, setup):
    first = login(client, setup)
    assert first["role"] == "owner" and first["owner_user_id"] == first["user_id"]
    previous = client.cookies.get("retire_session_local")
    assert client.get("/api/family").status_code == 200
    second = login(client, setup, email="changed@example.test")
    assert second["user_id"] == first["user_id"] and second["member_id"] == first["member_id"]
    assert second["email"] == "changed@example.test"
    assert setup.store.session(previous) is None
    with setup.store.connection() as db:
        assert db.execute("SELECT count(*) FROM households").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 1
    current = client.cookies.get("retire_session_local")
    response = client.post("/api/auth/logout", headers=write_headers(second))
    assert response.status_code == 204
    assert not client.cookies.get("retire_session_local")
    assert setup.store.session(current) is None
    assert client.get("/api/family").status_code == 401
    assert setup.store.initialized()
    assert not (setup.path / "google" / "token.json").exists()
    assert b"never-persist" not in setup.store.path.read_bytes()


@pytest.mark.parametrize("claims", [
    {"iss": "https://evil.example"}, {"aud": "another-client"}, {"azp": "another-client"},
    {"exp": 1}, {"iat": 9999999999}, {"nonce": "wrong"}, {"nonce": None},
    {"email_verified": False}, {"email_verified": "true"}, {"email": None},
    {"sub": None}, {"sub": ""}, {"exp": None}, {"iat": None},
    {"exp": float("nan")}, {"iat": float("nan")}, {"exp": True},
])
def test_invalid_signed_identity_cannot_bootstrap(client, setup, claims):
    params = begin(client, setup, claims=claims)
    response = finish(client, params)
    assert response.status_code == 400
    assert "synthetic-secret" not in response.text
    assert not setup.store.initialized()
    assert not client.cookies.get("retire_session_local")


def test_bad_signature_and_unsigned_tokens_rejected(client, setup):
    params = begin(client, setup)
    token, verifier = setup.tokens[params["code"]]
    parts = token.split(".")
    parts[2] = ("A" if parts[2][0] != "A" else "B") + parts[2][1:]
    setup.tokens[params["code"]] = (".".join(parts), verifier)
    assert finish(client, params).status_code == 400
    params = begin(client, setup)
    _, verifier = setup.tokens[params["code"]]
    setup.tokens[params["code"]] = ("eyJhbGciOiJub25lIn0.e30.", verifier)
    assert finish(client, params).status_code == 400
    assert not setup.store.initialized()


def test_state_browser_binding_expiry_replay_and_cancellation(client, setup):
    params = begin(client, setup)
    assert finish(client, {**params, "state": "x" * 43}).status_code == 400
    assert not setup.exchanges
    params = begin(client, setup)
    with TestClient(app, base_url=ORIGIN, client=("127.0.0.1", 54321)) as other:
        assert finish(other, params).status_code == 400
    assert finish(client, params).status_code == 303
    assert finish(client, params).status_code == 400
    assert len(setup.exchanges) == 1
    params = begin(client, setup)
    with setup.store.connection() as db:
        db.execute("UPDATE oauth_flows SET expires_at=1")
    assert finish(client, params).status_code == 400
    params = begin(client, setup)
    assert finish(client, {"state": params["state"], "error": "access_denied"}).status_code == 400
    assert finish(client, params).status_code == 400
    assert len(setup.exchanges) == 1


def test_third_party_cannot_join_even_with_owner_email(client, setup):
    owner = login(client, setup)
    with TestClient(app, base_url=ORIGIN, client=("127.0.0.1", 54321), follow_redirects=False) as other:
        response = finish(other, begin(other, setup, sub="stranger-sub"))
        assert response.status_code == 403
        assert other.get("/api/assets").status_code == 401
    with setup.store.connection() as db:
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 1
        assert db.execute("SELECT owner_user_id FROM households").fetchone()[0] == owner["user_id"]


def test_bootstrap_requires_operator_loopback_and_explicit_enable(client, setup, monkeypatch):
    monkeypatch.setenv("RETIRE_AUTH_BOOTSTRAP", "0")
    assert client.get("/api/auth/google/login").status_code == 403
    monkeypatch.setenv("RETIRE_AUTH_BOOTSTRAP", "1")
    with TestClient(app, base_url=ORIGIN, client=("192.0.2.1", 1)) as remote:
        assert remote.get("/api/auth/google/login").status_code == 403
    for header in ("Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto"):
        assert client.get("/api/auth/google/login", headers={header: "127.0.0.1"}).status_code == 403
    params = begin(client, setup)
    monkeypatch.setenv("RETIRE_AUTH_BOOTSTRAP", "0")
    assert finish(client, params).status_code == 403
    assert not setup.store.initialized()


def test_concurrent_initialization_and_flow_consumption_are_atomic(setup):
    def attempt(index):
        try:
            return setup.store.login(f"user-{index}", f"user-{index}@example.test", True, "")
        except HTTPException as exc:
            return exc.status_code
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))
    assert sum(isinstance(r, str) for r in results) == 1
    assert results.count(403) == 7
    state, browser, _, _ = setup.store.new_flow("", False)
    def consume(_):
        try:
            return setup.store.consume_flow(state, browser)
        except HTTPException as exc:
            return exc.status_code
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(consume, range(4)))
    assert sum(isinstance(r, dict) for r in results) == 1
    assert results.count(400) == 3


@pytest.mark.parametrize("path", [
    "/api/family", "/api/assets", "/api/dashboard", "/api/register/accounts", "/api/google/status",
    "/api/workbook/report", "/api/retirement", "/api/property-move", "/api/docs", "/api/openapi.json",
    "/api/auth/session", "/api/unknown/download.csv",
])
def test_all_private_api_routes_reject_anonymous(client, path):
    response = client.get(path, headers={"X-Retire-Local": "1", "X-User-Id": "owner", "X-Household-Id": "1"})
    assert response.status_code == 401
    assert response.headers["Cache-Control"] == "no-store"


def test_csrf_and_cross_origin_validation_cannot_be_replaced_by_legacy_header(client, setup):
    session = login(client, setup)
    for headers in ({}, {"Origin": ORIGIN, "X-Retire-Local": "1"},
                    {"Origin": ORIGIN, "X-Retire-CSRF": "wrong"},
                    write_headers(session, "https://attacker.example"),
                    {"X-Retire-CSRF": session["csrf_token"]}):
        assert client.post("/api/auth/logout", headers=headers).status_code == 403
    assert client.get("/api/assets", headers={"Origin": "https://attacker.example"}).status_code == 403
    assert client.get("/api/assets", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert client.get("/api/health", headers={"Host": "attacker.example"}).status_code == 400
    assert client.post("/api/auth/logout", headers=write_headers(session)).status_code == 204


def test_session_expiration_revocation_cookie_tampering_and_restart(client, setup):
    session = login(client, setup)
    token = client.cookies.get("retire_session_local")
    # New store instance represents process restart: identities/sessions persist.
    assert auth_store.AuthStore(setup.store.path).session(token)["user_id"] == session["user_id"]
    assert setup.store.session(token + "x") is None
    with setup.store.connection() as db:
        db.execute("UPDATE memberships SET active=0")
    assert client.get("/api/family").status_code == 401
    assert finish(client, begin(client, setup)).status_code == 403
    with setup.store.connection() as db:
        db.execute("UPDATE memberships SET active=1")
        db.execute("UPDATE sessions SET expires_at=1")
    assert client.get("/api/family").status_code == 401


def test_csrf_authorizes_only_the_logged_in_household_write(client, setup):
    session = login(client, setup)
    family = client.get("/api/family").json()
    payload = {"me": {"name": "합성 오너", "age": 40}, "version": family["version"] if family else 0}
    assert client.put("/api/family", json=payload, headers=write_headers(session)).status_code == 200
    assert client.get("/api/family").json()["me"]["name"] == "합성 오너"
    payload["version"] += 1
    payload["owner_user_id"] = "attacker"
    assert client.put("/api/family", json=payload, headers=write_headers(session)).status_code == 422
    assert client.get("/api/auth/session").json()["user_id"] == session["user_id"]


def test_partner_cannot_use_owner_relative_financial_apis_before_mapping(client, setup):
    login(client, setup)
    # Synthetic membership only: no invitation implementation is added in SHARE-02.
    with setup.store.connection() as db:
        db.execute("INSERT INTO users VALUES ('partner-user', 'partner-sub', 'partner@example.test')")
        db.execute("INSERT INTO memberships VALUES ('partner-member', 1, 'partner-user', 'partner', 1)")
    session = login(client, setup, sub="partner-sub", email="partner@example.test")
    assert session["role"] == "partner" and session["owner_user_id"] != session["user_id"]
    assert client.get("/api/family").status_code == 403
    assert client.put("/api/family", json={}, headers=write_headers(session)).status_code == 403
    assert client.post("/api/auth/logout", headers=write_headers(session)).status_code == 204


def test_duplicate_callback_parameters_and_new_login_invalidate_old_flow(client, setup):
    first = begin(client, setup)
    second = begin(client, setup)
    with setup.store.connection() as db:
        assert db.execute("SELECT count(*) FROM oauth_flows").fetchone()[0] == 1
    response = client.get(auth_config.CALLBACK, params=[
        ("state", second["state"]), ("state", first["state"]), ("code", second["code"])])
    assert response.status_code == 400 and not setup.exchanges
    assert not setup.store.initialized()


def test_owner_change_blocked_at_api_and_storage(client, setup):
    session = login(client, setup)
    assert client.put("/api/auth/household/owner", json={"owner_user_id": "attacker"},
                      headers=write_headers(session)).status_code in (404, 405)
    statements = [
        "UPDATE households SET owner_user_id='attacker'", "DELETE FROM households",
        "UPDATE users SET google_sub='attacker'", "UPDATE users SET id='attacker'",
        "UPDATE memberships SET role='partner'", "UPDATE memberships SET user_id='attacker'",
        "DELETE FROM memberships WHERE role='owner'",
        "INSERT OR REPLACE INTO households VALUES (1, 'attacker')",
    ]
    for sql in statements:
        with pytest.raises(sqlite3.IntegrityError), setup.store.connection() as db:
            db.execute("PRAGMA recursive_triggers=OFF")
            db.execute(sql)
    with pytest.raises(sqlite3.IntegrityError), setup.store.connection() as db:
        db.execute("INSERT OR REPLACE INTO users VALUES (?, 'attacker', 'attacker@example.test')", (session["user_id"],))
    assert client.get("/api/auth/session").json()["owner_user_id"] == session["user_id"]


def test_https_cookie_flags_and_legacy_google_disabled(setup, monkeypatch):
    # Preexisting owner; production never runs the local bootstrap.
    setup.store.login("owner-sub", "owner@example.test", True, "")
    monkeypatch.setenv("RETIRE_AUTH_BOOTSTRAP", "0")
    monkeypatch.setenv("RETIRE_AUTH_ORIGIN", "https://app.example")
    with TestClient(app, base_url="https://app.example", follow_redirects=False) as secure:
        params = begin(secure, setup)
        flow_header = secure.cookies.get("__Host-retire_oauth")
        assert flow_header
        response = finish(secure, params)
        assert response.status_code == 303
        header = response.headers.get_list("set-cookie")[0]
        assert all(value in header for value in ("__Host-retire_session=", "HttpOnly", "Secure", "SameSite=lax", "Path=/"))
        assert "Domain=" not in header
        assert secure.get("/api/google/status").status_code == 409
        assert secure.get("/api/auth/session").status_code == 200


@pytest.mark.parametrize("change", ["missing", "installed", "permissions", "redirect", "http", "public_setup", "mode"])
def test_invalid_configuration_fails_closed(client, setup, monkeypatch, change):
    if change == "missing":
        setup.client_file.unlink()
    elif change == "installed":
        setup.client_file.write_text('{"installed": {}}')
    elif change == "permissions":
        setup.client_file.chmod(0o644)
    elif change == "redirect":
        monkeypatch.setenv("RETIRE_AUTH_ORIGIN", "http://127.0.0.1:5181")
    elif change == "http":
        monkeypatch.setenv("RETIRE_AUTH_ALLOW_HTTP", "0")
    elif change == "public_setup":
        monkeypatch.setenv("RETIRE_AUTH_ORIGIN", "https://app.example")
    else:
        monkeypatch.setenv("RETIRE_AUTH_MODE", "typo")
    response = client.get("/api/family")
    assert response.status_code == 503
    assert "synthetic-secret" not in response.text
    assert not setup.store.path.exists()


def test_google_transport_failure_is_sanitized_and_flow_cannot_be_reused(client, setup, monkeypatch):
    params = begin(client, setup)
    def failure(*args, **kwargs):
        raise requests.Timeout("synthetic-secret should never appear")
    monkeypatch.setattr(auth_google.requests, "post", failure)
    response = finish(client, params)
    assert response.status_code == 400 and "synthetic-secret" not in response.text
    assert finish(client, params).status_code == 400
    assert not setup.store.initialized()


def test_callback_code_is_redacted_from_access_logs():
    record = logging.LogRecord("uvicorn.access", 20, "", 1, '%s - "%s %s HTTP/%s" %d',
                               ("127.0.0.1", "GET", auth_config.CALLBACK + "?code=secret&state=secret", "1.1", 303), None)
    assert auth.RedactOAuthQuery().filter(record)
    assert "secret" not in record.getMessage()
    assert auth_config.CALLBACK in record.getMessage()


def test_popup_result_contains_only_notification_and_requires_valid_server_session(client, setup):
    result = finish(client, begin(client, setup, popup=True))
    assert result.status_code == 200
    assert 'retire:login-result' in result.text and 'window.close()' in result.text
    assert 'Content-Security-Policy' in result.headers
    identity = client.get('/api/auth/session').json()
    assert identity['role'] == 'owner'
    assert identity['csrf_token'] not in result.text
    assert identity['email'] not in result.text
    assert 'synthetic-secret' not in result.text
    normal = begin(client, setup)
    normal['popup'] = '1'  # callback input cannot override the stored flow mode
    assert finish(client, normal).status_code == 303
    canceled = begin(client, setup, popup=True)
    canceled.pop('code')
    canceled['error'] = 'access_denied'
    error = finish(client, canceled)
    assert error.status_code == 200 and '"error": "failed"' in error.text


def test_account_choice_is_forced_only_for_bootstrap_or_explicit_switch(client, setup):
    first = client.get('/api/auth/google/login')
    assert parse_qs(urlsplit(first.headers['location']).query)['prompt'] == ['select_account']
    setup.store.login('owner-sub', 'owner@example.test', True, '')
    returning = client.get('/api/auth/google/login')
    assert 'prompt' not in parse_qs(urlsplit(returning.headers['location']).query)
    switch = client.get('/api/auth/google/login?choose=1')
    assert parse_qs(urlsplit(switch.headers['location']).query)['prompt'] == ['select_account']


def test_popup_schema_upgrade_preserves_owner_session_and_pending_flow(tmp_path):
    store = auth_store.AuthStore(tmp_path / 'auth.sqlite3')
    token = store.login('owner-sub', 'owner@example.test', True, '')
    identity = store.session(token)
    state, browser, nonce, verifier = store.new_flow('', False)
    with sqlite3.connect(store.path) as db:
        db.execute('ALTER TABLE oauth_flows DROP COLUMN popup')
    upgraded = auth_store.AuthStore(store.path)
    assert upgraded.initialized()
    assert upgraded.session(token) == identity
    flow = upgraded.consume_flow(state, browser)
    assert flow['nonce'] == nonce and flow['verifier'] == verifier and flow['popup'] == 0
    state, browser, *_ = upgraded.new_flow('', False, popup=True)
    assert upgraded.consume_flow(state, browser)['popup'] == 1
