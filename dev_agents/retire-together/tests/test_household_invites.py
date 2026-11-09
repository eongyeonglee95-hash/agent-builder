"""SHARE-04 real HTTP/SQLite/OAuth signature and fake Drive/Sheets transport only."""
from concurrent.futures import ThreadPoolExecutor
import base64
from hashlib import sha256
import json
import sqlite3
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException
from fastapi.testclient import TestClient
from google.auth import jwt
import pytest
import requests

from backend import auth, auth_config, household_invites, shared_sheets
from backend.auth_store import digest
from backend.household_invites_google import SharingGoogle
from backend.household_invites_store import InviteStore
from backend.main import app
from backend.shared_sheets_google import DRIVE, FILE_SCOPE
from tests.test_web_auth import signing_material, setup, client, login, begin, finish, ORIGIN
from tests.test_shared_sheets import FakeGoogle, SID, response

ROOT = "/api/auth/invitations"
SHEETS = "/api/google/shared"
INVITE_HEADERS = {"Origin": ORIGIN, "X-Retire-Invite": "1"}


class FakeSharing(FakeGoogle):
    def __init__(self):
        super().__init__()
        self.add()
        self.permissions = [{"id": "owner-permission", "type": "user", "role": "owner", "emailAddress": "owner@example.test"}]
        self.permission_calls = []
        self.fail_create = None
        self.fail_delete = False
        self.member_access = True
        self.pause = None
        self.fail_list = False
        self.paginate = False
        self.after_create = None

    def request(self, method, url, *, headers, timeout, allow_redirects, params=None, json=None):
        assert timeout == 20 and not allow_redirects
        assert headers["Authorization"] in {"Bearer synthetic-owner-token", "Bearer synthetic-partner-token"}
        owner = headers["Authorization"] == "Bearer synthetic-owner-token"
        if "/permissions" in url:
            assert owner
            self.permission_calls.append((method, url, params, json))
            if method == "GET":
                if self.fail_list:
                    return response(status=503)
                if self.paginate and "pageToken" not in params:
                    return response({"permissions": self.permissions[:1], "nextPageToken": "next"})
                return response({"permissions": self.permissions[1:] if self.paginate else self.permissions})
            if method == "POST":
                assert url == f"{DRIVE}/{SID}/permissions"
                assert params["sendNotificationEmail"] == "false"
                assert json == {"type": "user", "role": "writer", "emailAddress": "partner@example.test"}
                if self.pause:
                    self.pause[0].set()
                    assert self.pause[1].wait(10)
                if self.fail_create == "rejected":
                    return response(status=403)
                if self.fail_create == "before":
                    raise requests.Timeout("sensitive provider detail")
                assert not any(p["id"] == "partner-permission" for p in self.permissions), "duplicate share"
                permission = {"id": "partner-permission", **json}
                self.permissions.append(permission)
                if self.after_create:
                    self.after_create()
                if self.fail_create == "lost":
                    raise requests.Timeout("sensitive provider detail")
                return response(permission)
            assert method == "DELETE"
            if self.fail_delete:
                return response(status=503)
            self.permissions = [p for p in self.permissions if p["id"] != url.rsplit("/", 1)[1]]
            r = response(status=204)
            r._content = b""
            return r
        if not owner and (not self.member_access or not any(p["role"] == "writer" for p in self.permissions)):
            return response(status=404)
        r = super().request(method, url, headers={"Authorization": "Bearer synthetic-file-token"},
                            timeout=timeout, allow_redirects=allow_redirects, params=params, json=json)
        if not owner and url == f"{DRIVE}/{SID}":
            return response({**r.json(), "ownedByMe": False})
        return r

    @property
    def shares(self):
        return sum(method == "POST" for method, *_ in self.permission_calls)


@pytest.fixture
def invited(setup, client, monkeypatch):
    identity = login(client, setup)
    config = auth_config.load_config()
    store = InviteStore(config.db_path)
    store.save_grant(identity["user_id"], "synthetic-owner-token", "synthetic-owner-refresh", time.time() + 3600)
    store.reserve(1, "select", SID)
    store.ready(1)
    fake = FakeSharing()
    monkeypatch.setenv("RETIRE_SHEETS", "on")
    monkeypatch.delenv("RETIRE_GOOGLE_PICKER_API_KEY", raising=False)
    monkeypatch.delenv("RETIRE_GOOGLE_PROJECT_NUMBER", raising=False)
    monkeypatch.setattr(requests, "request", fake.request)
    original = requests.post
    def exchange(url, **kwargs):
        r = original(url, **kwargs)
        return response({**r.json(), "access_token": "synthetic-partner-token", "refresh_token": "synthetic-partner-refresh",
                         "scope": "openid email " + FILE_SCOPE, "token_type": "Bearer", "expires_in": 3600})
    monkeypatch.setattr(requests, "post", exchange)
    from types import SimpleNamespace
    return SimpleNamespace(config=config, store=store, fake=fake, identity=identity,
                           headers={"Origin": ORIGIN, "X-Retire-CSRF": identity["csrf_token"]})


def issue(client, invited, email="partner@example.test"):
    r = client.post(ROOT, json={"email": email}, headers=invited.headers)
    assert r.status_code == 200, r.text
    return r.json()


def invite_flow(partner, setup, invited, invitation, *, sub="partner-sub", email="partner@example.test", claims=None):
    r = partner.post(ROOT + "/accept", json={"code": invitation["code"]}, headers=INVITE_HEADERS)
    assert r.status_code == 200, r.text
    q = parse_qs(urlsplit(r.json()["authorization_url"]).query)
    assert set(q["scope"][0].split()) == {"openid", "email", FILE_SCOPE}
    with invited.store.connection() as db:
        flow = db.execute("SELECT * FROM invite_flows WHERE state_hash=?", (digest(q["state"][0]),)).fetchone()
    assert q["code_challenge"] == [base64.urlsafe_b64encode(sha256(flow["verifier"].encode()).digest()).rstrip(b"=").decode()]
    payload = {"sub": sub, "email": email, "email_verified": True, "nonce": q["nonce"][0],
               "iss": "https://accounts.google.com", "aud": invited.config.client_id,
               "iat": int(time.time()) - 1, "exp": int(time.time()) + 600, **(claims or {})}
    code = "invite-code-" + q["state"][0]
    setup.tokens[code] = (jwt.encode(setup.signer, payload).decode(), flow["verifier"])
    return {"state": q["state"][0], "code": code}


def join_headers(partner):
    r = partner.get(ROOT + "/join")
    assert r.status_code == 200, r.text
    return {**INVITE_HEADERS, "X-Retire-CSRF": r.json()["csrf_token"]}


def accept(partner, setup, invited, invitation):
    return partner.get(auth_config.CALLBACK, params=invite_flow(partner, setup, invited, invitation))


def test_admission_same_file_relogin_and_no_financial_access(client, setup, invited):
    invitation = issue(client, invited, "  PARTNER@example.test ")
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        assert accept(partner, setup, invited, invitation).headers["location"].endswith("invitation=ready")
        session = partner.get("/api/auth/session").json()
        assert session["role"] == "partner" and session["owner_user_id"] == invited.identity["user_id"]
        assert session["household_id"] == invited.identity["household_id"]
        state = partner.get(SHEETS + "/status").json()
        assert state["spreadsheet"]["spreadsheet_id"] == SID and state["active"]
        for path in ("/api/local", "/api/workbook", "/api/retirement"):
            assert partner.get(path).status_code == 403
        headers = {"Origin": ORIGIN, "X-Retire-CSRF": session["csrf_token"]}
        assert partner.post(ROOT, headers=headers, json={"email": "third@example.test"}).status_code == 403
        assert partner.post(SHEETS + "/spreadsheet", headers=headers).status_code == 403
        assert partner.delete(ROOT + "/" + invitation["invitation"]["id"], headers=headers).status_code == 403
        assert partner.post("/api/auth/logout", headers=headers).status_code == 204
        again = login(partner, setup, sub="partner-sub", email="changed@example.test")
        assert again["user_id"] == session["user_id"]
        assert partner.get(SHEETS + "/status").json()["active"]
        assert partner.post(ROOT + "/accept", json={"code": invitation["code"]}, headers=INVITE_HEADERS).status_code == 409
    assert invited.fake.shares == 1
    with invited.store.connection() as db:
        assert db.execute("SELECT count(*) FROM households").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM memberships WHERE role='partner' AND active=1").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM invite_joins").fetchone()[0] == 0


def test_secret_storage_expiry_and_owner_only_csrf(client, setup, invited):
    invitation = issue(client, invited)
    row = invited.store.get(invitation["invitation"]["id"])
    assert row["code_hash"] == digest(invitation["code"])
    assert invitation["url"] == ORIGIN + "/#invite=" + invitation["code"]
    assert invitation["code"] not in client.get(ROOT).text
    assert invited.store.path.stat().st_mode & 0o777 == 0o600
    assert client.post(ROOT, json={"email": "other@example.test"}).status_code == 403
    with TestClient(app, base_url=ORIGIN) as outsider:
        assert outsider.get(ROOT).status_code == 401
        assert outsider.post(ROOT + "/accept", json={"code": invitation["code"]}).status_code == 403
        assert outsider.post(ROOT + "/accept", json={"code": "x" * 43}, headers=INVITE_HEADERS).status_code == 409
        with invited.store.connection() as db:
            db.execute("UPDATE household_invites SET expires_at=0")
        assert outsider.post(ROOT + "/accept", json={"code": invitation["code"]}, headers=INVITE_HEADERS).status_code == 409
    assert invited.fake.shares == 0


@pytest.mark.parametrize("email,claims,status", [("other@example.test", {}, 403), ("partner@example.test", {"email_verified": False}, 400),
    ("partner@example.test", {"nonce": "wrong"}, 400), ("partner@example.test", {"aud": "wrong"}, 400),
    ("partner@example.test", {"exp": 1}, 400)])
def test_wrong_account_or_claims_never_share(client, setup, invited, email, claims, status):
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        params = invite_flow(partner, setup, invited, invitation, email=email, claims=claims)
        assert partner.get(auth_config.CALLBACK, params=params).status_code == status
        assert partner.get(auth_config.CALLBACK, params=params).status_code == 400
        assert partner.get("/api/auth/session").status_code == 401
    assert invited.fake.shares == 0
    with invited.store.connection() as db:
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 1


@pytest.mark.parametrize("change", ["cookie", "expired", "cancelled", "denied", "duplicate_state"])
def test_flow_is_browser_bound_one_use_and_cancel_safe(client, setup, invited, change):
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        params = invite_flow(partner, setup, invited, invitation)
        if change == "cookie":
            partner.cookies.clear()
        elif change == "expired":
            with invited.store.connection() as db:
                db.execute("UPDATE invite_flows SET expires_at=0")
        elif change == "cancelled":
            assert client.delete(ROOT + "/" + invitation["invitation"]["id"], headers=invited.headers).status_code == 200
        elif change == "denied":
            params = {"state": params["state"], "error": "access_denied"}
        else:
            params = [("state", params["state"]), ("state", params["state"]), ("code", params["code"])]
        assert partner.get(auth_config.CALLBACK, params=params).status_code == 400
        assert partner.get("/api/auth/session").status_code == 401
    assert invited.fake.shares == 0


def test_no_invitation_login_and_second_partner_blocked(client, setup, invited):
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        assert finish(partner, begin(partner, setup, sub="partner-sub", email="partner@example.test")).status_code == 403
        invitation = issue(client, invited)
        accept(partner, setup, invited, invitation)
        assert client.post(ROOT, json={"email": "another@example.test"}, headers=invited.headers).status_code == 409


def test_failed_member_access_resumes_same_invite_and_picker_csrf(client, setup, invited, monkeypatch):
    invitation = issue(client, invited)
    invited.fake.member_access = False
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        assert accept(partner, setup, invited, invitation).headers["location"].endswith("invitation=pending")
        assert partner.get("/api/auth/session").status_code == 401
        headers = join_headers(partner)
        assert partner.post(ROOT + "/resume").status_code == 403
        assert partner.post(ROOT + "/resume", headers={**headers, "X-Retire-CSRF": "wrong"}).status_code == 403
        assert partner.post(ROOT + "/picker", headers=headers).status_code == 503
        monkeypatch.setenv("RETIRE_GOOGLE_PICKER_API_KEY", "synthetic-key")
        monkeypatch.setenv("RETIRE_GOOGLE_PROJECT_NUMBER", "123456")
        credentials = partner.post(ROOT + "/picker", headers=headers).json()
        assert credentials["spreadsheet_id"] == SID and credentials["access_token"] == "synthetic-partner-token"
        assert "refresh" not in json.dumps(credentials)
        assert partner.post(ROOT + "/resume", headers=headers).status_code == 409
        invited.fake.member_access = True
        assert partner.post(ROOT + "/resume", headers=headers).json() == {"membership_active": True}
        assert partner.post(ROOT + "/resume", headers=headers).status_code == 401
    assert invited.fake.shares == 1


@pytest.mark.parametrize("failure", ["lost", "before", "rejected"])
def test_create_failure_reconcile_no_blind_duplicate(client, setup, invited, failure):
    invitation = issue(client, invited)
    invited.fake.fail_create = failure
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        assert accept(partner, setup, invited, invitation).headers["location"].endswith("invitation=pending")
        headers = join_headers(partner)
        invited.fake.fail_create = None
        result = partner.post(ROOT + "/resume", headers=headers)
        assert result.status_code == (409 if failure == "before" else 200)
        assert invited.fake.shares == (2 if failure == "rejected" else 1)
        row = invited.store.get(invitation["invitation"]["id"])
        if failure == "lost":
            assert row["permission_source"] == "uncertain"
            revoked = client.post(ROOT + "/" + row["id"] + "/revoke", headers=invited.headers).json()
            assert revoked["invitation"]["cleanup"] == "attention"
            assert revoked["invitation"]["residual_access"]
            assert not any(m == "DELETE" for m, *_ in invited.fake.permission_calls)


def test_revoke_sessions_first_and_retry_remote_cleanup(client, setup, invited):
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, invitation)
        member = partner.get("/api/auth/session").json()
        other_session = invited.store.login("partner-sub", "partner@example.test", False, "")
        invited.fake.fail_delete = True
        result = client.post(ROOT + "/" + invitation["invitation"]["id"] + "/revoke", headers=invited.headers).json()
        assert not result["app_access"] and result["invitation"]["cleanup"] == "pending"
        assert partner.get("/api/auth/session").status_code == 401
        assert invited.store.session(other_session) is None
        assert invited.store.grant(member["user_id"]) is None
        assert finish(partner, begin(partner, setup, sub="partner-sub", email="partner@example.test")).status_code == 403
        assert client.get("/api/auth/session").json()["role"] == "owner"
        assert invited.store.binding(1)["spreadsheet_id"] == SID
        invited.fake.fail_delete = False
        result = client.post(ROOT + "/" + invitation["invitation"]["id"] + "/revoke", headers=invited.headers).json()
        assert result["invitation"]["cleanup"] == "done" and not result["invitation"]["residual_access"]
        assert len(invited.fake.permissions) == 1
        assert client.post(ROOT + "/" + invitation["invitation"]["id"] + "/revoke", headers=invited.headers).status_code == 200


def test_preexisting_and_broad_permissions_are_preserved_and_reported(client, setup, invited):
    invited.fake.permissions.extend([
        {"id": "existing", "type": "user", "role": "writer", "emailAddress": "partner@example.test"},
        {"id": "group", "type": "group", "role": "reader", "emailAddress": "group@example.test"},
    ])
    invited.fake.paginate = True
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        assert accept(partner, setup, invited, invitation).headers["location"].endswith("invitation=ready")
    result = client.post(ROOT + "/" + invitation["invitation"]["id"] + "/revoke", headers=invited.headers).json()
    assert result["invitation"]["cleanup"] == "done" and result["invitation"]["residual_access"]
    assert invited.fake.shares == 0 and not any(m == "DELETE" for m, *_ in invited.fake.permission_calls)
    assert len(invited.fake.permissions) == 3


def test_cancel_pending_share_and_expired_join_clean_up(client, setup, invited):
    invitation = issue(client, invited)
    invited.fake.member_access = False
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, invitation)
        headers = join_headers(partner)
        with invited.store.connection() as db:
            db.execute("UPDATE household_invites SET expires_at=0")
        assert partner.post(ROOT + "/resume", headers=headers).status_code == 409
        result = client.delete(ROOT + "/" + invitation["invitation"]["id"], headers=invited.headers).json()
        assert result["invitation"]["cleanup"] == "done"
        assert partner.post(ROOT + "/resume", headers=headers).status_code == 401
        with invited.store.connection() as db:
            assert db.execute("SELECT count(*) FROM sheet_grants").fetchone()[0] == 1


def test_concurrent_accept_only_one_membership(client, setup, invited):
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as first, TestClient(app, base_url=ORIGIN, follow_redirects=False) as second:
        a = invite_flow(first, setup, invited, invitation)
        b = invite_flow(second, setup, invited, invitation)
        invited.fake.pause = (threading.Event(), threading.Event())
        with ThreadPoolExecutor(max_workers=2) as pool:
            running = pool.submit(first.get, auth_config.CALLBACK, params=a)
            assert invited.fake.pause[0].wait(5)
            other = second.get(auth_config.CALLBACK, params=b)
            assert other.headers["location"].endswith("invitation=pending")
            invited.fake.pause[1].set()
            assert running.result().headers["location"].endswith("invitation=ready")
        assert second.get(ROOT + "/join").status_code == 401
    with invited.store.connection() as db:
        assert db.execute("SELECT count(*) FROM memberships WHERE role='partner'").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM sessions s JOIN memberships m ON s.membership_id=m.id WHERE m.role='partner'").fetchone()[0] == 1
    assert invited.fake.shares == 1


def test_cancel_during_google_request_cannot_activate(client, setup, invited):
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        params = invite_flow(partner, setup, invited, invitation)
        invited.fake.pause = (threading.Event(), threading.Event())
        with ThreadPoolExecutor(max_workers=1) as pool:
            running = pool.submit(partner.get, auth_config.CALLBACK, params=params)
            assert invited.fake.pause[0].wait(5)
            cancelled = client.delete(ROOT + "/" + invitation["invitation"]["id"], headers=invited.headers).json()
            assert cancelled["invitation"]["cleanup"] == "pending"
            invited.fake.pause[1].set()
            running.result()
        assert partner.get("/api/auth/session").status_code == 401
        assert client.delete(ROOT + "/" + invitation["invitation"]["id"], headers=invited.headers).json()["invitation"]["cleanup"] == "done"
    assert len(invited.fake.permissions) == 1


def test_rate_limits_persist_and_issue_bucket_not_reset_by_accept(client, setup, invited):
    for _ in range(5):
        invited.store.limit("issue-test", 5, 3600)
    with invited.store.connection() as db:
        db.execute("UPDATE invite_limits SET started_at=? WHERE bucket='issue-test'", (time.time() - 700,))
    InviteStore(invited.store.path).limit("accept", 60, 600)
    with pytest.raises(HTTPException) as error:
        InviteStore(invited.store.path).limit("issue-test", 5, 3600)
    assert error.value.status_code == 429
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN) as partner:
        for _ in range(59):
            assert partner.post(ROOT + "/accept", json={"code": "a" * 43}, headers=INVITE_HEADERS).status_code == 409
        assert partner.post(ROOT + "/accept", json={"code": invitation["code"]}, headers=INVITE_HEADERS).status_code == 429


def test_no_owner_transfer_and_cancel_is_not_revoke(client, setup, invited):
    assert client.post(ROOT, json={"email": "owner@example.test"}, headers=invited.headers).status_code == 422
    assert client.post(ROOT, json={"email": "bad address"}, headers=invited.headers).status_code == 422
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, invitation)
        assert client.delete(ROOT + "/" + invitation["invitation"]["id"], headers=invited.headers).status_code == 409
        assert partner.get("/api/auth/session").status_code == 200
    with invited.store.connection() as db:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE households SET owner_user_id='other'")


def test_reinvite_rotates_membership_and_old_revoke_cannot_revoke_new_session(client, setup, invited):
    first = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, first)
        old_cookie = partner.cookies.get(invited.config.session_cookie)
        old_member = partner.get("/api/auth/session").json()["member_id"]
        client.post(ROOT + "/" + first["invitation"]["id"] + "/revoke", headers=invited.headers)
        second = issue(client, invited)
        accept(partner, setup, invited, second)
        assert partner.get("/api/auth/session").json()["member_id"] != old_member
        assert invited.store.session(old_cookie) is None
        assert client.post(ROOT + "/" + first["invitation"]["id"] + "/revoke", headers=invited.headers).status_code == 200
        assert partner.get("/api/auth/session").status_code == 200
        assert invited.store.grant(partner.get("/api/auth/session").json()["user_id"]) is not None
        assert partner.get(SHEETS + "/status").json()["active"]


def test_uncertain_share_cleanup_after_owner_manual_removal(client, setup, invited):
    invitation = issue(client, invited)
    invited.fake.fail_create = "lost"
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, invitation)
        assert partner.post(ROOT + "/resume", headers=join_headers(partner)).status_code == 200
    path = ROOT + "/" + invitation["invitation"]["id"] + "/revoke"
    assert client.post(path, headers=invited.headers).json()["invitation"]["cleanup"] == "attention"
    invited.fake.permissions = invited.fake.permissions[:1]  # external owner removal
    assert client.post(path, headers=invited.headers).json()["invitation"]["cleanup"] == "done"


def test_join_expiry_reauthentication_and_identity_cannot_switch(client, setup, invited):
    invitation = issue(client, invited)
    invited.fake.member_access = False
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, invitation)
        with invited.store.connection() as db:
            db.execute("UPDATE invite_joins SET expires_at=0")
        assert partner.get(ROOT + "/join").status_code == 401
        params = invite_flow(partner, setup, invited, invitation, sub="different-sub")
        assert partner.get(auth_config.CALLBACK, params=params).status_code == 403
        invited.fake.member_access = True
        assert accept(partner, setup, invited, invitation).headers["location"].endswith("invitation=ready")
    assert invited.fake.shares == 1


def test_partner_reconsent_and_disconnect_only_affect_own_grant(client, setup, invited):
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, invitation)
        session = partner.get("/api/auth/session").json()
        headers = {"Origin": ORIGIN, "X-Retire-CSRF": session["csrf_token"]}
        assert partner.delete(SHEETS + "/connection", headers=headers).status_code == 200
        assert partner.get(SHEETS + "/status").json()["health"] == "attention"
        assert invited.store.grant(invited.identity["user_id"]) is not None
        assert partner.get("/api/auth/session").status_code == 200
        result = partner.post(SHEETS + "/connect", headers=headers)
        q = parse_qs(urlsplit(result.json()["authorization_url"]).query)
        with invited.store.connection() as db:
            flow = db.execute("SELECT * FROM sheet_flows WHERE state_hash=?", (digest(q["state"][0]),)).fetchone()
        payload = {"sub": "partner-sub", "email": "partner@example.test", "email_verified": True,
            "nonce": q["nonce"][0], "iss": "https://accounts.google.com", "aud": invited.config.client_id,
            "iat": int(time.time()) - 1, "exp": int(time.time()) + 600}
        setup.tokens["reconnect"] = (jwt.encode(setup.signer, payload).decode(), flow["verifier"])
        result = partner.get(auth_config.CALLBACK, params={"state": q["state"][0], "code": "reconnect"})
        assert result.status_code == 303
        assert partner.get(SHEETS + "/status").json()["active"]
        assert invited.store.binding(1)["spreadsheet_id"] == SID


@pytest.mark.parametrize("failure", ["list", "member", "local_commit"])
def test_durable_partial_failure_reuses_same_permission(client, setup, invited, monkeypatch, failure):
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        if failure == "list":
            invited.fake.after_create = lambda: setattr(invited.fake, "fail_list", True)
        elif failure == "member":
            invited.fake.member_access = False
        else:
            original = InviteStore.activate
            def crash(*args):
                raise HTTPException(503, "synthetic local commit failure")
            monkeypatch.setattr(InviteStore, "activate", crash)
        assert accept(partner, setup, invited, invitation).headers["location"].endswith("invitation=pending")
        assert partner.get("/api/auth/session").status_code == 401
        invited.fake.fail_list = False
        invited.fake.member_access = True
        if failure == "local_commit":
            monkeypatch.setattr(InviteStore, "activate", original)
        assert partner.post(ROOT + "/resume", headers=join_headers(partner)).status_code == 200
        assert invited.fake.shares == 1


def test_share_lock_blocks_other_process_without_touching_db(client, setup, invited):
    code = """from pathlib import Path
import sys
from fastapi import HTTPException
from backend.household_invites_store import InviteStore
try:
    with InviteStore(Path(sys.argv[1])).operation():
        print('unlocked')
except HTTPException as exc:
    print(exc.status_code)
"""
    with invited.store.operation():
        result = subprocess.run([sys.executable, "-c", code, str(invited.store.path)],
                                capture_output=True, text=True, timeout=15)
    assert result.returncode == 0 and result.stdout.strip() == "409", result.stderr


@pytest.mark.parametrize("role", ["reader", "owner"])
def test_existing_permission_never_upgraded_or_ownership_transferred(client, setup, invited, role):
    invited.fake.permissions.append({"id": "existing", "type": "user", "role": role, "emailAddress": "partner@example.test"})
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        assert accept(partner, setup, invited, invitation).headers["location"].endswith("invitation=pending")
        assert partner.get("/api/auth/session").status_code == 401
    assert invited.fake.shares == 0
    assert invited.fake.permissions[-1]["role"] == role


def test_lost_delete_response_is_reconciled_by_permission_list(client, setup, invited, monkeypatch):
    invitation = issue(client, invited)
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, invitation)
    original = invited.fake.request
    def request(method, url, **kwargs):
        result = original(method, url, **kwargs)
        if method == "DELETE":
            raise requests.Timeout("synthetic lost delete")
        return result
    monkeypatch.setattr(requests, "request", request)
    path = ROOT + "/" + invitation["invitation"]["id"] + "/revoke"
    assert client.post(path, headers=invited.headers).json()["invitation"]["cleanup"] == "pending"
    assert client.post(path, headers=invited.headers).json()["invitation"]["cleanup"] == "done"
    assert sum(m == "DELETE" for m, *_ in invited.fake.permission_calls) == 1


def test_completed_cleanup_cannot_regress_or_touch_reinvite_under_lock(client, setup, invited):
    first = issue(client, invited)
    iid = first["invitation"]["id"]
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, first)
        client.post(ROOT + "/" + iid + "/revoke", headers=invited.headers)
        second = issue(client, invited)
        accept(partner, setup, invited, second)
        # Delayed failure from another cleanup process must not regress done.
        invited.store.cleanup_result(iid, "pending", True)
        assert invited.store.get(iid)["cleanup"] == "done"
        with invited.store.operation():
            result = client.post(ROOT + "/" + iid + "/revoke", headers=invited.headers)
        assert result.json()["invitation"]["cleanup"] == "done"
        assert partner.get(SHEETS + "/status").json()["active"]


def test_expired_old_invite_cannot_disable_rejoined_partner(client, setup, invited):
    first = issue(client, invited)
    iid = first["invitation"]["id"]
    invited.fake.member_access = False
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, first)
        with invited.store.connection() as db:
            db.execute("UPDATE household_invites SET expires_at=0")
        assert client.get(ROOT).json()["invitations"][0]["status"] == "expired"
        assert client.delete(ROOT + "/" + iid, headers=invited.headers).json()["invitation"]["cleanup"] == "done"
        second = issue(client, invited)
        invited.fake.member_access = True
        accept(partner, setup, invited, second)
        client.delete(ROOT + "/" + iid, headers=invited.headers)
        assert partner.get("/api/auth/session").status_code == 200
        assert partner.get(SHEETS + "/status").json()["active"]


def test_unknown_create_can_be_cancelled_then_manually_confirmed_with_evidence(client, setup, invited):
    invitation = issue(client, invited)
    iid = invitation["invitation"]["id"]
    invited.fake.fail_create = "before"
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, invitation)
    confirm = ROOT + "/" + iid + "/confirm-cleanup"
    assert client.post(confirm, json={"confirmed_in_drive": True}, headers=invited.headers).status_code == 409
    result = client.delete(ROOT + "/" + iid, headers=invited.headers).json()
    assert result["invitation"]["cleanup"] == "attention"
    assert client.post(confirm, json={"confirmed_in_drive": True}).status_code == 403
    assert client.post(confirm, json={"confirmed_in_drive": False}, headers=invited.headers).status_code == 422
    invited.fake.fail_list = True
    assert client.post(confirm, json={"confirmed_in_drive": True}, headers=invited.headers).status_code == 503
    invited.fake.fail_list = False
    result = client.post(confirm, json={"confirmed_in_drive": True}, headers=invited.headers).json()
    assert result["manually_confirmed"] and result["invitation"]["cleanup"] == "done"
    with invited.store.connection() as db:
        confirmation = db.execute("SELECT * FROM invite_cleanup_confirmations WHERE invite_id=?", (iid,)).fetchone()
        assert confirmation["owner_user_id"] == invited.identity["user_id"]
    issue(client, invited)
    assert invited.fake.shares == 1


def test_cancel_lost_create_discovers_permission_without_claiming_it(client, setup, invited):
    invitation = issue(client, invited)
    iid = invitation["invitation"]["id"]
    invited.fake.fail_create = "lost"
    with TestClient(app, base_url=ORIGIN, follow_redirects=False) as partner:
        accept(partner, setup, invited, invitation)
    assert client.delete(ROOT + "/" + iid, headers=invited.headers).json()["invitation"]["cleanup"] == "attention"
    assert invited.store.get(iid)["permission_source"] == "uncertain"
    confirm = ROOT + "/" + iid + "/confirm-cleanup"
    assert client.post(confirm, json={"confirmed_in_drive": True}, headers=invited.headers).status_code == 409
    assert not any(m == "DELETE" for m, *_ in invited.fake.permission_calls)
    invited.fake.permissions = invited.fake.permissions[:1]
    assert client.delete(ROOT + "/" + iid, headers=invited.headers).json()["invitation"]["cleanup"] == "done"
